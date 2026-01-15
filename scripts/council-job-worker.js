#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }

    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) {
      out[key.slice(2)] = rawValue;
      continue;
    }
    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[key.slice(2)] = true;
      continue;
    }
    out[key.slice(2)] = next;
    i++;
  }
  return out;
}

function splitCommand(command) {
  const tokens = [];
  let currentToken = '';
  let escape = false;
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escape) {
      currentToken += char;
      escape = false;
    } else if (char === '\\') {
      escape = true;
    } else if (char === '"' || char === "'") {
      if (quote === null) {
        quote = char;
      } else if (quote === char) {
        quote = null;
      } else {
        currentToken += char;
      }
    } else if (char === ' ' && quote === null) {
      if (currentToken !== '') {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken !== '') {
    tokens.push(currentToken);
  }

  return tokens;
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Preserve certain fields from existing status (like role)
function mergeStatus(statusPath, newStatus) {
  const existing = readJsonIfExists(statusPath);
  const preserved = {};
  if (existing && existing.role) preserved.role = existing.role;
  return { ...preserved, ...newStatus };
}

// Rate limit detection patterns
const RATE_LIMIT_PATTERNS = [
  /429/i,
  /rate.?limit/i,
  /too.?many.?requests/i,
  /RESOURCE_EXHAUSTED/i,
  /quota.?exceeded/i,
];

function isRateLimitError(stderr) {
  if (!stderr) return false;
  return RATE_LIMIT_PATTERNS.some(pattern => pattern.test(stderr));
}

function main() {
  const options = parseArgs(process.argv);
  const jobDir = options['job-dir'];
  const member = options.member;
  const safeMember = options['safe-member'];
  const command = options.command;
  const fallbackCommand = options.fallback || null;
  const timeoutSec = options.timeout ? Number(options.timeout) : 0;
  const useMemberPrompt = Boolean(options['use-member-prompt']);

  if (!jobDir) exitWithError('worker: missing --job-dir');
  if (!member) exitWithError('worker: missing --member');
  if (!safeMember) exitWithError('worker: missing --safe-member');
  if (!command) exitWithError('worker: missing --command');

  const membersRoot = path.join(jobDir, 'members');
  const memberDir = path.join(membersRoot, safeMember);
  const statusPath = path.join(memberDir, 'status.json');
  const outPath = path.join(memberDir, 'output.txt');
  const errPath = path.join(memberDir, 'error.txt');

  // Use member-specific prompt if available, otherwise fall back to job prompt
  const memberPromptPath = path.join(memberDir, 'prompt.txt');
  const jobPromptPath = path.join(jobDir, 'prompt.txt');
  const promptPath = useMemberPrompt && fs.existsSync(memberPromptPath) ? memberPromptPath : jobPromptPath;
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const tokens = splitCommand(command);
  if (!tokens || tokens.length === 0) {
    atomicWriteJson(statusPath, {
      member,
      state: 'error',
      message: 'Invalid command string',
      finishedAt: new Date().toISOString(),
      command,
    });
    process.exit(1);
  }

  const program = tokens[0];
  const args = tokens.slice(1);

  atomicWriteJson(statusPath, mergeStatus(statusPath, {
    member,
    state: 'running',
    startedAt: new Date().toISOString(),
    command,
    pid: null,
  }));

  const outStream = fs.createWriteStream(outPath, { flags: 'w' });
  const errStream = fs.createWriteStream(errPath, { flags: 'w' });

  let child;
  try {
    child = spawn(program, [...args, prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
  } catch (error) {
    atomicWriteJson(statusPath, mergeStatus(statusPath, {
      member,
      state: 'error',
      message: error && error.message ? error.message : 'Failed to spawn command',
      finishedAt: new Date().toISOString(),
      command,
    }));
    process.exit(1);
  }

  atomicWriteJson(statusPath, mergeStatus(statusPath, {
    member,
    state: 'running',
    startedAt: new Date().toISOString(),
    command,
    pid: child.pid,
  }));

  // Pipe with error handling
  if (child.stdout) {
    child.stdout.pipe(outStream);
    child.stdout.on('error', (err) => {
      try { fs.appendFileSync(errPath, `\nstdout error: ${err.message}\n`); } catch { /* ignore */ }
    });
  }
  if (child.stderr) {
    child.stderr.pipe(errStream);
    child.stderr.on('error', (err) => {
      try { fs.appendFileSync(errPath, `\nstderr error: ${err.message}\n`); } catch { /* ignore */ }
    });
  }

  // Handle stream errors
  outStream.on('error', (err) => {
    try { fs.appendFileSync(errPath, `\noutput stream error: ${err.message}\n`); } catch { /* ignore */ }
  });
  errStream.on('error', () => { /* ignore - can't write to error stream */ });

  let timeoutHandle = null;
  let timeoutTriggered = false;
  if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      timeoutTriggered = true;
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // ignore
      }
    }, timeoutSec * 1000);
    timeoutHandle.unref();
  }

  const finalize = (payload) => {
    try {
      outStream.end();
      errStream.end();
    } catch {
      // ignore
    }
    // Preserve role and other metadata from initial status
    const mergedPayload = mergeStatus(statusPath, payload);
    atomicWriteJson(statusPath, mergedPayload);
  };

  child.on('error', (error) => {
    const isMissing = error && error.code === 'ENOENT';
    finalize({
      member,
      state: isMissing ? 'missing_cli' : 'error',
      message: error && error.message ? error.message : 'Process error',
      finishedAt: new Date().toISOString(),
      command,
      exitCode: null,
      pid: child.pid,
    });
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const timedOut = Boolean(timeoutTriggered) && signal === 'SIGTERM';
    const canceled = !timedOut && signal === 'SIGTERM';

    // Check for rate limit and retry with fallback if available
    if (code !== 0 && fallbackCommand && !canceled && !timedOut) {
      let stderrContent = '';
      try {
        stderrContent = fs.readFileSync(errPath, 'utf8');
      } catch {
        // ignore read errors
      }

      if (isRateLimitError(stderrContent)) {
        // Update status to indicate retry
        atomicWriteJson(statusPath, mergeStatus(statusPath, {
          member,
          state: 'retrying',
          message: 'Rate limit detected, retrying with fallback model...',
          originalCommand: command,
          fallbackCommand,
          retryAt: new Date().toISOString(),
          pid: null,
        }));

        // Clear previous output
        fs.writeFileSync(outPath, '', 'utf8');
        fs.writeFileSync(errPath, '', 'utf8');

        // Retry with fallback command
        const fallbackTokens = splitCommand(fallbackCommand);
        if (fallbackTokens && fallbackTokens.length > 0) {
          const fbProgram = fallbackTokens[0];
          const fbArgs = fallbackTokens.slice(1);

          const outStream2 = fs.createWriteStream(outPath, { flags: 'w' });
          const errStream2 = fs.createWriteStream(errPath, { flags: 'w' });

          let child2;
          try {
            child2 = spawn(fbProgram, [...fbArgs, prompt], {
              stdio: ['ignore', 'pipe', 'pipe'],
              env: process.env,
            });
          } catch (error) {
            finalize({
              member,
              state: 'error',
              message: `Fallback failed: ${error && error.message ? error.message : 'Unknown error'}`,
              finishedAt: new Date().toISOString(),
              command: fallbackCommand,
              usedFallback: true,
              exitCode: null,
            });
            process.exit(1);
            return;
          }

          atomicWriteJson(statusPath, mergeStatus(statusPath, {
            member,
            state: 'running',
            message: 'Running with fallback model',
            command: fallbackCommand,
            usedFallback: true,
            startedAt: new Date().toISOString(),
            pid: child2.pid,
          }));

          // Pipe with error handling
          if (child2.stdout) {
            child2.stdout.pipe(outStream2);
            child2.stdout.on('error', () => { /* ignore */ });
          }
          if (child2.stderr) {
            child2.stderr.pipe(errStream2);
            child2.stderr.on('error', () => { /* ignore */ });
          }
          outStream2.on('error', () => { /* ignore */ });
          errStream2.on('error', () => { /* ignore */ });

          let timeoutHandle2 = null;
          let timeoutTriggered2 = false;
          if (Number.isFinite(timeoutSec) && timeoutSec > 0) {
            timeoutHandle2 = setTimeout(() => {
              timeoutTriggered2 = true;
              try {
                process.kill(child2.pid, 'SIGTERM');
              } catch {
                // ignore
              }
            }, timeoutSec * 1000);
            timeoutHandle2.unref();
          }

          child2.on('error', (error) => {
            try {
              outStream2.end();
              errStream2.end();
            } catch {
              // ignore
            }
            const isMissing = error && error.code === 'ENOENT';
            finalize({
              member,
              state: isMissing ? 'missing_cli' : 'error',
              message: `Fallback: ${error && error.message ? error.message : 'Process error'}`,
              finishedAt: new Date().toISOString(),
              command: fallbackCommand,
              usedFallback: true,
              exitCode: null,
              pid: child2.pid,
            });
            process.exit(1);
          });

          child2.on('exit', (code2, signal2) => {
            if (timeoutHandle2) clearTimeout(timeoutHandle2);
            try {
              outStream2.end();
              errStream2.end();
            } catch {
              // ignore
            }
            const timedOut2 = Boolean(timeoutTriggered2) && signal2 === 'SIGTERM';
            finalize({
              member,
              state: timedOut2 ? 'timed_out' : code2 === 0 ? 'done' : 'error',
              message: timedOut2 ? `Fallback timed out after ${timeoutSec}s` : (code2 === 0 ? 'Completed with fallback model' : null),
              finishedAt: new Date().toISOString(),
              command: fallbackCommand,
              usedFallback: true,
              exitCode: typeof code2 === 'number' ? code2 : null,
              signal: signal2 || null,
              pid: child2.pid,
            });
            process.exit(code2 === 0 ? 0 : 1);
          });

          return; // Don't exit, let fallback complete
        }
      }
    }

    finalize({
      member,
      state: timedOut ? 'timed_out' : canceled ? 'canceled' : code === 0 ? 'done' : 'error',
      message: timedOut ? `Timed out after ${timeoutSec}s` : canceled ? 'Canceled' : null,
      finishedAt: new Date().toISOString(),
      command,
      exitCode: typeof code === 'number' ? code : null,
      signal: signal || null,
      pid: child.pid,
    });
    process.exit(code === 0 ? 0 : 1);
  });
}

if (require.main === module) {
  main();
}

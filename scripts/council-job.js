#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const SCRIPT_DIR = __dirname;
const SKILL_DIR = path.resolve(SCRIPT_DIR, '..');
const WORKER_PATH = path.join(SCRIPT_DIR, 'council-job-worker.js');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');

const SKILL_CONFIG_FILE = path.join(SKILL_DIR, 'council.config.yaml');
const REPO_CONFIG_FILE = path.join(path.resolve(SKILL_DIR, '../..'), 'council.config.yaml');
const CACHE_DIR = path.join(SKILL_DIR, '.cache');

// Constants for configuration
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PROGRESS_THROTTLE_MS = 500;
const DEFAULT_TIMEOUT_SEC = 120;
const MIN_USEFUL_OUTPUT_LEN = 100;

// Security: Sensitive file patterns to filter from prompts
const SENSITIVE_PATTERNS = [
  /\.env($|\.)/i,
  /\.env\.local/i,
  /\.env\.production/i,
  /credentials\.json/i,
  /secrets?\.(json|yaml|yml|toml)/i,
  /\.pem$/i,
  /\.key$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /\.ssh\//i,
  /aws_credentials/i,
  /\.netrc/i,
  /\.npmrc/i,
  /\.pypirc/i,
  /token\.json/i,
  /service[-_]?account.*\.json/i,
];

// Sensitive content patterns to mask
const SENSITIVE_CONTENT_PATTERNS = [
  { pattern: /(api[_-]?key\s*[=:]\s*)['""]?[\w-]{20,}['""]?/gi, replacement: '$1[REDACTED]' },
  { pattern: /(secret[_-]?key\s*[=:]\s*)['""]?[\w-]{20,}['""]?/gi, replacement: '$1[REDACTED]' },
  { pattern: /(password\s*[=:]\s*)['""]?[^'""\\s]{8,}['""]?/gi, replacement: '$1[REDACTED]' },
  { pattern: /(token\s*[=:]\s*)['""]?[\w.-]{20,}['""]?/gi, replacement: '$1[REDACTED]' },
  { pattern: /(bearer\s+)[\w.-]{20,}/gi, replacement: '$1[REDACTED]' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: '[GITHUB_TOKEN_REDACTED]' },
  { pattern: /sk-[a-zA-Z0-9]{48}/g, replacement: '[OPENAI_KEY_REDACTED]' },
  { pattern: /xox[baprs]-[\w-]+/g, replacement: '[SLACK_TOKEN_REDACTED]' },
];

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

// Smart scenario detection patterns
// Note: Korean doesn't work well with \b word boundaries, so we use looser patterns
const SCENARIO_PATTERNS = {
  'code-review': {
    keywords: [
      /\b(code\s*)?review\b/i,
      /\bPR\b/,
      /\bpull\s*request/i,
      /(코드|코드를?).{0,3}(리뷰|검토)/i,
      /변경.{0,3}사항/i,
      /\bMR\b/,
      /\bmerge\s*request/i,
      /\bdiff\b/i,
      /리뷰.{0,3}(해|줘)/i,
    ],
    weight: 10,
    category: 'dev',
    description: 'Code review',
  },
  'architecture': {
    keywords: [
      /(아키텍처|아키텍쳐|architecture)/i,
      /(설계|디자인).{0,3}(패턴|결정|선택)/i,
      /(모노레포|멀티레포|monorepo|multirepo)/i,
      /(마이크로서비스|microservice|MSA)/i,
      /(모놀리식|monolith)/i,
      /(시스템|서비스).{0,3}구조/i,
      /(기술.{0,3})?스택/i,
      /scalability/i,
      /확장성/i,
    ],
    weight: 10,
    category: 'dev',
    description: 'Architecture decisions',
  },
  'bug-analysis': {
    keywords: [
      /(버그|bug)/i,
      /(에러|error|오류)/i,
      /(디버그|debug|디버깅|debugging)/i,
      /(원인|cause).{0,5}(분석|파악)/i,
      /(문제|issue).{0,5}(해결|분석|진단)/i,
      /exception/i,
      /crash/i,
      /(동작|작동).{0,5}(안|않)/i,
      /왜.{0,5}(안|않)/i,
      /stack\s*trace/i,
    ],
    weight: 10,
    category: 'dev',
    description: 'Bug analysis',
  },
  'security': {
    keywords: [
      /(보안|security)/i,
      /(취약점|vulnerability|vulnerabilities)/i,
      /OWASP/i,
      /(인증|authentication)/i,
      /\bauth\b/i,
      /(인가|authorization)/i,
      /XSS/i,
      /SQL.{0,3}injection/i,
      /CSRF/i,
      /(암호화|encryption)/i,
      /(해킹|hacking|exploit)/i,
    ],
    weight: 10,
    category: 'dev',
    description: 'Security audit',
  },
  'doc-quality': {
    keywords: [
      /(문서|document|docs?).{0,5}(품질|quality|검토|리뷰|review)/i,
      /README/i,
      /(가이드|guide)/i,
      /(튜토리얼|tutorial)/i,
      /(매뉴얼|manual)/i,
      /(API.{0,3})?문서화/i,
      /(주석|comment).{0,5}(품질|개선)/i,
    ],
    weight: 10,
    category: 'docs',
    description: 'Documentation quality',
  },
  'reader-feedback': {
    keywords: [
      /(독자|reader|사용자|user).{0,5}(관점|피드백|feedback)/i,
      /(초보자|beginner|newbie)/i,
      /(이해|understand).{0,5}(하기|가능)/i,
      /(쉽게|easily).{0,5}(읽|이해)/i,
      /(대상.{0,3})?(독자|audience)/i,
      /(적합|suitable).{0,5}(한지|여부)/i,
    ],
    weight: 10,
    category: 'docs',
    description: 'Reader feedback',
  },
  'structure': {
    keywords: [
      /(문서|docs?).{0,5}(구조|structure)/i,
      /(목차|ToC|table\s*of\s*contents)/i,
      /(섹션|section).{0,5}(구성|배치|순서)/i,
      /(정보.{0,3})?(아키텍처|architecture)/i,
      /(네비게이션|navigation)/i,
      /(구조|structure).{0,5}(개선|분석|검토)/i,
    ],
    weight: 10,
    category: 'docs',
    description: 'Document structure',
  },
};

// Detect appropriate scenario from prompt
function detectScenario(prompt) {
  const scores = {};
  const promptLower = prompt.toLowerCase();

  for (const [scenario, config] of Object.entries(SCENARIO_PATTERNS)) {
    let score = 0;
    let matchedKeywords = [];

    for (const pattern of config.keywords) {
      if (pattern.test(prompt)) {
        score += config.weight;
        matchedKeywords.push(pattern.source);
      }
    }

    if (score > 0) {
      scores[scenario] = { score, category: config.category, description: config.description, matchedKeywords };
    }
  }

  // Find highest scoring scenario
  let bestScenario = null;
  let bestScore = 0;

  for (const [scenario, data] of Object.entries(scores)) {
    if (data.score > bestScore) {
      bestScore = data.score;
      bestScenario = scenario;
    }
  }

  return {
    detected: bestScenario,
    scores,
    confidence: bestScore > 0 ? (bestScore >= 20 ? 'high' : bestScore >= 10 ? 'medium' : 'low') : 'none',
  };
}

// Get scenario description for display
function getScenarioEmoji(scenario) {
  const emojis = {
    'code-review': '🔍',
    'architecture': '🏗️',
    'bug-analysis': '🐛',
    'security': '🔐',
    'doc-quality': '📝',
    'reader-feedback': '👥',
    'structure': '📊',
  };
  return emojis[scenario] || '🤖';
}

// Debug mode logging
let DEBUG_MODE = false;
let SHOW_STATS = false;

// Cleanup stale temp files on startup (files left from crashed processes)
function cleanupStaleTempFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    const files = fs.readdirSync(dirPath);
    const now = Date.now();
    let cleaned = 0;
    for (const file of files) {
      if (!file.endsWith('.tmp')) continue;
      const filePath = path.join(dirPath, file);
      try {
        const stat = fs.statSync(filePath);
        // Remove tmp files older than 1 hour
        if (now - stat.mtimeMs > 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Ignore individual file errors
      }
    }
    if (cleaned > 0 && DEBUG_MODE) {
      debug(`Cleaned ${cleaned} stale temp file(s) from ${dirPath}`);
    }
  } catch {
    // Ignore directory read errors
  }
}

function debug(message, data = null) {
  if (!DEBUG_MODE) return;
  const timestamp = new Date().toISOString().slice(11, 23);
  process.stderr.write(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${COLORS.blue}DEBUG${COLORS.reset} ${message}`);
  if (data !== null) {
    process.stderr.write(`: ${JSON.stringify(data, null, 2)}`);
  }
  process.stderr.write('\n');
}

// Security: Check if prompt contains sensitive file references
function checkSensitiveFiles(prompt) {
  const warnings = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    const matches = prompt.match(pattern);
    if (matches) {
      warnings.push(`Sensitive file pattern detected: ${matches[0]}`);
    }
  }
  return warnings;
}

// Security: Mask sensitive content in prompt
function maskSensitiveContent(prompt) {
  let masked = prompt;
  let maskedCount = 0;
  for (const { pattern, replacement } of SENSITIVE_CONTENT_PATTERNS) {
    const before = masked;
    masked = masked.replace(pattern, replacement);
    if (before !== masked) maskedCount++;
  }
  return { masked, maskedCount };
}

// Stats tracking for cost/rate limit display
const jobStats = {
  startTime: null,
  endTime: null,
  members: {},
  rateLimits: [],
};

function recordMemberStats(member, stats) {
  jobStats.members[member] = {
    ...jobStats.members[member],
    ...stats,
  };
}

function recordRateLimit(member, error) {
  jobStats.rateLimits.push({
    timestamp: new Date().toISOString(),
    member,
    error: error.slice(0, 200),
  });
}

function printStats() {
  if (!SHOW_STATS && !DEBUG_MODE) return;

  process.stderr.write(`\n${COLORS.bold}📊 Execution Stats${COLORS.reset}\n`);

  const duration = jobStats.endTime && jobStats.startTime
    ? ((new Date(jobStats.endTime) - new Date(jobStats.startTime)) / 1000).toFixed(1)
    : 'N/A';
  process.stderr.write(`  Duration: ${duration}s\n`);

  // Member stats
  const members = Object.entries(jobStats.members);
  if (members.length > 0) {
    process.stderr.write(`  Members:\n`);
    for (const [name, stats] of members) {
      const status = stats.state === 'done' ? `${COLORS.green}✓${COLORS.reset}` :
        stats.state === 'timed_out' ? `${COLORS.yellow}⏱${COLORS.reset}` :
        `${COLORS.red}✗${COLORS.reset}`;
      process.stderr.write(`    ${status} ${name}: ${stats.state || 'unknown'}`);
      if (stats.duration) process.stderr.write(` (${stats.duration}s)`);
      process.stderr.write('\n');
    }
  }

  // Rate limits
  if (jobStats.rateLimits.length > 0) {
    process.stderr.write(`  ${COLORS.yellow}Rate Limits: ${jobStats.rateLimits.length} detected${COLORS.reset}\n`);
    for (const rl of jobStats.rateLimits.slice(0, 3)) {
      process.stderr.write(`    - ${rl.member}: ${rl.error.slice(0, 50)}...\n`);
    }
  }
}

// Progress display functions
function formatProgress(current, total, memberName, state) {
  const percentage = Math.round((current / total) * 100);
  const bar = '█'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));
  const stateEmoji = getStateEmoji(state);
  return `${COLORS.cyan}[${current}/${total}]${COLORS.reset} ${bar} ${stateEmoji} ${memberName}`;
}

function printProgressUpdate(members, total) {
  const done = members.filter(m => ['done', 'error', 'missing_cli', 'timed_out', 'canceled'].includes(m.state)).length;
  const running = members.filter(m => m.state === 'running').length;
  const retrying = members.filter(m => m.state === 'retrying').length;

  process.stderr.write(`\r${COLORS.bold}Council Progress:${COLORS.reset} `);
  process.stderr.write(`${COLORS.green}✓${done}${COLORS.reset} `);
  if (running > 0) {
    process.stderr.write(`${COLORS.yellow}⟳${running}${COLORS.reset} `);
  }
  if (retrying > 0) {
    process.stderr.write(`${COLORS.magenta}↻${retrying}${COLORS.reset} `);
  }
  process.stderr.write(`${COLORS.dim}of ${total}${COLORS.reset}`);

  // Show which members are running or retrying
  const activeMembers = members.filter(m => m.state === 'running' || m.state === 'retrying');
  if (activeMembers.length > 0) {
    const labels = activeMembers.map(m => m.state === 'retrying' ? `${m.member}↻` : m.member);
    process.stderr.write(` ${COLORS.dim}(${labels.join(', ')})${COLORS.reset}`);
  }
}

// Cache system for avoiding redundant queries
function getCacheKey(prompt, scenario) {
  const content = `${scenario || 'default'}:${prompt}`;
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function getCachePath(cacheKey) {
  return path.join(CACHE_DIR, `${cacheKey}.json`);
}

// Get the latest modification time of core scripts
function getScriptsMtime() {
  const scriptFiles = [
    path.join(SCRIPT_DIR, 'council-job.js'),
    path.join(SCRIPT_DIR, 'council-job-worker.js'),
    SKILL_CONFIG_FILE,
  ];
  let latestMtime = 0;
  for (const file of scriptFiles) {
    try {
      const stat = fs.statSync(file);
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
      }
    } catch {
      // File might not exist
    }
  }
  return latestMtime;
}

function readCache(cacheKey) {
  const cachePath = getCachePath(cacheKey);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    const cacheTime = new Date(cached.timestamp).getTime();

    // Cache expires after TTL
    const age = Date.now() - cacheTime;
    if (age > CACHE_TTL_MS) {
      fs.unlinkSync(cachePath);
      debug('Cache expired (24h TTL)', { cacheKey });
      return null;
    }

    // Invalidate cache if scripts have been modified after cache was created
    const scriptsMtime = getScriptsMtime();
    if (scriptsMtime > cacheTime) {
      fs.unlinkSync(cachePath);
      debug('Cache invalidated (scripts modified)', { cacheKey });
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

function writeCache(cacheKey, jobDir, prompt, scenario, members) {
  ensureDir(CACHE_DIR);
  const cachePath = getCachePath(cacheKey);
  const cacheData = {
    timestamp: new Date().toISOString(),
    prompt,
    scenario,
    jobDir,
    memberCount: members.length,
    preview: members.slice(0, 2).map(m => ({
      member: m.member,
      role: m.role,
      outputPreview: (m.output || '').slice(0, 200)
    }))
  };
  atomicWriteJson(cachePath, cacheData);
  debug('Cache written', { cacheKey, jobDir });
}

// List all cache entries
function listCacheEntries() {
  if (!fs.existsSync(CACHE_DIR)) return [];

  const entries = [];
  for (const file of fs.readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue;
    const cachePath = path.join(CACHE_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      const age = Date.now() - new Date(data.timestamp).getTime();
      const isExpired = age > CACHE_TTL_MS;
      entries.push({
        key: file.replace('.json', ''),
        timestamp: data.timestamp,
        prompt: data.prompt,
        scenario: data.scenario,
        jobDir: data.jobDir,
        memberCount: data.memberCount,
        age: Math.round(age / 1000 / 60), // minutes
        isExpired,
      });
    } catch {
      // Skip invalid entries
    }
  }
  return entries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

// Clear cache (all or specific key)
function clearCache(cacheKey = null) {
  if (!fs.existsSync(CACHE_DIR)) return 0;

  let cleared = 0;
  if (cacheKey) {
    const cachePath = getCachePath(cacheKey);
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
      cleared = 1;
    }
  } else {
    for (const file of fs.readdirSync(CACHE_DIR)) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(CACHE_DIR, file));
        cleared++;
      }
    }
  }
  return cleared;
}

// Export results to file
function exportResults(content, outputPath, format = 'md') {
  const resolvedPath = path.resolve(outputPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(resolvedPath, content, 'utf8');
  debug('Results exported', { outputPath: resolvedPath, format });
  return resolvedPath;
}

// Role template system for specialized councils
function loadScenarioTemplate(scenarioName, silent = false) {
  if (!scenarioName) return null;

  const templatePath = path.join(TEMPLATES_DIR, `${scenarioName}.yaml`);
  if (!fs.existsSync(templatePath)) {
    if (!silent) {
      process.stderr.write(`[council] Warning: Scenario template not found: ${scenarioName}\n`);
      process.stderr.write(`[council] Expected path: ${templatePath}\n`);
      process.stderr.write(`[council] Falling back to default prompting.\n`);
    }
    return null;
  }

  let YAML;
  try {
    YAML = require('yaml');
  } catch {
    if (!silent) {
      process.stderr.write(`[council] Warning: yaml module not installed. Run: npm install yaml\n`);
    }
    return null;
  }

  try {
    const template = YAML.parse(fs.readFileSync(templatePath, 'utf8'));
    if (!silent) {
      const roleCount = template.roles ? template.roles.length : 0;
      process.stderr.write(`[council] Loaded scenario '${scenarioName}' with ${roleCount} roles\n`);
    }
    return template;
  } catch (err) {
    if (!silent) {
      process.stderr.write(`[council] Warning: Failed to parse template ${scenarioName}: ${err.message}\n`);
    }
    return null;
  }
}

function buildRoleEnhancedPrompt(basePrompt, template, memberIndex) {
  if (!template || !template.roles || template.roles.length === 0) {
    return basePrompt;
  }

  // Assign role based on member index (round-robin if more members than roles)
  const role = template.roles[memberIndex % template.roles.length];

  const parts = [];

  // Add system prompt if available
  if (template.system_prompt) {
    parts.push(template.system_prompt.trim());
  }

  // Add role-specific prompt
  if (role.prompt) {
    parts.push(`\n---\n**Your Role: ${role.name || role.id}**\n${role.prompt.trim()}`);
  }

  // Add the user's original prompt
  parts.push(`\n---\n**Question/Task:**\n${basePrompt}`);

  return parts.join('\n');
}

// Extract key findings from a member's output
function extractKeyFindings(output) {
  if (!output) return [];
  const findings = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Extract bullet points and numbered items
    const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    const numberMatch = line.match(/^[\s]*\d+\.\s+(.+)/);
    const boldMatch = line.match(/\*\*([^*]+)\*\*/g);

    if (bulletMatch) {
      findings.push(bulletMatch[1].trim().toLowerCase());
    } else if (numberMatch) {
      findings.push(numberMatch[1].trim().toLowerCase());
    }
    if (boldMatch) {
      boldMatch.forEach(b => findings.push(b.replace(/\*\*/g, '').trim().toLowerCase()));
    }
  }
  return findings;
}

// Find consensus points across members
function findConsensus(members) {
  const allFindings = {};
  const validMembers = members.filter(m => m.state === 'done' && (m.output || m.stderr));

  // Count how many members mention each finding
  for (const member of validMembers) {
    const output = member.output || '';
    const findings = extractKeyFindings(output);
    const seen = new Set();

    for (const finding of findings) {
      // Normalize and skip very short items
      if (finding.length < 10) continue;
      const key = finding.slice(0, 50); // Use first 50 chars as key
      if (seen.has(key)) continue;
      seen.add(key);

      if (!allFindings[key]) {
        allFindings[key] = { text: finding, count: 0, members: [] };
      }
      allFindings[key].count++;
      allFindings[key].members.push(member.role || member.member);
    }
  }

  // Return findings mentioned by 2+ members
  return Object.values(allFindings)
    .filter(f => f.count >= 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Output formatter: Structures results based on template's output.sections
function formatStructuredOutput(members, jobMeta, template) {
  const scenario = jobMeta.scenario || 'default';
  const sections = template && template.output && template.output.sections
    ? template.output.sections
    : null;

  const lines = [];

  // Header
  lines.push(`# Council Results: ${scenario}`);
  lines.push('');

  // Auto-synthesized summary
  const validMembers = members.filter(m => m.state === 'done');
  const consensus = findConsensus(members);

  if (consensus.length > 0) {
    lines.push('## Auto-Synthesized Summary');
    lines.push('');
    lines.push('### Consensus Points');
    lines.push('*Issues identified by multiple reviewers:*');
    lines.push('');
    for (const item of consensus) {
      lines.push(`- **${item.text.slice(0, 80)}${item.text.length > 80 ? '...' : ''}**`);
      lines.push(`  - Mentioned by: ${item.members.join(', ')}`);
    }
    lines.push('');
  }

  // Statistics
  lines.push('### Review Statistics');
  lines.push(`- **Completed**: ${validMembers.length}/${members.length} reviewers`);
  const errorMembers = members.filter(m => m.state === 'error' || m.state === 'timed_out');
  if (errorMembers.length > 0) {
    lines.push(`- **Issues**: ${errorMembers.map(m => `${m.member} (${m.state})`).join(', ')}`);
  }
  lines.push('');

  // Member summary table
  lines.push('## Participants');
  lines.push('');
  lines.push('| Member | Role | Status |');
  lines.push('|--------|------|--------|');

  for (const m of members) {
    const role = m.role || 'General';
    const status = m.state === 'done' ? '✅ Complete'
      : m.state === 'error' ? '❌ Error'
      : m.state === 'timed_out' ? '⏱️ Timeout'
      : m.state === 'missing_cli' ? '⚠️ CLI Missing'
      : m.state;
    lines.push(`| ${m.member} | ${role} | ${status} |`);
  }
  lines.push('');

  // Individual responses
  lines.push('## Individual Responses');
  lines.push('');

  for (const m of members) {
    const role = m.role || m.member;
    const emoji = getStateEmoji(m.state);
    lines.push(`### ${emoji} ${role} (${m.member})`);
    lines.push('');

    if (m.state === 'done') {
      const output = (m.output || '').trim();
      if (output) {
        lines.push(output);
      } else if (m.stderr) {
        // Some CLIs (like codex) output to stderr - try to extract useful content
        const stderrContent = extractUsefulOutput(m.stderr);
        if (stderrContent) {
          lines.push('*Output extracted from stderr:*');
          lines.push('');
          lines.push(stderrContent);
        } else {
          lines.push('> *No output captured (check stderr for details)*');
        }
      } else {
        lines.push('> *No output captured*');
      }
    } else if (m.state === 'error') {
      lines.push(`> **Error**: ${m.message || 'Unknown error'}`);
      if (m.stderr) {
        lines.push('```');
        lines.push(m.stderr.trim().slice(0, 500));
        lines.push('```');
      }
    } else if (m.state === 'timed_out') {
      lines.push(`> **Timed out**: Response took too long`);
    } else if (m.state === 'missing_cli') {
      lines.push(`> **CLI not found**: ${m.member} CLI is not installed or not in PATH`);
    } else {
      lines.push(`> Status: ${m.state}`);
    }
    lines.push('');
  }

  // Synthesis prompt (guide for the host agent)
  if (sections && sections.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Synthesis Guide');
    lines.push('');
    lines.push('Based on the template, synthesize the above responses into these sections:');
    lines.push('');
    for (const section of sections) {
      // Handle both string and object formats
      if (typeof section === 'string') {
        const sectionTitle = section.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        lines.push(`- **${sectionTitle}**`);
      } else if (section && typeof section === 'object') {
        const header = section.header || section.name || 'Unknown Section';
        const desc = section.description || '';
        lines.push(`- **${header.replace(/^#+\s*/, '')}**${desc ? `: ${desc}` : ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getStateEmoji(state) {
  switch (state) {
    case 'done': return '✅';
    case 'error': return '❌';
    case 'timed_out': return '⏱️';
    case 'missing_cli': return '⚠️';
    case 'running': return '🔄';
    case 'queued': return '⏳';
    default: return '❓';
  }
}

// Extract useful output from stderr (for CLIs like codex that log verbosely)
function extractUsefulOutput(stderr) {
  if (!stderr) return null;

  const lines = stderr.split('\n');
  const usefulLines = [];
  let skipUntilSeparator = true; // Skip prompt section at the start
  let separatorCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip codex-specific noise
    if (line.includes('codex_core::codex') ||
        line.includes('mcp startup') ||
        line.match(/^\d{4}-\d{2}-\d{2}T/) ||
        line.match(/succeeded in \d+ms/) ||
        line.match(/^ in \/.*$/)) {
      continue;
    }

    // Track separators to skip the initial prompt section
    if (line.startsWith('---')) {
      separatorCount++;
      // After 2nd separator (end of prompt), start capturing
      if (separatorCount >= 2) {
        skipUntilSeparator = false;
      }
      continue;
    }

    // Skip the prompt section
    if (skipUntilSeparator) continue;

    // Skip codex thinking/exec blocks and file listings
    if (line.startsWith('thinking') ||
        line.startsWith('exec') ||
        line.match(/^\/bin\/(bash|zsh)/) ||
        line.match(/^\s+\d+\t/) ||  // Line-numbered output (nl -ba)
        line.match(/^[a-zA-Z0-9_-]+\.(md|js|yaml|json|txt|sh)$/) || // Single filename
        line.match(/^(README|LICENSE|Makefile|package|node_modules|scripts|commands|templates)/) ||
        line.trim() === '') {
      continue;
    }

    // Look for actual review content (markdown headers, bullets, bold text)
    if (line.startsWith('## ') ||
        line.startsWith('### ') ||
        line.startsWith('- ') ||
        line.startsWith('* ') ||
        line.match(/^\d+\./) ||
        line.match(/^\*\*.*\*\*/) ||
        line.startsWith('|') ||  // Tables
        line.startsWith('>')) {  // Blockquotes
      usefulLines.push(line);
    }
  }

  const result = usefulLines.join('\n').trim();
  // Only return if we have substantial content (at least a header + some content)
  return result.length > MIN_USEFUL_OUTPUT_LEN && result.includes('##') ? result : null;
}

function exitWithError(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function resolveDefaultConfigFile() {
  if (fs.existsSync(SKILL_CONFIG_FILE)) return SKILL_CONFIG_FILE;
  if (fs.existsSync(REPO_CONFIG_FILE)) return REPO_CONFIG_FILE;
  return SKILL_CONFIG_FILE;
}

function detectHostRole() {
  const normalized = SKILL_DIR.replace(/\\/g, '/');
  if (normalized.includes('/.claude/skills/')) return 'claude';
  if (normalized.includes('/.codex/skills/')) return 'codex';
  return 'unknown';
}

function normalizeBool(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return null;
}

function resolveAutoRole(role, hostRole) {
  const roleLc = String(role || '').trim().toLowerCase();
  if (roleLc && roleLc !== 'auto') return roleLc;
  if (hostRole === 'codex') return 'codex';
  if (hostRole === 'claude') return 'claude';
  return 'claude';
}

function parseCouncilConfig(configPath) {
  const fallback = {
    council: {
      chairman: { role: 'auto' },
      members: [
        { name: 'claude', command: 'claude -p', emoji: '🧠', color: 'CYAN' },
        { name: 'codex', command: 'codex exec', emoji: '🤖', color: 'BLUE' },
        { name: 'gemini', command: 'gemini', emoji: '💎', color: 'GREEN' },
      ],
      settings: { exclude_chairman_from_members: true, timeout: 120 },
    },
  };

  if (!fs.existsSync(configPath)) return fallback;

  let YAML;
  try {
    YAML = require('yaml');
  } catch {
    exitWithError(
      [
        'Missing runtime dependency: yaml',
        'Your Agent Council installation is out of date.',
        'Reinstall from your project root:',
        '  npx github:team-attention/agent-council --target auto',
      ].join('\n')
    );
  }

  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    exitWithError(`Invalid YAML in ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    exitWithError(`Invalid config in ${configPath}: expected a YAML mapping/object at the document root`);
  }
  if (!parsed.council) {
    exitWithError(`Invalid config in ${configPath}: missing required top-level key 'council:'`);
  }
  if (typeof parsed.council !== 'object' || Array.isArray(parsed.council)) {
    exitWithError(`Invalid config in ${configPath}: 'council' must be a mapping/object`);
  }

  const merged = {
    council: {
      chairman: { ...fallback.council.chairman },
      members: Array.isArray(fallback.council.members) ? [...fallback.council.members] : [],
      settings: { ...fallback.council.settings },
    },
  };

  const council = parsed.council;

  if (council.chairman != null) {
    if (typeof council.chairman !== 'object' || Array.isArray(council.chairman)) {
      exitWithError(`Invalid config in ${configPath}: 'council.chairman' must be a mapping/object`);
    }
    merged.council.chairman = { ...merged.council.chairman, ...council.chairman };
  }

  if (Object.prototype.hasOwnProperty.call(council, 'members')) {
    if (!Array.isArray(council.members)) {
      exitWithError(`Invalid config in ${configPath}: 'council.members' must be a list/array`);
    }
    merged.council.members = council.members;
  }

  if (council.settings != null) {
    if (typeof council.settings !== 'object' || Array.isArray(council.settings)) {
      exitWithError(`Invalid config in ${configPath}: 'council.settings' must be a mapping/object`);
    }
    merged.council.settings = { ...merged.council.settings, ...council.settings };
  }

  return merged;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeFileName(name) {
  const cleaned = String(name || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return cleaned || 'member';
}

function atomicWriteJson(filePath, payload) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function atomicWriteText(filePath, content) {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmpPath, String(content), 'utf8');
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

function sleepMs(ms) {
  const msNum = Number(ms);
  if (!Number.isFinite(msNum) || msNum <= 0) return;
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, Math.trunc(msNum));
}

function computeTerminalDoneCount(counts) {
  const c = counts || {};
  return (
    Number(c.done || 0) +
    Number(c.missing_cli || 0) +
    Number(c.error || 0) +
    Number(c.timed_out || 0) +
    Number(c.canceled || 0)
  );
}

function asCodexStepStatus(value) {
  const v = String(value || '');
  if (v === 'pending' || v === 'in_progress' || v === 'completed') return v;
  return 'pending';
}

function buildCouncilUiPayload(statusPayload) {
  const counts = statusPayload.counts || {};
  const done = computeTerminalDoneCount(counts);
  const total = Number(counts.total || 0);
  const isDone = String(statusPayload.overallState || '') === 'done';

  const queued = Number(counts.queued || 0);
  const running = Number(counts.running || 0);

  const members = Array.isArray(statusPayload.members) ? statusPayload.members : [];
  const sortedMembers = members
    .map((m) => ({
      member: m && m.member != null ? String(m.member) : '',
      state: m && m.state != null ? String(m.state) : 'unknown',
      exitCode: m && m.exitCode != null ? m.exitCode : null,
    }))
    .filter((m) => m.member)
    .sort((a, b) => a.member.localeCompare(b.member));

  const terminalStates = new Set(['done', 'missing_cli', 'error', 'timed_out', 'canceled']);
  // Keep the Plan UI visible by ensuring exactly one `in_progress` item while work remains.
  const dispatchStatus = asCodexStepStatus(isDone ? 'completed' : queued > 0 ? 'in_progress' : 'completed');
  let hasInProgress = dispatchStatus === 'in_progress';

  const memberSteps = sortedMembers.map((m) => {
    const state = m.state || 'unknown';
    const isTerminal = terminalStates.has(state);

    let status;
    if (isTerminal) {
      status = 'completed';
    } else if (!hasInProgress && running > 0 && state === 'running') {
      status = 'in_progress';
      hasInProgress = true;
    } else {
      status = 'pending';
    }

    const label = `[Council] Ask ${m.member}`;
    return { label, status: asCodexStepStatus(status) };
  });

  // Once members are done, the host agent should synthesize and then mark this step completed.
  const synthStatus = asCodexStepStatus(isDone ? (hasInProgress ? 'pending' : 'in_progress') : 'pending');

  const codexPlan = [
    { step: `[Council] Prompt dispatch`, status: dispatchStatus },
    ...memberSteps.map((s) => ({ step: s.label, status: s.status })),
    { step: `[Council] Synthesize`, status: synthStatus },
  ];

  const claudeTodos = [
    {
      content: `[Council] Prompt dispatch`,
      status: dispatchStatus,
      activeForm: dispatchStatus === 'completed' ? 'Dispatched council prompts' : 'Dispatching council prompts',
    },
    ...memberSteps.map((s) => ({
      content: s.label,
      status: s.status,
      activeForm: s.status === 'completed' ? 'Finished' : 'Awaiting response',
    })),
    {
      content: `[Council] Synthesize`,
      status: synthStatus,
      activeForm:
        synthStatus === 'completed'
          ? 'Council results ready'
          : synthStatus === 'in_progress'
            ? 'Ready to synthesize'
            : 'Waiting to synthesize',
    },
  ];

  return {
    progress: { done, total, overallState: String(statusPayload.overallState || '') },
    codex: { update_plan: { plan: codexPlan } },
    claude: { todo_write: { todos: claudeTodos } },
  };
}

function computeStatusPayload(jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  if (!fs.existsSync(resolvedJobDir)) exitWithError(`jobDir not found: ${resolvedJobDir}`);

  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  if (!jobMeta) exitWithError(`job.json not found: ${path.join(resolvedJobDir, 'job.json')}`);

  const membersRoot = path.join(resolvedJobDir, 'members');
  if (!fs.existsSync(membersRoot)) exitWithError(`members folder not found: ${membersRoot}`);

  const members = [];
  for (const entry of fs.readdirSync(membersRoot)) {
    const statusPath = path.join(membersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (status) members.push({ safeName: entry, ...status });
  }

  const totals = { queued: 0, running: 0, done: 0, error: 0, missing_cli: 0, timed_out: 0, canceled: 0 };
  for (const m of members) {
    const state = String(m.state || 'unknown');
    if (Object.prototype.hasOwnProperty.call(totals, state)) totals[state]++;
  }

  const allDone = totals.running === 0 && totals.queued === 0;
  const overallState = allDone ? 'done' : totals.running > 0 ? 'running' : 'queued';

  return {
    jobDir: resolvedJobDir,
    id: jobMeta.id || null,
    chairmanRole: jobMeta.chairmanRole || null,
    overallState,
    counts: { total: members.length, ...totals },
    members: members
      .map((m) => ({
        member: m.member,
        state: m.state,
        startedAt: m.startedAt || null,
        finishedAt: m.finishedAt || null,
        exitCode: m.exitCode != null ? m.exitCode : null,
        message: m.message || null,
      }))
      .sort((a, b) => String(a.member).localeCompare(String(b.member))),
  };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const out = { _: [] };
  const booleanFlags = new Set([
    'json',
    'text',
    'checklist',
    'help',
    'h',
    'verbose',
    'include-chairman',
    'exclude-chairman',
    'no-cache',
    'quiet',
    'debug',
    'show-stats',
  ]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      out._.push(...args.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }

    const [key, rawValue] = a.split('=', 2);
    if (rawValue != null) {
      out[key.slice(2)] = rawValue;
      continue;
    }

    const normalizedKey = key.slice(2);
    if (booleanFlags.has(normalizedKey)) {
      out[normalizedKey] = true;
      continue;
    }

    const next = args[i + 1];
    if (next == null || next.startsWith('--')) {
      out[normalizedKey] = true;
      continue;
    }
    out[normalizedKey] = next;
    i++;
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Agent Council (job mode)

Usage:
  council-job.sh start [--config path] [--chairman auto|claude|codex|...] [--jobs-dir path] [--json] [--no-cache] [--scenario NAME] [--debug] "question"
  council-job.sh status [--json|--text|--checklist] [--verbose] <jobDir>
  council-job.sh wait [--cursor CURSOR] [--bucket auto|N] [--interval-ms N] [--timeout-ms N] [--quiet] <jobDir>
  council-job.sh results [--json] [--output FILE] <jobDir>
  council-job.sh stop <jobDir>
  council-job.sh clean <jobDir>

Cache Management:
  council-job.sh cache list [--json]              List cached results
  council-job.sh cache clear [KEY]                Clear all or specific cache
  council-job.sh cache export KEY [--output FILE] Export cached result to file

Options:
  --no-cache       Skip cache lookup and run fresh query
  --quiet          Suppress progress output during wait
  --scenario NAME  Use specific role template (code-review, architecture, etc.)
  --output FILE    Export results to file (default: stdout)
  --debug          Enable debug logging

Features:
  - Automatic caching: Similar queries return cached results (24h TTL)
  - Real-time progress: Shows completion status during wait
  - Graceful fallback: Partial results shown even if some CLIs fail
  - Result export: Save results as markdown or JSON

Notes:
  - start returns immediately and runs members in parallel via detached Node workers
  - poll status with repeated short calls to update TODO/plan UIs in host agents
  - wait prints JSON by default and blocks until meaningful progress occurs
`);
}

function cmdStart(options, prompt) {
  // Record start time for stats
  jobStats.startTime = new Date().toISOString();

  // Security: Check for sensitive file references
  const sensitiveWarnings = checkSensitiveFiles(prompt);
  if (sensitiveWarnings.length > 0) {
    process.stderr.write(`\n${COLORS.yellow}⚠ Security Warning${COLORS.reset}\n`);
    for (const warn of sensitiveWarnings) {
      process.stderr.write(`  ${COLORS.yellow}!${COLORS.reset} ${warn}\n`);
    }
    process.stderr.write(`  Consider removing sensitive file references from your prompt.\n\n`);
  }

  // Security: Mask sensitive content in prompt
  const { masked: safePrompt, maskedCount } = maskSensitiveContent(prompt);
  if (maskedCount > 0) {
    process.stderr.write(`${COLORS.green}✓${COLORS.reset} Masked ${maskedCount} sensitive value(s) in prompt\n`);
    debug('Original prompt contained sensitive values that were masked');
  }

  const configPath = options.config || process.env.COUNCIL_CONFIG || resolveDefaultConfigFile();
  const jobsDir =
    options['jobs-dir'] || process.env.COUNCIL_JOBS_DIR || path.join(SKILL_DIR, '.jobs');

  ensureDir(jobsDir);

  const hostRole = detectHostRole();
  const config = parseCouncilConfig(configPath);
  const chairmanRoleRaw = options.chairman || process.env.COUNCIL_CHAIRMAN || config.council.chairman.role || 'auto';
  const chairmanRole = resolveAutoRole(chairmanRoleRaw, hostRole);

  // Load scenario template for role-based prompting
  let scenarioName = options.scenario || process.env.COUNCIL_SCENARIO || null;

  // Auto-detect scenario if --scenario=auto is specified
  if (scenarioName === 'auto') {
    const detection = detectScenario(safePrompt);
    if (detection.detected) {
      scenarioName = detection.detected;
      const emoji = getScenarioEmoji(scenarioName);
      const category = SCENARIO_PATTERNS[scenarioName]?.category || 'general';
      const description = SCENARIO_PATTERNS[scenarioName]?.description || scenarioName;
      process.stderr.write(`\n${COLORS.cyan}🤖 Smart Council Routing${COLORS.reset}\n`);
      process.stderr.write(`   ${emoji} Detected: ${COLORS.bold}${description}${COLORS.reset} (${category})\n`);
      process.stderr.write(`   ${COLORS.dim}Confidence: ${detection.confidence}${COLORS.reset}\n`);
      process.stderr.write(`   ${COLORS.dim}Using scenario: ${scenarioName}${COLORS.reset}\n\n`);
      debug('Auto-detected scenario', detection);
    } else {
      process.stderr.write(`\n${COLORS.yellow}🤖 Smart Council${COLORS.reset}\n`);
      process.stderr.write(`   ${COLORS.dim}No specific scenario detected, using general council${COLORS.reset}\n\n`);
      scenarioName = null;
    }
  }

  const scenarioTemplate = loadScenarioTemplate(scenarioName);

  // Check cache (unless --no-cache is specified)
  const useCache = !options['no-cache'];
  if (useCache) {
    const cacheKey = getCacheKey(safePrompt, scenarioName);
    const cached = readCache(cacheKey);
    if (cached) {
      // Return cache info for host to ask user
      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          cacheHit: true,
          cacheKey,
          cached: {
            timestamp: cached.timestamp,
            jobDir: cached.jobDir,
            memberCount: cached.memberCount,
            preview: cached.preview
          },
          message: 'Cached result found. Use --no-cache to run fresh query.'
        }, null, 2)}\n`);
      } else {
        process.stdout.write(`CACHE_HIT:${cached.jobDir}\n`);
        process.stderr.write(`${COLORS.yellow}⚡ Cached result found${COLORS.reset} (${cached.timestamp})\n`);
        process.stderr.write(`   ${cached.memberCount} members responded\n`);
        process.stderr.write(`   Use --no-cache to run a fresh query\n`);
      }
      return;
    }
  }

  // Normalize CLI boolean flags for consistent handling of --flag, --flag=true, --flag=false
  const includeChairmanFlag = normalizeBool(options['include-chairman']);
  const excludeChairmanFlag = normalizeBool(options['exclude-chairman']);

  // Determine chairman exclusion: CLI flags override config
  const excludeSetting = normalizeBool(config.council.settings.exclude_chairman_from_members);
  let excludeChairmanFromMembers = excludeSetting != null ? excludeSetting : true; // default: exclude
  if (excludeChairmanFlag === true) excludeChairmanFromMembers = true;
  if (includeChairmanFlag === true) excludeChairmanFromMembers = false;

  const timeoutSetting = Number(config.council.settings.timeout || 0);
  const timeoutOverride = options.timeout != null ? Number(options.timeout) : null;
  const timeoutSec = Number.isFinite(timeoutOverride) && timeoutOverride > 0 ? timeoutOverride : timeoutSetting > 0 ? timeoutSetting : 0;

  const requestedMembers = config.council.members || [];
  const members = requestedMembers.filter((m) => {
    if (!m || !m.name || !m.command) return false;
    const nameLc = String(m.name).toLowerCase();
    if (excludeChairmanFromMembers && nameLc === chairmanRole) return false;
    return true;
  });

  const jobId = `${new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15)}-${crypto
    .randomBytes(3)
    .toString('hex')}`;
  const jobDir = path.join(jobsDir, `council-${jobId}`);
  const membersDir = path.join(jobDir, 'members');
  ensureDir(membersDir);

  // Save masked prompt (sensitive values redacted) - atomic write for crash safety
  atomicWriteText(path.join(jobDir, 'prompt.txt'), safePrompt);

  // Get role names for job metadata
  const roleNames = scenarioTemplate && scenarioTemplate.roles
    ? scenarioTemplate.roles.map(r => r.name || r.id)
    : [];

  const jobMeta = {
    id: `council-${jobId}`,
    createdAt: new Date().toISOString(),
    configPath,
    hostRole,
    chairmanRole,
    scenario: scenarioName || null,
    settings: {
      excludeChairmanFromMembers,
      timeoutSec: timeoutSec || null,
    },
    members: members.map((m, idx) => ({
      name: String(m.name),
      command: String(m.command),
      emoji: m.emoji ? String(m.emoji) : null,
      color: m.color ? String(m.color) : null,
      role: roleNames[idx % roleNames.length] || null,
    })),
  };
  atomicWriteJson(path.join(jobDir, 'job.json'), jobMeta);

  for (let memberIndex = 0; memberIndex < members.length; memberIndex++) {
    const member = members[memberIndex];
    const name = String(member.name);
    const safeName = safeFileName(name);
    const memberDir = path.join(membersDir, safeName);
    ensureDir(memberDir);

    // Build role-enhanced prompt for this member (using masked prompt)
    const enhancedPrompt = buildRoleEnhancedPrompt(safePrompt, scenarioTemplate, memberIndex);

    // Save member-specific prompt - atomic write for crash safety
    atomicWriteText(path.join(memberDir, 'prompt.txt'), enhancedPrompt);

    const roleName = roleNames[memberIndex % roleNames.length] || null;
    atomicWriteJson(path.join(memberDir, 'status.json'), {
      member: name,
      role: roleName,
      state: 'queued',
      queuedAt: new Date().toISOString(),
      command: String(member.command),
    });

    const workerArgs = [
      WORKER_PATH,
      '--job-dir',
      jobDir,
      '--member',
      name,
      '--safe-member',
      safeName,
      '--command',
      String(member.command),
      '--use-member-prompt', // Use member-specific prompt file
    ];
    if (timeoutSec && Number.isFinite(timeoutSec) && timeoutSec > 0) {
      workerArgs.push('--timeout', String(timeoutSec));
    }
    // Pass fallback command for rate limit retry
    if (member.fallback && config.council.settings.retry_on_rate_limit) {
      workerArgs.push('--fallback', String(member.fallback));
    }

    const child = spawn(process.execPath, workerArgs, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
      shell: false, // Disable shell interpretation
    });
    child.unref();
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ jobDir, ...jobMeta }, null, 2)}\n`);
  } else {
    process.stdout.write(`${jobDir}\n`);
  }
}

function cmdStatus(options, jobDir) {
  const payload = computeStatusPayload(jobDir);

  const wantChecklist = Boolean(options.checklist) && !options.json;
  if (wantChecklist) {
    const done = computeTerminalDoneCount(payload.counts);
    const headerId = payload.id ? ` (${payload.id})` : '';
    process.stdout.write(`Agent Council${headerId}\n`);
    process.stdout.write(
      `Progress: ${done}/${payload.counts.total} done  (running ${payload.counts.running}, queued ${payload.counts.queued})\n`
    );
    for (const m of payload.members) {
      const state = String(m.state || '');
      const mark =
        state === 'done'
          ? '[x]'
          : state === 'running' || state === 'queued'
            ? '[ ]'
            : state
              ? '[!]'
              : '[ ]';
      const exitInfo = m.exitCode != null ? ` (exit ${m.exitCode})` : '';
      process.stdout.write(`${mark} ${m.member} — ${state}${exitInfo}\n`);
    }
    return;
  }

  const wantText = Boolean(options.text) && !options.json;
  if (wantText) {
    const done = computeTerminalDoneCount(payload.counts);
    process.stdout.write(`members ${done}/${payload.counts.total} done; running=${payload.counts.running} queued=${payload.counts.queued}\n`);
    if (options.verbose) {
      for (const m of payload.members) {
        process.stdout.write(`- ${m.member}: ${m.state}${m.exitCode != null ? ` (exit ${m.exitCode})` : ''}\n`);
      }
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseWaitCursor(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parts = raw.split(':');
  const version = parts[0];
  if (version === 'v1' && parts.length === 4) {
    const bucketSize = Number(parts[1]);
    const doneBucket = Number(parts[2]);
    const isDone = parts[3] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket: 0, doneBucket, isDone };
  }
  if (version === 'v2' && parts.length === 5) {
    const bucketSize = Number(parts[1]);
    const dispatchBucket = Number(parts[2]);
    const doneBucket = Number(parts[3]);
    const isDone = parts[4] === '1';
    if (!Number.isFinite(bucketSize) || bucketSize <= 0) return null;
    if (!Number.isFinite(dispatchBucket) || dispatchBucket < 0) return null;
    if (!Number.isFinite(doneBucket) || doneBucket < 0) return null;
    return { version, bucketSize, dispatchBucket, doneBucket, isDone };
  }
  return null;
}

function formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone) {
  return `v2:${bucketSize}:${dispatchBucket}:${doneBucket}:${isDone ? 1 : 0}`;
}

function asWaitPayload(statusPayload) {
  const members = Array.isArray(statusPayload.members) ? statusPayload.members : [];
  return {
    jobDir: statusPayload.jobDir,
    id: statusPayload.id,
    chairmanRole: statusPayload.chairmanRole,
    overallState: statusPayload.overallState,
    counts: statusPayload.counts,
    members: members.map((m) => ({
      member: m.member,
      state: m.state,
      exitCode: m.exitCode != null ? m.exitCode : null,
      message: m.message || null,
    })),
    ui: buildCouncilUiPayload(statusPayload),
  };
}

function resolveBucketSize(options, total, prevCursor) {
  const raw = options.bucket != null ? options.bucket : options['bucket-size'];

  if (raw == null || raw === true) {
    if (prevCursor && prevCursor.bucketSize) return prevCursor.bucketSize;
  } else {
    const asString = String(raw).trim().toLowerCase();
    if (asString !== 'auto') {
      const num = Number(asString);
      if (!Number.isFinite(num) || num <= 0) exitWithError(`wait: invalid --bucket: ${raw}`);
      return Math.trunc(num);
    }
  }

  // Auto-bucket: target ~5 updates total.
  const totalNum = Number(total || 0);
  if (!Number.isFinite(totalNum) || totalNum <= 0) return 1;
  return Math.max(1, Math.ceil(totalNum / 5));
}

function cmdWait(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const cursorFilePath = path.join(resolvedJobDir, '.wait_cursor');
  const prevCursorRaw =
    options.cursor != null
      ? String(options.cursor)
      : fs.existsSync(cursorFilePath)
        ? String(fs.readFileSync(cursorFilePath, 'utf8')).trim()
        : '';
  const prevCursor = parseWaitCursor(prevCursorRaw);

  const intervalMsRaw = options['interval-ms'] != null ? options['interval-ms'] : 250;
  const intervalMs = Math.max(50, Math.trunc(Number(intervalMsRaw)));
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) exitWithError(`wait: invalid --interval-ms: ${intervalMsRaw}`);

  const timeoutMsRaw = options['timeout-ms'] != null ? options['timeout-ms'] : 0;
  const timeoutMs = Math.trunc(Number(timeoutMsRaw));
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) exitWithError(`wait: invalid --timeout-ms: ${timeoutMsRaw}`);

  // Always read once to decide bucket sizing and (when no cursor is given) return immediately.
  let payload = computeStatusPayload(jobDir);
  const bucketSize = resolveBucketSize(options, payload.counts.total, prevCursor);

  const doneCount = computeTerminalDoneCount(payload.counts);
  const isDone = payload.overallState === 'done';
  const total = Number(payload.counts.total || 0);
  const queued = Number(payload.counts.queued || 0);
  const dispatchBucket = queued === 0 && total > 0 ? 1 : 0;
  const doneBucket = Math.floor(doneCount / bucketSize);
  const cursor = formatWaitCursor(bucketSize, dispatchBucket, doneBucket, isDone);

  if (!prevCursor) {
    atomicWriteText(cursorFilePath, cursor);
    process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor }, null, 2)}\n`);
    return;
  }

  const start = Date.now();
  const showProgress = !options.quiet && process.stderr.isTTY;
  let lastProgressUpdate = 0;

  while (cursor === prevCursorRaw) {
    if (timeoutMs > 0 && Date.now() - start >= timeoutMs) break;
    sleepMs(intervalMs);
    payload = computeStatusPayload(jobDir);

    // Show progress update (throttled)
    if (showProgress && Date.now() - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
      printProgressUpdate(payload.members, payload.counts.total);
      lastProgressUpdate = Date.now();
    }

    const d = computeTerminalDoneCount(payload.counts);
    const doneFlag = payload.overallState === 'done';
    const totalCount = Number(payload.counts.total || 0);
    const queuedCount = Number(payload.counts.queued || 0);
    const dispatchB = queuedCount === 0 && totalCount > 0 ? 1 : 0;
    const doneB = Math.floor(d / bucketSize);
    const nextCursor = formatWaitCursor(bucketSize, dispatchB, doneB, doneFlag);
    if (nextCursor !== prevCursorRaw) {
      if (showProgress) process.stderr.write('\n'); // Clear progress line
      atomicWriteText(cursorFilePath, nextCursor);
      process.stdout.write(`${JSON.stringify({ ...asWaitPayload(payload), cursor: nextCursor }, null, 2)}\n`);
      return;
    }
  }

  if (showProgress) process.stderr.write('\n'); // Clear progress line

  // Timeout: return current state (cursor may be unchanged).
  const finalPayload = computeStatusPayload(jobDir);
  const finalDone = computeTerminalDoneCount(finalPayload.counts);
  const finalDoneFlag = finalPayload.overallState === 'done';
  const finalTotal = Number(finalPayload.counts.total || 0);
  const finalQueued = Number(finalPayload.counts.queued || 0);
  const finalDispatchBucket = finalQueued === 0 && finalTotal > 0 ? 1 : 0;
  const finalDoneBucket = Math.floor(finalDone / bucketSize);
  const finalCursor = formatWaitCursor(bucketSize, finalDispatchBucket, finalDoneBucket, finalDoneFlag);
  atomicWriteText(cursorFilePath, finalCursor);
  process.stdout.write(`${JSON.stringify({ ...asWaitPayload(finalPayload), cursor: finalCursor }, null, 2)}\n`);
}

function cmdResults(options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const jobMeta = readJsonIfExists(path.join(resolvedJobDir, 'job.json'));
  const membersRoot = path.join(resolvedJobDir, 'members');
  const promptPath = path.join(resolvedJobDir, 'prompt.txt');
  const prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8') : '';

  const members = [];
  if (fs.existsSync(membersRoot)) {
    for (const entry of fs.readdirSync(membersRoot)) {
      const statusPath = path.join(membersRoot, entry, 'status.json');
      const outputPath = path.join(membersRoot, entry, 'output.txt');
      const errorPath = path.join(membersRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      members.push({ safeName: entry, ...status, output, stderr });
    }
  }

  // Sort members by name
  const sortedMembers = members.sort((a, b) => String(a.member).localeCompare(String(b.member)));

  // Record stats and detect rate limits
  jobStats.endTime = new Date().toISOString();
  for (const m of sortedMembers) {
    const startTime = m.startedAt ? new Date(m.startedAt) : null;
    const endTime = m.finishedAt ? new Date(m.finishedAt) : null;
    const duration = startTime && endTime ? ((endTime - startTime) / 1000).toFixed(1) : null;

    recordMemberStats(m.member, {
      state: m.state,
      duration,
    });

    // Detect rate limits from stderr
    if (m.stderr && (m.stderr.includes('429') || m.stderr.includes('rate') || m.stderr.includes('RESOURCE_EXHAUSTED'))) {
      recordRateLimit(m.member, m.stderr.slice(0, 500));
    }
  }

  // Calculate success metrics for graceful fallback
  const successfulMembers = sortedMembers.filter(m => m.state === 'done');
  const failedMembers = sortedMembers.filter(m => ['error', 'missing_cli', 'timed_out'].includes(m.state));
  const fallbackMembers = sortedMembers.filter(m => m.usedFallback);
  const totalMembers = sortedMembers.length;

  // Show fallback usage
  if (fallbackMembers.length > 0) {
    process.stderr.write(`\n${COLORS.magenta}↻ Fallback model used${COLORS.reset}\n`);
    for (const m of fallbackMembers) {
      const status = m.state === 'done' ? `${COLORS.green}✓${COLORS.reset}` : `${COLORS.red}✗${COLORS.reset}`;
      process.stderr.write(`  ${status} ${m.member}: ${m.message || 'Switched to fallback model'}\n`);
    }
    process.stderr.write(`\n`);
  }

  // Graceful fallback: warn but continue if some members failed
  if (failedMembers.length > 0 && successfulMembers.length > 0) {
    process.stderr.write(`\n${COLORS.yellow}⚠ Partial results available${COLORS.reset}\n`);
    process.stderr.write(`  ${COLORS.green}✓ ${successfulMembers.length}${COLORS.reset} of ${totalMembers} members responded\n`);
    for (const m of failedMembers) {
      const reason = m.state === 'missing_cli' ? 'CLI not installed'
        : m.state === 'timed_out' ? 'timed out'
        : m.message || 'error';
      process.stderr.write(`  ${COLORS.red}✗ ${m.member}${COLORS.reset}: ${reason}\n`);
    }
    process.stderr.write(`\n`);
  } else if (successfulMembers.length === 0) {
    process.stderr.write(`\n${COLORS.red}✗ No members responded successfully${COLORS.reset}\n`);
    for (const m of failedMembers) {
      const reason = m.state === 'missing_cli' ? 'CLI not installed'
        : m.state === 'timed_out' ? 'timed out'
        : m.message || 'error';
      process.stderr.write(`  ${COLORS.red}✗ ${m.member}${COLORS.reset}: ${reason}\n`);
    }
    process.stderr.write(`\n`);
  }

  // Save to cache if we have successful results
  if (successfulMembers.length > 0 && prompt) {
    const scenarioName = jobMeta ? jobMeta.scenario : null;
    const cacheKey = getCacheKey(prompt, scenarioName);
    writeCache(cacheKey, resolvedJobDir, prompt, scenarioName, successfulMembers);
  }

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          jobDir: resolvedJobDir,
          id: jobMeta ? jobMeta.id : null,
          scenario: jobMeta ? jobMeta.scenario : null,
          prompt: fs.existsSync(path.join(resolvedJobDir, 'prompt.txt'))
            ? fs.readFileSync(path.join(resolvedJobDir, 'prompt.txt'), 'utf8')
            : null,
          members: sortedMembers
            .map((m) => ({
              member: m.member,
              role: m.role || null,
              state: m.state,
              exitCode: m.exitCode != null ? m.exitCode : null,
              message: m.message || null,
              usedFallback: m.usedFallback || false,
              output: m.output,
              stderr: m.stderr,
            })),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  // Load scenario template for structured output (silent mode - no warnings)
  const scenarioName = jobMeta ? jobMeta.scenario : null;
  const template = scenarioName ? loadScenarioTemplate(scenarioName, true) : null;

  // Use structured output formatter
  const structuredOutput = formatStructuredOutput(sortedMembers, jobMeta || {}, template);

  // Export to file if --output is specified
  if (options.output) {
    const resolvedPath = exportResults(structuredOutput, options.output);
    process.stdout.write(`${COLORS.green}✓${COLORS.reset} Results exported to: ${resolvedPath}\n`);
  } else {
    process.stdout.write(structuredOutput);
    process.stdout.write('\n');
  }

  // Print stats if enabled (--show-stats or --debug)
  printStats();
}

function cmdStop(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  const membersRoot = path.join(resolvedJobDir, 'members');
  if (!fs.existsSync(membersRoot)) exitWithError(`No members folder found: ${membersRoot}`);

  let stoppedAny = false;
  for (const entry of fs.readdirSync(membersRoot)) {
    const statusPath = path.join(membersRoot, entry, 'status.json');
    const status = readJsonIfExists(statusPath);
    if (!status) continue;
    if (status.state !== 'running') continue;
    if (!status.pid) continue;

    try {
      process.kill(Number(status.pid), 'SIGTERM');
      stoppedAny = true;
    } catch {
      // ignore
    }
  }

  process.stdout.write(stoppedAny ? 'stop: sent SIGTERM to running members\n' : 'stop: no running members\n');
}

function cmdClean(_options, jobDir) {
  const resolvedJobDir = path.resolve(jobDir);
  fs.rmSync(resolvedJobDir, { recursive: true, force: true });
  process.stdout.write(`cleaned: ${resolvedJobDir}\n`);
}

// Cache management commands
function cmdCacheList(options) {
  const entries = listCacheEntries();

  if (options.json) {
    process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    return;
  }

  if (entries.length === 0) {
    process.stdout.write(`${COLORS.dim}No cached results found${COLORS.reset}\n`);
    return;
  }

  process.stdout.write(`${COLORS.bold}Cached Results${COLORS.reset} (${entries.length} entries)\n\n`);
  process.stdout.write(`${'KEY'.padEnd(18)} ${'AGE'.padEnd(10)} ${'MEMBERS'.padEnd(8)} PROMPT\n`);
  process.stdout.write(`${'-'.repeat(18)} ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(40)}\n`);

  for (const entry of entries) {
    const ageStr = entry.age < 60 ? `${entry.age}m` : `${Math.round(entry.age / 60)}h`;
    const expiredMark = entry.isExpired ? ` ${COLORS.red}(expired)${COLORS.reset}` : '';
    const promptPreview = (entry.prompt || '').slice(0, 40).replace(/\n/g, ' ');
    process.stdout.write(`${entry.key.padEnd(18)} ${ageStr.padEnd(10)} ${String(entry.memberCount).padEnd(8)} ${promptPreview}${expiredMark}\n`);
  }
}

function cmdCacheClear(options, cacheKey) {
  const cleared = clearCache(cacheKey || null);

  if (cacheKey) {
    if (cleared > 0) {
      process.stdout.write(`${COLORS.green}✓${COLORS.reset} Cleared cache entry: ${cacheKey}\n`);
    } else {
      process.stdout.write(`${COLORS.yellow}⚠${COLORS.reset} Cache entry not found: ${cacheKey}\n`);
    }
  } else {
    process.stdout.write(`${COLORS.green}✓${COLORS.reset} Cleared ${cleared} cache entries\n`);
  }
}

function cmdCacheExport(options, cacheKey) {
  if (!cacheKey) {
    exitWithError('cache export: missing cache key');
  }

  const cached = readCache(cacheKey);
  if (!cached) {
    exitWithError(`Cache entry not found or expired: ${cacheKey}`);
  }

  // Check if jobDir still exists
  if (!cached.jobDir || !fs.existsSync(cached.jobDir)) {
    exitWithError(`Cached job directory no longer exists: ${cached.jobDir}`);
  }

  // Use cmdResults to generate output, then export if needed
  const outputPath = options.output;

  // Generate results from cached jobDir
  const membersRoot = path.join(cached.jobDir, 'members');
  const jobMeta = readJsonIfExists(path.join(cached.jobDir, 'job.json'));

  const members = [];
  if (fs.existsSync(membersRoot)) {
    for (const entry of fs.readdirSync(membersRoot)) {
      const statusPath = path.join(membersRoot, entry, 'status.json');
      const outputFilePath = path.join(membersRoot, entry, 'output.txt');
      const errorPath = path.join(membersRoot, entry, 'error.txt');
      const status = readJsonIfExists(statusPath);
      if (!status) continue;
      const output = fs.existsSync(outputFilePath) ? fs.readFileSync(outputFilePath, 'utf8') : '';
      const stderr = fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : '';
      members.push({ safeName: entry, ...status, output, stderr });
    }
  }

  const sortedMembers = members.sort((a, b) => String(a.member).localeCompare(String(b.member)));
  const scenarioName = jobMeta ? jobMeta.scenario : null;
  const template = scenarioName ? loadScenarioTemplate(scenarioName, true) : null;
  const structuredOutput = formatStructuredOutput(sortedMembers, jobMeta || {}, template);

  if (outputPath) {
    const resolvedPath = exportResults(structuredOutput, outputPath);
    process.stdout.write(`${COLORS.green}✓${COLORS.reset} Exported to: ${resolvedPath}\n`);
  } else {
    process.stdout.write(structuredOutput);
    process.stdout.write('\n');
  }
}

function main() {
  const options = parseArgs(process.argv);
  const [command, ...rest] = options._;

  // Enable debug mode globally
  if (options.debug) {
    DEBUG_MODE = true;
    SHOW_STATS = true; // Debug mode enables stats by default
    debug('Debug mode enabled');
    debug('Options', options);
  }

  // Cleanup stale temp files on startup
  cleanupStaleTempFiles(CACHE_DIR);
  cleanupStaleTempFiles(SKILL_DIR);

  // Enable stats display
  if (options['show-stats']) {
    SHOW_STATS = true;
  }

  if (!command || options.help || options.h) {
    printHelp();
    return;
  }

  // Cache management commands
  if (command === 'cache') {
    const subcommand = rest[0];
    if (subcommand === 'list') {
      cmdCacheList(options);
      return;
    }
    if (subcommand === 'clear') {
      cmdCacheClear(options, rest[1]);
      return;
    }
    if (subcommand === 'export') {
      cmdCacheExport(options, rest[1]);
      return;
    }
    exitWithError(`cache: unknown subcommand '${subcommand}'. Use: list, clear, export`);
  }

  if (command === 'start') {
    const prompt = rest.join(' ').trim();
    if (!prompt) exitWithError('start: missing prompt');
    cmdStart(options, prompt);
    return;
  }
  if (command === 'status') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('status: missing jobDir');
    cmdStatus(options, jobDir);
    return;
  }
  if (command === 'wait') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('wait: missing jobDir');
    cmdWait(options, jobDir);
    return;
  }
  if (command === 'results') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('results: missing jobDir');
    cmdResults(options, jobDir);
    return;
  }
  if (command === 'stop') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('stop: missing jobDir');
    cmdStop(options, jobDir);
    return;
  }
  if (command === 'clean') {
    const jobDir = rest[0];
    if (!jobDir) exitWithError('clean: missing jobDir');
    cmdClean(options, jobDir);
    return;
  }

  exitWithError(`Unknown command: ${command}`);
}

// Graceful shutdown handler
function setupGracefulShutdown() {
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    debug(`Received ${signal}, cleaning up...`);

    // Final stats if enabled
    if (SHOW_STATS && jobStats.startTime) {
      jobStats.endTime = new Date().toISOString();
      printStats();
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (err) => {
    process.stderr.write(`${COLORS.red}Uncaught exception:${COLORS.reset} ${err.message}\n`);
    if (DEBUG_MODE) {
      process.stderr.write(err.stack + '\n');
    }
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`${COLORS.red}Unhandled rejection:${COLORS.reset} ${reason}\n`);
    process.exit(1);
  });
}

if (require.main === module) {
  setupGracefulShutdown();
  main();
}

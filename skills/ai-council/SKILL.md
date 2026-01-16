---
name: ai-council
description: Collect and synthesize opinions from multiple AI agents. Use when users say "summon the council", "ask other AIs", or want multiple AI perspectives on a question.
version: 1.0.0
---

# AI Council Skill

Multi-AI council workflow with smart scenario routing.

## When to Use

- User explicitly asks for "council", "multiple AI opinions", "ask other AIs"
- User wants diverse perspectives on code review, architecture, security, or documentation
- Complex decision-making that benefits from multiple viewpoints
- User says "summon the council" or similar phrases

## When NOT to Use

- Simple questions with clear answers
- User just needs Claude's direct help
- Time-sensitive tasks (council takes longer)

## Execution Flow

```
┌─────────────────────────────────────────────────┐
│  1. Receive User Question                       │
├─────────────────────────────────────────────────┤
│  2. Auto-detect Scenario (or use explicit)      │
│     - code-review: Code review requests         │
│     - architecture: Design decisions            │
│     - bug-analysis: Debugging help              │
│     - security: Security audits                 │
│     - doc-quality: Documentation review         │
│     - reader-feedback: User perspective         │
│     - structure: Content organization           │
├─────────────────────────────────────────────────┤
│  3. Summon Council (Codex + Gemini)             │
│     - Parallel execution                        │
│     - Role-based perspectives                   │
├─────────────────────────────────────────────────┤
│  4. Present Individual Responses                │
│     - Show each agent's perspective             │
│     - Highlight consensus points                │
│     - Note disagreements                        │
├─────────────────────────────────────────────────┤
│  5. Synthesize (if template exists)             │
│     - Combine insights                          │
│     - Action items                              │
│     - Recommendations                           │
└─────────────────────────────────────────────────┘
```

## Step 1: Receive Question

Get the user's question or request. This can be:
- Code review request
- Architecture decision
- Bug analysis
- Security audit
- Documentation review
- Or any complex question needing multiple perspectives

## Step 2: Smart Scenario Detection

The council will automatically detect the appropriate scenario based on keywords:

| Scenario | Keywords | Roles |
|----------|----------|-------|
| **code-review** | review, PR, 리뷰, 코드 검토 | Senior Engineer, Security Analyst |
| **architecture** | architecture, design, 아키텍처, 설계 | System Architect, Tech Lead |
| **bug-analysis** | bug, error, 버그, 에러, 원인 | Debugger, QA Engineer |
| **security** | security, 보안, vulnerability | Security Expert, Penetration Tester |
| **doc-quality** | docs, documentation, 문서 | Tech Writer, UX Writer |
| **reader-feedback** | reader, audience, 독자, 사용자 | End User, Beginner |
| **structure** | structure, organization, 구조 | Information Architect, Editor |

## Step 3: Execute Council

Use the Bash tool to execute the council script:

```bash
$CLAUDE_PLUGIN_ROOT/scripts/council.sh start --scenario=auto "User's question here"
```

**IMPORTANT**:
- Use `--scenario=auto` for automatic detection
- Or use `--scenario=<name>` to specify explicitly (code-review, architecture, bug-analysis, security, doc-quality, reader-feedback, structure)
- Capture the job-id from the output

The council script will:
1. Detect scenario automatically based on keywords
2. Load appropriate role templates
3. Execute Codex and Gemini in parallel
4. Collect responses with 24-hour caching
5. Handle rate limits with fallback

## Step 4: Wait for Results

Use the Bash tool to wait and get results:

```bash
# Wait for completion
$CLAUDE_PLUGIN_ROOT/scripts/council.sh wait <job-id>

# Get results
$CLAUDE_PLUGIN_ROOT/scripts/council.sh results <job-id>
```

## Step 5: Present Results

Show the user:
1. **Detected Scenario**: Which council was summoned
2. **Individual Responses**: Each agent's perspective
3. **Consensus Points**: Where agents agree
4. **Disagreements**: Different viewpoints
5. **Synthesis Guide**: Template for combining insights (if available)

## Available Scenarios

### Developer Scenarios

- **code-review**: Code quality, best practices, improvements
- **architecture**: System design, patterns, scalability
- **bug-analysis**: Root cause, reproduction, fixes
- **security**: Vulnerabilities, threats, mitigations

### Documentation Scenarios

- **doc-quality**: Clarity, accuracy, completeness
- **reader-feedback**: User perspective, learning curve
- **structure**: Organization, navigation, findability

## Example Usage

### Auto-detection

```
User: "이 코드 리뷰해줘"
→ Detects: code-review
→ Summons: Senior Engineer + Security Analyst
```

### Explicit scenario

```bash
council.sh start --scenario=security "Check this authentication code"
```

## Configuration

Council behavior is configured in `council.config.yaml`:
- AI models to use (Codex, Gemini)
- Cache duration (24 hours default)
- Concurrency settings
- Rate limit handling

## Caching

Responses are cached for 24 hours based on:
- Scenario + prompt hash
- Cache invalidates if templates change

## Error Handling

- **Rate limits**: Automatic fallback to alternative model
- **Timeout**: 3 minutes per agent
- **Missing CLI**: Graceful error with installation instructions

---

## Quick Reference

### Trigger Phrases

- "summon the council"
- "ask other AIs"
- "multiple perspectives"
- "council, help me with..."

### Arguments

- Empty: Interactive mode (asks for question)
- Question provided: Direct execution with auto-detection

### Advanced Options

```bash
# Specific scenario
/ai-council --scenario=security "Your question"

# Check status
council.sh status <job-id>

# Clear cache
council.sh cache clear
```

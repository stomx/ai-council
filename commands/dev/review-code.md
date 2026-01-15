---
description: Multi-perspective code review from Senior Engineer, Security Analyst, and QA Engineer
argument-hint: <code or file path>
allowed-tools: Bash, Read, Grep, Glob
---

# Code Review Council

You are invoking a multi-AI code review council. Multiple AI agents will analyze the code from different expert perspectives:

- **Senior Engineer**: Architecture, design patterns, maintainability
- **Security Analyst**: Vulnerabilities, OWASP Top 10, security best practices
- **QA Engineer**: Edge cases, testability, error handling

## Instructions

1. First, gather the code to review:
   - If a file path is provided, read the file
   - If code is provided directly, use it as-is
   - If this is a PR review, gather the diff

2. Run the council with the code-review scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario code-review "$ARGUMENTS"`
```

3. After receiving all responses, synthesize the findings:
   - Identify **consensus points** (issues all reviewers agree on)
   - Note **critical issues** that must be fixed (P0/P1)
   - List **recommendations** prioritized by importance
   - Highlight any **dissenting opinions** worth considering

## Output Format

Present the results in this structure:

```markdown
## Code Review Summary

### Critical Issues (Must Fix)
- [Issue 1]: [Description] - Identified by: [Reviewers]

### Recommendations
| Priority | Issue | Suggested Fix | Reviewers |
|----------|-------|---------------|-----------|

### Consensus Points
- [Points all reviewers agreed on]

### Additional Perspectives
- [Any differing opinions worth noting]
```

**User's Request**: $ARGUMENTS

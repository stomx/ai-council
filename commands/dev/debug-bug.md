---
description: Bug diagnosis from Debugger, Code Historian, and Impact Assessor perspectives
argument-hint: <error message or bug description>
allowed-tools: Bash, Read, Grep, Glob
---

# Bug Analysis Council

You are invoking a multi-AI bug analysis council. Multiple AI agents will investigate the bug from different perspectives:

- **Debugger**: Root cause analysis, execution path tracing, state inspection
- **Code Historian**: Recent changes, regression analysis, git blame investigation
- **Impact Assessor**: Severity rating, affected scope, business impact

## Instructions

1. Gather information about the bug:
   - Error messages, stack traces
   - Reproduction steps if available
   - Relevant code sections

2. Run the council with the bug-analysis scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario bug-analysis "$ARGUMENTS"`
```

3. After receiving all responses, synthesize into an actionable bug report:
   - Identify the **root cause**
   - Assess **impact** and severity
   - Propose **fix options** with trade-offs
   - Recommend **prevention measures**

## Output Format

Present the results in this structure:

```markdown
## Bug Analysis Summary

### Root Cause
[Identified root cause with evidence]

### Impact Assessment
- **Severity**: P0/P1/P2/P3
- **Affected Users/Systems**: [Scope]
- **Business Impact**: [Description]

### Fix Options
| Option | Description | Pros | Cons | Effort |
|--------|-------------|------|------|--------|

### Recommended Fix
[Detailed recommendation with implementation steps]

### Prevention
- [How to prevent similar bugs in the future]
```

**User's Request**: $ARGUMENTS

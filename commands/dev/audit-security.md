---
description: Security audit from Red Team, Blue Team, and Compliance Officer perspectives
argument-hint: <code or system to audit>
allowed-tools: Bash, Read, Grep, Glob
---

# Security Audit Council

You are invoking a multi-AI security audit council. Multiple AI agents will assess security from different perspectives:

- **Red Team**: Attack vectors, exploitation possibilities, penetration testing mindset
- **Blue Team**: Defensive controls, security mechanisms, protection gaps
- **Compliance Officer**: Regulatory requirements, standards compliance, audit readiness

## Instructions

1. Gather the code or system information to audit:
   - Authentication/authorization code
   - Data handling logic
   - API endpoints
   - Configuration files

2. Run the council with the security scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario security "$ARGUMENTS"`
```

3. After receiving all responses, synthesize into a security assessment:
   - List **vulnerabilities** by severity
   - Check **compliance** status
   - Prioritize **remediation** efforts
   - Provide **implementation guidance**

## Output Format

Present the results in this structure:

```markdown
## Security Audit Summary

### Executive Summary
[Brief overview of security posture]

### Vulnerabilities Found
| Severity | Vulnerability | Location | OWASP Category |
|----------|--------------|----------|----------------|
| Critical | ... | ... | ... |
| High | ... | ... | ... |

### Compliance Status
- [ ] OWASP Top 10
- [ ] [Other applicable standards]

### Risk Matrix
| Issue | Likelihood | Impact | Risk Score | Priority |
|-------|------------|--------|------------|----------|

### Remediation Plan
1. **Immediate** (Critical/High):
   - [Action items]
2. **Short-term** (Medium):
   - [Action items]
3. **Long-term** (Low):
   - [Action items]
```

**User's Request**: $ARGUMENTS

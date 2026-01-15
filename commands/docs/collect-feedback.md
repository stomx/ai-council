---
description: Reader feedback collection from Beginner, Expert, and Non-native perspectives
argument-hint: <documentation to evaluate>
allowed-tools: Bash, Read, Grep, Glob
---

# Reader Feedback Council

You are invoking a multi-AI reader feedback council. Multiple AI agents will evaluate the documentation as different reader personas:

- **Beginner Reader**: First-time learner perspective, clarity needs
- **Expert Reader**: Senior developer perspective, efficiency and depth
- **Non-native Speaker**: International audience, translation-friendliness

## Instructions

1. Gather the documentation to evaluate:
   - Read the target documentation file(s)
   - Consider the intended audience if specified
   - Note any stated prerequisites

2. Run the council with the reader-feedback scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario reader-feedback "$ARGUMENTS"`
```

3. After receiving all responses, synthesize into audience analysis:
   - Map **audience fit** for each segment
   - Identify **accessibility barriers**
   - Note **efficiency blockers** for experts
   - List **internationalization issues**

## Output Format

Present the results in this structure:

```markdown
## Reader Feedback Summary

### Audience Fit Matrix
| Audience | Fit Score | Key Issues | Verdict |
|----------|-----------|------------|---------|
| Beginners | 1-5 | ... | Ready/Needs Work |
| Experts | 1-5 | ... | Ready/Needs Work |
| Non-native | 1-5 | ... | Ready/Needs Work |

### Beginner Experience
**Can follow along?** Yes/Partially/No
**Confidence after reading:** 1-5

Key barriers:
- [Barrier 1]
- [Barrier 2]

### Expert Experience
**Time to find info:** <1min / 1-5min / >5min
**Production-ready?** Yes/Partially/No

Missing for production:
- [Gap 1]
- [Gap 2]

### Internationalization Readiness
**Machine translation friendly?** Yes/Partially/No

Problematic phrases:
- "[Phrase]" → Suggested: "[Alternative]"

### Unified Recommendations
1. [Recommendation addressing multiple audiences]
2. [Recommendation addressing multiple audiences]
```

**User's Request**: $ARGUMENTS

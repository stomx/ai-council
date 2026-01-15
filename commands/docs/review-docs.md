---
description: Documentation quality review from Technical Editor, Accuracy Reviewer, and Completeness Checker
argument-hint: <documentation file or content>
allowed-tools: Bash, Read, Grep, Glob
---

# Documentation Quality Council

You are invoking a multi-AI documentation quality council. Multiple AI agents will analyze the documentation from different expert perspectives:

- **Technical Editor**: Grammar, style, readability, formatting
- **Accuracy Reviewer**: Technical correctness, code validity, link checking
- **Completeness Checker**: Missing content, gaps, edge cases

## Instructions

1. First, gather the documentation to review:
   - If a file path is provided, read the file
   - If content is provided directly, use it as-is
   - For multiple files, gather all relevant content

2. Run the council with the doc-quality scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario doc-quality "$ARGUMENTS"`
```

3. After receiving all responses, synthesize the findings:
   - Identify **critical issues** (factual errors, broken examples)
   - List **style violations** with specific fixes
   - Note **completeness gaps** with suggested additions
   - Provide **priority ranking** for improvements

## Output Format

Present the results in this structure:

```markdown
## Documentation Review Summary

### Quality Score
[Overall score: A/B/C/D/F with brief justification]

### Critical Issues (Must Fix)
- [Issue]: [Location] - Identified by: [Reviewers]

### Style & Readability
| Issue | Location | Suggestion | Priority |
|-------|----------|------------|----------|

### Completeness Gaps
- [ ] [Missing content description]

### Recommendations by Priority
1. **Immediate** (Affects correctness):
   - [Action items]
2. **Short-term** (Affects usability):
   - [Action items]
3. **Nice-to-have** (Polish):
   - [Action items]
```

**User's Request**: $ARGUMENTS

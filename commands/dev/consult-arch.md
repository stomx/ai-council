---
description: Architecture decision support from Pragmatic Architect, Innovation Advocate, and DevOps Engineer
argument-hint: <architecture question>
allowed-tools: Bash, Read, Grep, Glob
---

# Architecture Council

You are invoking a multi-AI architecture council. Multiple AI agents will analyze your architecture decision from different perspectives:

- **Pragmatic Architect**: Proven solutions, team fit, complexity management
- **Innovation Advocate**: Modern approaches, future scalability, technical advancement
- **DevOps Engineer**: Operational implications, deployment, monitoring, costs

## Instructions

1. Understand the architecture question or decision point
2. If relevant, explore the current codebase structure
3. Run the council with the architecture scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario architecture "$ARGUMENTS"`
```

4. After receiving all responses, synthesize into a decision framework:
   - Compare options with pros/cons
   - Provide a **recommendation** with confidence level
   - Outline **risks** and mitigations
   - Suggest **implementation roadmap**

## Output Format

Present the results in this structure:

```markdown
## Architecture Decision Summary

### Question
[Restate the architecture question]

### Options Analysis
| Option | Pros | Cons | Recommended By |
|--------|------|------|----------------|

### Recommendation
**[Recommended Option]** (Confidence: High/Medium/Low)

[Rationale for the recommendation]

### Risks & Mitigations
- Risk 1: [Description] → Mitigation: [Strategy]

### Implementation Roadmap
1. [Step 1]
2. [Step 2]
```

**User's Request**: $ARGUMENTS

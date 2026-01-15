---
description: Documentation structure analysis from Info Architect, UX Writer, and SEO Specialist
argument-hint: <documentation files or directory>
allowed-tools: Bash, Read, Grep, Glob
---

# Structure Analysis Council

You are invoking a multi-AI structure analysis council. Multiple AI agents will analyze the documentation architecture from different perspectives:

- **Information Architect**: Hierarchy, navigation, taxonomy
- **UX Writer**: Headings, scanability, microcopy
- **SEO Specialist**: Search optimization, discoverability

## Instructions

1. Gather the documentation structure:
   - List all documentation files and their organization
   - Read key files to understand content relationships
   - Note the current navigation/sidebar structure if present

2. Run the council with the structure scenario:

```bash
!`${CLAUDE_PLUGIN_ROOT}/scripts/council.sh --scenario structure "$ARGUMENTS"`
```

3. After receiving all responses, synthesize into restructuring plan:
   - Map **current vs. ideal structure**
   - Identify **navigation pain points**
   - List **SEO opportunities**
   - Provide **implementation roadmap**

## Output Format

Present the results in this structure:

```markdown
## Structure Analysis Summary

### Current Structure Assessment
[Brief overview of existing organization]

**Strengths:**
- [Strength 1]

**Weaknesses:**
- [Weakness 1]

### Proposed Structure
```
docs/
├── getting-started/
│   ├── ...
├── guides/
│   ├── ...
└── reference/
    ├── ...
```

### Navigation Improvements
| Current | Issue | Proposed | Impact |
|---------|-------|----------|--------|
| [Path] | [Problem] | [Solution] | High/Med/Low |

### Heading Rewrites
| Current Heading | Issue | Suggested Rewrite |
|-----------------|-------|-------------------|
| "Configuration" | Vague | "Configure Your First Project" |

### SEO Opportunities
| Page | Current Title | Optimized Title | Target Keyword |
|------|---------------|-----------------|----------------|

### Implementation Roadmap
1. **Phase 1** (Quick wins):
   - [Action]
2. **Phase 2** (Restructure):
   - [Action]
3. **Phase 3** (Optimization):
   - [Action]
```

**User's Request**: $ARGUMENTS

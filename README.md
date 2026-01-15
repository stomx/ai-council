# AI Council

Multi-AI council plugin for Claude Code. Collects opinions from multiple AI agents (Codex, Gemini) and synthesizes them into actionable recommendations.

## Features

- **15개 핵심 기능**: CLI graceful fallback, 실시간 진행 표시, 24시간 캐싱, 민감 정보 마스킹, Rate Limit fallback, Atomic write, Graceful shutdown 등
- **개발자용 명령어**: 코드 리뷰, 아키텍처 상담, 버그 분석, 보안 감사
- **문서작성자용 명령어**: 문서 품질 검토, 독자 피드백, 구조 분석

## Commands

### Developer Commands (`/dev/`)

| Command | Description |
|---------|-------------|
| `/review-code` | Multi-perspective code review |
| `/consult-arch` | Architecture decision support |
| `/debug-bug` | Bug diagnosis and root cause analysis |
| `/audit-security` | Security vulnerability assessment |

### Documentation Commands (`/docs/`)

| Command | Description |
|---------|-------------|
| `/review-docs` | Documentation quality review |
| `/collect-feedback` | Reader perspective feedback |
| `/analyze-structure` | Documentation structure analysis |

## Usage

### Slash Commands

```bash
# Developer commands
/review-code "이 PR의 변경사항을 리뷰해줘"
/consult-arch "모노레포 vs 멀티레포 어떤 게 좋을까?"
/debug-bug "이 에러 원인을 분석해줘"
/audit-security "이 인증 코드에 취약점이 있는지 확인해줘"

# Documentation commands
/review-docs "README.md 품질을 검토해줘"
/collect-feedback "이 문서가 초보자에게 적합한지 평가해줘"
/analyze-structure "이 문서의 구조 개선점을 제안해줘"
```

### Direct Script Usage

```bash
# One-shot mode
./scripts/council.sh "your question here"

# Job mode (for polling)
JOB_DIR=$(./scripts/council.sh start "your question")
./scripts/council.sh wait "$JOB_DIR"
./scripts/council.sh results "$JOB_DIR"
./scripts/council.sh clean "$JOB_DIR"
```

### Cache Management

```bash
./scripts/council.sh cache list              # List cached results
./scripts/council.sh cache clear [KEY]       # Clear cache
./scripts/council.sh cache export KEY        # Export cached result
```

## Configuration

Edit `council.config.yaml` to customize:

- **members**: AI agents to consult (codex, gemini, etc.)
- **timeout**: Maximum wait time per member (default: 180s)
- **retry_on_rate_limit**: Auto-retry with fallback model on 429 errors
- **scenarios**: Template configurations for specific use cases

## Requirements

- Node.js (for script execution)
- At least one AI CLI installed:
  - `codex` (OpenAI Codex CLI)
  - `gemini` (Google Gemini CLI)

## Directory Structure

```
ai-council/
├── scripts/                 # Core scripts (shared)
│   ├── council-job.js       # Main orchestration
│   ├── council-job-worker.js # Worker process
│   └── council.sh           # Entry point
├── commands/
│   ├── dev/                 # Developer commands
│   │   ├── review-code.md
│   │   ├── consult-arch.md
│   │   ├── debug-bug.md
│   │   └── audit-security.md
│   └── docs/                # Documentation commands
│       ├── review-docs.md
│       ├── collect-feedback.md
│       └── analyze-structure.md
├── templates/               # Role templates
│   ├── code-review.yaml
│   ├── architecture.yaml
│   ├── doc-quality.yaml
│   └── ...
├── council.config.yaml      # Configuration
└── README.md
```

## License

MIT

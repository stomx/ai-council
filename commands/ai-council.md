---
description: "Smart AI Council - automatically routes to the appropriate council (code review, architecture, bug analysis, security, documentation)"
arguments: "<question>"
---

# AI Council - Smart Router

Analyzes your question and automatically selects the most appropriate council scenario.

## Available Scenarios

### Development
- **code-review**: PR/코드 리뷰, 변경사항 검토
- **architecture**: 아키텍처 결정, 시스템 설계
- **bug-analysis**: 버그 분석, 에러 디버깅
- **security**: 보안 취약점, 인증/인가 검토

### Documentation
- **doc-quality**: 문서 품질, README 검토
- **reader-feedback**: 독자 관점 피드백
- **structure**: 문서 구조 분석

---

Running smart council with auto-detection...

```bash
$CLAUDE_PLUGIN_ROOT/scripts/council.sh start --scenario=auto "$ARGUMENTS"
```

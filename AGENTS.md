# AGENTS · safetyreport-chromeextension

이 레포의 에이전트 진입점이다. 제품 정본은 `CLAUDE.md`(구조·계약·검증·릴리스)이며,
팀 공통 규칙은 `~/projects/safetyreport/.team/briefs/00-common.md`와 `.team/briefs/ext.md`를 따른다.
서버/계약 사본은 map 정본을 동기화 스크립트로만 갱신한다. 스토어 제출·배포·push는 승인 후에만 한다.

## 에이전트 배정 (worklazytools 표준 준용)

| 역할 | 담당 | 모델 |
|---|---|---|
| 총괄·통합 | 6-Sol | `gpt-6.1-sol` (Codex) |
| 구현 우선 배정 | Muse Spark contributor | `opencode-go/muse-spark-1.3-contributor` (OpenCode) |
| 정식 검수 | Astra | `gpt-6-astra` |
| 조사 | Gemini | `gemini-4-argon-high` (agy, 한도 초과 시 Luna `gpt-6.1-luna` 대체) |

외부 에이전트 호출의 기본은 herdr 페인 대화형 세션이다. 모델 문자열이 바뀌면 이 표를 함께 고친다.

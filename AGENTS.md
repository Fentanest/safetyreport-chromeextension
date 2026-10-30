# AGENTS · safetyreport-chromeextension

이 레포의 에이전트 진입점이다. 제품 정본은 `CLAUDE.md`(구조·계약·검증·릴리스)이며,
팀 공통 규칙은 `~/projects/safetyreport/.team/briefs/00-common.md`와 `.team/briefs/ext.md`를 따른다.
서버/계약 사본은 map 정본을 동기화 스크립트로만 갱신한다. 스토어 제출·배포·push는 승인 후에만 한다.

## 에이전트 배정 (worklazytools 표준 준용)

| 역할 | 담당 | 모델 |
|---|---|---|
| 총괄·통합 | 6-Sol | `gpt-6.1-sol` (Codex) |
| 구현 우선 배정 | Muse Spark contributor | `opencode-go/muse-spark-1.3-contributor` (OpenCode) |
| 구현 보조 | Sol | `gpt-6.1-sol` (Codex) |
| 정식 검수 | Astra | `gpt-6-astra` |
| 조사 | Gemini | `gemini-4-argon-high` (agy, 한도 초과 시 Luna `gpt-6.1-luna` 대체) |

외부 에이전트 호출의 기본은 herdr 페인 대화형 세션이다. 모델 문자열이 바뀌면 이 표를 함께 고친다.

## 권한 — 최대 허용 (herdr 작업자)

외부 작업자는 herdr 페인에서 권한 질문 없이 띄운다(Codex `--dangerously-bypass-approvals-and-sandbox`, OpenCode `--auto`, Claude `--dangerously-skip-permissions`, agy `--dangerously-skip-permissions` — 사용자 승인 2026-10-26·10-31). 구현자는 Muse(우선)·Sol(보조), 정식 검수는 기본 Astra, Jev 는 쓰지 않는다(2026-10-31).

**권한 범위 — 최대 허용(2026-10-31 사용자 지시 「권한은 최대한 허락하는 쪽으로 모두 맞추고」).** 이 플래그로 띄운 작업자는 작업서의 일을 끝내는 데 필요한 명령을 질문 없이 실행한다.
- 허용: 자기 worktree·작업 브랜치의 파일 쓰기와 커밋(총괄 대리 커밋이 기본이 아니다), 네트워크, 작업 공간 안 패키지·도구 설치, docker·`sudo`, 운영 데이터·로그·컨테이너 상태 읽기, 시험용 일회용 서비스·컨테이너 기동과 정리, 작업서가 지정한 운영 단계(출고·재적재·스냅샷·기기 시험 등)의 실행.
- 남기는 금지(되돌릴 수 없거나 바깥에 영향이 가는 것만): 비밀값·토큰 출력·전송, 실주문·실결제·주문 API, 사용자 승인 없는 원격 push·출고·스토어 업로드, 운영 데이터 삭제·수동 수정(작업서가 지정한 운영 단계 제외), 다른 작업의 worktree 쓰기, 전역 설정(`~/.claude`·`~/.codex`·셸 rc 등) 변경, 여러 에이전트가 함께 쓰는 공용 서비스(adb 서버·운영 Redis 등) 재시작.
- 지킨 여부는 작업서의 사후 검사(`git status --short`, `find <경로> -newer <marker>`, 운영 기록)로 확인한다.

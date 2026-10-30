# AGENTS · safetyreport-chromeextension

이 레포의 에이전트 진입점이다. 제품 정본은 `CLAUDE.md`(구조·계약·검증·릴리스)이며,
팀 공통 규칙은 `~/projects/safetyreport/.team/briefs/00-common.md`와 `.team/briefs/ext.md`를 따른다.
서버/계약 사본은 map 정본을 동기화 스크립트로만 갱신한다. 스토어 제출·배포·push는 승인 후에만 한다.

## 에이전트 배정 (safetyreport 계열 정본의 사본)

> 정본은 `~/projects/safetyreport/AGENTS.md`의 이 절이다. 각 레포 AGENTS.md의 같은 절은 사본이다. 고칠 때는 정본을 먼저 고친 뒤 사본을 모두 같은 글로 맞춘다(2026-10-31 사용자 결정).

| 역할 | 담당 (Herdr World 프로필) | 실행 | 모델 |
|---|---|---|---|
| 총괄·지휘·최종 판정 | Orchestrator (FirstMate) | Claude Code | Opus |
| **구현 1순위** | Muse Spark contributor | **OpenCode** | `opencode-go/muse-spark-1.3-contributor` |
| 구현 병렬, 계약·데이터·보안·CI·통합 | Sol | Codex | `gpt-6.1-sol` |
| **검수** (계획 기술검토·반박, 고정 커밋 정식 검수) | Astra | Codex | `gpt-6-astra` |
| 조사·1차 보충 | Gemini | agy | `gemini-4-argon-high` |
| 조사 대체 (Gemini 한도 초과가 실제로 확인됐을 때만) | Luna | Codex | `gpt-6.1-luna` |

### 띄우는 규칙
- 모든 작업자는 **Herdr World 프로필로 띄워 World에 반드시 나타나게 한다.** World 실행기(`launcher.start`, 화면의 프로필 실행)를 쓴다. 이렇게 띄우면 터미널에 프로필이 배정되고 카드 색이 붙는다. `herdr agent start`로 직접 띄우면 프로필이 배정되지 않아 World에 기본 모습으로 보인다. 그 방식은 쓰지 않는다
- Muse는 **OpenCode로만** 호출한다. Codex에 Muse 모델 이름을 넘기는 방식은 쓰지 않는다
- 권한 질문 없이 띄운다: Codex Full Access(승인 never), OpenCode `--auto`, agy 권한 생략, Claude는 프로필의 permission 값
- 프로필이 없거나, 권한이 막히거나, 한도에 걸린 경우는 서로 다른 사건으로 기록한다. 다른 모델로 조용히 바꾸지 않는다

### 작업 규칙
- **계획 게이트:** 계획을 확정하고 Astra의 기술 검토(반박·보완)를 받은 뒤에 구현·배포를 시작한다
- 구현은 Muse에게 먼저 배정하고, 서로 독립된 일은 Sol이 병렬로 맡는다. 같은 파일을 동시에 고치지 않는다(별도 worktree, 소유자 기록)
- 검수는 Astra가 고정 커밋 + 별도 검수 worktree에서 한다. 모델의 종료 메시지나 빈 출력만으로 완료 처리하지 않는다
- Gemini 결론은 오케스트레이터가 코드·이미지·시험으로 다시 확인한 뒤에 받아들인다
- 모델 문자열이 바뀌면 이 표, World 프로필, `docs/agent-dispatch-runbook.md`를 함께 고친다

## 권한 — 최대 허용 (herdr 작업자)

외부 작업자는 herdr 페인에서 권한 질문 없이 띄운다(Codex `--dangerously-bypass-approvals-and-sandbox`, OpenCode `--auto`, Claude `--dangerously-skip-permissions`, agy `--dangerously-skip-permissions` — 사용자 승인 2026-10-26·10-31). 구현자는 Muse(우선)·Sol(보조), 정식 검수는 기본 Astra, Jev 는 쓰지 않는다(2026-10-31).

**권한 범위 — 최대 허용(2026-10-31 사용자 지시 「권한은 최대한 허락하는 쪽으로 모두 맞추고」).** 이 플래그로 띄운 작업자는 작업서의 일을 끝내는 데 필요한 명령을 질문 없이 실행한다.
- 허용: 자기 worktree·작업 브랜치의 파일 쓰기와 커밋(총괄 대리 커밋이 기본이 아니다), 네트워크, 작업 공간 안 패키지·도구 설치, docker·`sudo`, 운영 데이터·로그·컨테이너 상태 읽기, 시험용 일회용 서비스·컨테이너 기동과 정리, 작업서가 지정한 운영 단계(출고·재적재·스냅샷·기기 시험 등)의 실행.
- 남기는 금지(되돌릴 수 없거나 바깥에 영향이 가는 것만): 비밀값·토큰 출력·전송, 실주문·실결제·주문 API, 사용자 승인 없는 원격 push·출고·스토어 업로드, 운영 데이터 삭제·수동 수정(작업서가 지정한 운영 단계 제외), 다른 작업의 worktree 쓰기, 전역 설정(`~/.claude`·`~/.codex`·셸 rc 등) 변경, 여러 에이전트가 함께 쓰는 공용 서비스(adb 서버·운영 Redis 등) 재시작.
- 지킨 여부는 작업서의 사후 검사(`git status --short`, `find <경로> -newer <marker>`, 운영 기록)로 확인한다.

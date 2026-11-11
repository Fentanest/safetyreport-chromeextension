# AGENTS · safetyreport-chromeextension

이 레포의 에이전트 진입점이다. 제품 정본은 `CLAUDE.md`(구조·계약·검증·릴리스)이며,
팀 공통 규칙은 `~/projects/safetyreport/.team/briefs/00-common.md`와 `.team/briefs/ext.md`를 따른다.
서버/계약 사본은 map 정본을 동기화 스크립트로만 갱신한다. 스토어 제출·배포·push는 승인 후에만 한다.

## 에이전트 배정 (safetyreport 계열 정본의 사본)

> 정본은 `~/projects/safetyreport/AGENTS.md`의 이 절이다. 각 레포 AGENTS.md의 같은 절은 사본이다. 고칠 때는 정본을 먼저 고친 뒤 사본을 모두 같은 글로 맞춘다(2026-10-31 사용자 결정). 검수자 배정·계획·3회 규칙은 2026-11-02 사용자 결정(D39)이다. 작업자를 띄우는 곳은 2026-11-10 사용자 결정(D138)으로 Herdr World에서 **Paseo**로 바꿨다.

| 역할 | 에이전트 | `create_agent`의 `provider` | `modeId` | `thinkingOptionId` |
|---|---|---|---|---|
| 총괄·지휘·최종 판정 | Claude | 사용자가 Paseo 앱에서 직접 띄운다 | | |
| 대리 총괄: Claude 사용량이 다해 총괄이 없을 때 | Astra | `codex/gpt-6-astra` | `full-access` | `high` |
| **구현 1순위** | Muse | `opencode/opencode-go/muse-spark-1.3-contributor` | `build` | (기본) |
| 구현 병렬, 계약·데이터·보안·CI·통합 | Sol | `codex/gpt-6.1-sol` | `full-access` | `high` |
| **계획**: `!계획!`·`!계획만!` 요청 때의 계획 기술검토·반박, 그리고 **같은 오류를 3회 고쳐도 안 될 때의 해결** | Astra | `codex/gpt-6-astra` | `full-access` | `high` |
| **검수 (기본)**: 고정 커밋 정식 검수. Muse 구현과 Sonnet 구현을 검수한다 | Sol | `codex/gpt-6.1-sol` | `full-access` | `high` |
| **검수**: Sol이 구현한 것을 검수한다(대척점 모델) | Sonnet | `claude/claude-sonnet-5-5` | `bypassPermissions` | (기본) |
| **웹 검색·조사·리서치** | Gemini | `antigravity/gemini-4-argon-high` | `full-access` | (없음) |
| 조사: Gemini argon이 한도에 걸렸을 때 | Gemini | `antigravity/gemini-3.8-flash-high` | `full-access` | (없음) |
| 조사 대체: **Gemini 두 모델이 모두 한도에 걸렸을 때만** | Terra | `codex/gpt-6.1-terra` | `full-access` | `high` |
| Claude 작업자(총괄이 따로 맡길 때만): 구현·기기 시험·디자인 | Opus | `claude/claude-opus-5-5` | `bypassPermissions` | (기본) |
| 자문(필요할 때만, "advisor 호출"): 검수·구현을 대신하지 않는다 | Fable | `claude/claude-fable-5-2` | `auto` | (기본) |

### 띄우는 규칙
- 모든 작업자는 **Paseo 에이전트(총괄의 하위 에이전트)로 띄워 사용자가 Paseo 앱에서 직접 볼 수 있게 한다.** 총괄이 Paseo 도구 `create_agent`로 띄우고, 위 표의 값을 `provider`·`settings.modeId`·`settings.thinkingOptionId`에 그대로 옮겨 적는다. 모델은 항상 적는다. 화면 없이 돌리는 방식(`codex exec`·`agy -p`·`opencode run`·`nohup`)이나 Claude `Agent` 서브에이전트로 다른 모델 몫을 대신 돌리는 방식은 Paseo를 쓸 수 없을 때만 쓰고 이유를 기록한다
- **Paseo 프로필은 쓰지 않는다. 이 표가 유일한 기준이다.** 프로필은 이 PC의 모든 프로젝트가 같이 쓰기 때문에 한 프로젝트의 역할이 다른 프로젝트에 섞인다. `list_profiles`가 비어 있어도 정상이고, 생겨도 이 표가 우선한다. 에이전트 이름(Muse·Sol·Sonnet·Astra·Gemini·Terra·Opus·Fable)은 모든 프로젝트에서 같은 모델을 가리키고, 역할만 프로젝트마다 다르다
- 작업 공간: 총괄이 worktree를 만든 뒤 `create_workspace(isolation="local", path=<worktree 절대경로>, projectId=<총괄 작업 공간의 projectId>)`로 등록하고 그 `workspaceId`를 `create_agent`에 넘긴다. `projectId`를 빼면 Paseo 사이드바에 safetyreport 밖의 새 프로젝트로 뜬다. 브랜치와 worktree는 총괄이 만든다. Paseo가 만들게 하지 않는다(`isolation="worktree"`를 쓰지 않는다)
- Muse는 **OpenCode로만** 호출한다. Codex에 Muse 모델 이름을 넘기는 방식은 쓰지 않는다
- **Gemini 호출 순서(2026-11-10 사용자 결정):** `gemini-4-argon-high`를 먼저 부른다. 한도 초과가 로그·화면으로 확인되면 `gemini-3.8-flash-high`로 같은 일을 다시 맡긴다. 그것도 한도 초과면 Terra에게 맡긴다. 한도 초과가 아닌 오류(인증·권한·도구)는 원인을 고쳐 같은 모델로 다시 부른다
- 결과를 회수해 보고하면 **자기가 만든 에이전트만** 바로 `archive_agent`로 정리한다. 같은 일의 후속 지시는 같은 에이전트에 `send_agent_prompt`로 보낸다. 다른 에이전트·작업 공간·Paseo daemon은 건드리지 않는다
- 모델이 없거나, 권한이 막히거나, 한도에 걸린 경우는 서로 다른 사건으로 기록한다. 위 Gemini 순서 말고는 다른 모델로 조용히 바꾸지 않는다
- 자세한 절차(발주, 질문·권한 요청에 답하기, 끊긴 작업자 이어가기, 완료 감시)는 모바일 레포 `~/projects/safetyreport/safetyreport/docs/agent-dispatch-runbook.md` §0을 따른다

### 작업 규칙
- **계획 게이트:** 계획을 확정하고 기술 검토(반박·보완)를 받은 뒤에 구현·배포를 시작한다. 사용자가 `!계획!` 또는 `!계획만!`이라고 하면 그 계획 작업의 Codex 세션은 **Astra**를 쓴다
- 구현은 Muse에게 먼저 배정하고, 서로 독립된 일은 Sol이 병렬로 맡는다. 같은 파일을 동시에 고치지 않는다(별도 worktree, 소유자 기록)
- **검수자 배정(구현자와 대척점 모델):** 검수는 고정 커밋 + 별도 검수 worktree에서 한다. 모델의 종료 메시지나 빈 출력만으로 완료 처리하지 않는다. 같은 모델이라도 구현과 검수는 별도 에이전트다
  - Muse(OpenCode)가 구현 → **Sol** 검수
  - Sol이 구현 → **Sonnet** 검수
  - Sonnet이 구현 → **Sol** 검수
  - 그 밖(Opus·Terra 등)이 구현 → 기본 **Sol** 검수. 구현자와 같은 모델이면 Sonnet 검수
- 에이전트 제목은 `<에이전트>-<작업>`으로 단다(예: `muse-<작업>`, `sol-review-<작업>`, `sonnet-review-<작업>`, `astra-plan-<작업>`). 구현 세션과 검수 세션을 제목으로 구분한다
- **3회 규칙:** 같은 오류(같은 검수 지적·같은 실패 유형)를 3회 고쳐도 해결되지 않으면 **Astra**를 불러 원인·설계를 다시 본다. 회차는 총괄이 ledger에 센다. 작업자가 일하다 끊긴 것(Paseo 상태 `closed`)은 실행기 이상이지 실패 회차가 아니다
- 조사(Gemini, 한도 시 3.8 Flash, 그다음 Terra) 결론은 총괄이 코드·이미지·시험으로 다시 확인한 뒤에 받아들인다
- **GitHub Actions artifact 보관 1일(2026-11-02 사용자 지시, 모든 safetyreport 레포):** 별도 브랜치·개별 빌드·수동 실행 워크플로를 포함해 `actions/upload-artifact`는 항상 `retention-days: 1`로 둔다. artifact 용량은 계정의 모든 레포가 함께 쓴다. 워크플로를 새로 만들거나 고칠 때도 같다
- **하위 에이전트 완료 감시·알람 필수(2026-11-02 사용자 지시):** 총괄은 작업자를 발주·재발주·재개할 때마다 그 자리에서 완료 알림을 켜고(`notifyOnFinish`) 백그라운드 감시도 함께 건다. 감시는 보고 파일 생성·갱신, 질문·권한 요청 대기, 작동 중이던 작업자의 멈춤(`idle`·`closed`·`error`), 한도·용량 오류, 예상 시간 초과를 모두 잡는다. 알림을 처리하면 곧바로 감시를 다시 걸고, 감시 기준 시각(MARK)은 실제로 처리를 마친 보고까지만 올린다. 자세한 명령은 모바일 레포 `docs/agent-dispatch-runbook.md` "완료 감시·알람" 절
- 모델 문자열이 바뀌면 이 표와 사본, 모바일 레포·map 레포의 `docs/agent-dispatch-runbook.md`를 함께 고친다. Paseo 모델 목록에 없는 모델을 써야 하면 사용자에게 요청한다(`~/.paseo/config.json`은 전역 설정이라 작업자가 고치지 않는다)

### 팀 정본(`~/projects/safetyreport/.team/`) 갱신 규칙
- **누가:** 총괄(Claude), 총괄이 없을 때는 대리 총괄(Astra)
- **언제 (그때마다 즉시):** 발주, 회수, 검수 판정, 출고, 사용자 결정이 생기면 `ledger.md`와 `decisions.md`를 바로 고친다. 발주 기록에는 Paseo `agentId`를 적는다
- **인계·세션 종료·재시작 전:** `HANDOFF.md` 맨 위의 현황을 지금 상태로 바꿔 쓴다
- 구현·검수·조사 담당자는 `.team`을 직접 고치지 않는다. 보고서(자기 `status/<이름>.md`, 검수 결과 파일, 보고 메시지)로만 알린다
- 이 갱신은 총괄이 규정을 지켜서 하는 것이고, 시스템이 자동으로 해 주지 않는다. 사용량이 갑자기 끊기면 마지막 갱신이 빠질 수 있으므로, 재시작하기 전에 사용자가 "팀 정본 갱신해"라고 말하면 그 자리에서 갱신한다

## 권한 — 최대 허용 (Paseo 작업자)

외부 작업자는 Paseo 에이전트로 권한 질문 없이 띄운다(Codex `full-access`, OpenCode `build`, Claude `bypassPermissions`, Gemini(antigravity) `full-access` — 사용자 승인 2026-10-26·10-31, Paseo 전환 2026-11-10). 구현자는 Muse(우선)·Sol(보조)다. 정식 검수는 구현자와 대척점 모델이 한다(기본 Sol, Sol 구현분은 Sonnet — 2026-11-02 D39). Jev 는 쓰지 않는다(2026-10-31).

**권한 범위 — 최대 허용(2026-10-31 사용자 지시 「권한은 최대한 허락하는 쪽으로 모두 맞추고」).** 이 모드로 띄운 작업자는 작업서의 일을 끝내는 데 필요한 명령을 질문 없이 실행한다.
- 허용: 자기 worktree·작업 브랜치의 파일 쓰기와 커밋(총괄 대리 커밋이 기본이 아니다), 네트워크, 작업 공간 안 패키지·도구 설치, docker·`sudo`, 운영 데이터·로그·컨테이너 상태 읽기, 시험용 일회용 서비스·컨테이너 기동과 정리, 작업서가 지정한 운영 단계(출고·재적재·스냅샷·기기 시험 등)의 실행.
- 남기는 금지(되돌릴 수 없거나 바깥에 영향이 가는 것만): 비밀값·토큰 출력·전송, 실주문·실결제·주문 API, 사용자 승인 없는 원격 push·출고·스토어 업로드, 운영 데이터 삭제·수동 수정(작업서가 지정한 운영 단계 제외), 다른 작업의 worktree 쓰기, 전역 설정(`~/.claude`·`~/.codex`·`~/.paseo`·셸 rc 등) 변경, 여러 에이전트가 함께 쓰는 공용 서비스(adb 서버·운영 Redis·Paseo daemon 등) 재시작.
- 지킨 여부는 작업서의 사후 검사(`git status --short`, `find <경로> -newer <marker>`, 운영 기록)로 확인한다.

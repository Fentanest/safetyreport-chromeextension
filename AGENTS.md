# AGENTS · safetyreport-chromeextension

이 레포의 에이전트 진입점이다. 제품 정본은 `CLAUDE.md`(구조·계약·검증·릴리스)이며,
팀 공통 규칙은 `~/projects/safetyreport/.team/briefs/00-common.md`와 `.team/briefs/ext.md`를 따른다.
서버/계약 사본은 map 정본을 동기화 스크립트로만 갱신한다. 스토어 제출·배포·push는 승인 후에만 한다.

## 에이전트 배정 (safetyreport 계열 정본의 사본)

> 정본은 `~/projects/safetyreport/AGENTS.md`의 이 절이다. 각 레포 AGENTS.md의 같은 절은 사본이다. 고칠 때는 정본을 먼저 고친 뒤 사본을 모두 같은 글로 맞춘다(2026-10-31 사용자 결정). 검수자 배정·계획·3회 규칙은 2026-11-02 사용자 결정(D39)이다.

| 역할 | Herdr World 프로필 (기존 것을 그대로 쓴다) | 실행 | 모델 |
|---|---|---|---|
| 총괄·지휘·최종 판정 | Orchestrator | Claude Code | Opus |
| **구현 1순위 (Muse)** | Builder(opencode) | **OpenCode** | `opencode-go/muse-spark-1.3-contributor` (OpenCode 기본 모델) |
| 구현 병렬, 계약·데이터·보안·CI·통합 (Sol) | Builder(sol) | Codex | `gpt-6.1-sol` |
| **계획 (Astra)**: `!계획!`·`!계획만!` 요청 때의 계획 기술검토·반박, 그리고 **같은 오류를 3회 고쳐도 안 될 때의 해결** | Reviewer(astra) | Codex | `gpt-6-astra` |
| **검수 (기본 Sol)**: 고정 커밋 정식 검수. Muse 구현과 Sonnet 구현을 검수한다 | Reviewer(sol) | Codex | `gpt-6.1-sol` |
| **검수 (Sonnet)**: Sol이 구현한 것을 검수한다(대척점 모델) | Reviewer(sonnet) | Claude Code | Sonnet |
| **웹 검색·조사·리서치 (Gemini)** | Web Researcher | agy | `gemini-4-argon-high` (agy 기본 모델) |
| 조사 대체 (Terra, **Gemini가 한도에 걸렸을 때만**) | Code Analyst | Codex | `gpt-6.1-terra` |

### 띄우는 규칙
- **World 프로필은 다른 프로젝트와 같이 쓴다. 고치지도, 새로 만들지도 않는다.** 이 배정표가 프로필에 맞춘다
- 모든 작업자는 **Herdr World 프로필로 띄워 World에 반드시 나타나게 한다.** World 실행기(`launcher.start`, 화면의 프로필 실행)를 쓴다. 이렇게 띄우면 터미널에 프로필이 배정되고 카드 색이 붙는다. `herdr agent start`로 직접 띄우면 프로필이 배정되지 않아 World에 기본 모습으로 보인다. 그 방식은 쓰지 않는다
- Muse는 **OpenCode로만** 호출한다. Codex에 Muse 모델 이름을 넘기는 방식은 쓰지 않는다
- World 실행기는 Codex에는 모델과 `-a`(승인)만 넘기고, OpenCode·agy에는 아무 인자도 넘기지 않는다. 그래서 모델과 권한은 CLI 기본 설정이 정한다(2026-10-31 설정): Codex `sandbox_mode = "danger-full-access"`(+ 프로필 승인 never), OpenCode 기본 모델 Muse + `permission` 모두 허용, agy 기본 `model = gemini-4-argon-high`·`mode = auto`. Claude는 프로필의 permission 값을 따른다
- 프로필이 없거나, 권한이 막히거나, 한도에 걸린 경우는 서로 다른 사건으로 기록한다. 다른 모델로 조용히 바꾸지 않는다

### 작업 규칙
- **계획 게이트:** 계획을 확정하고 기술 검토(반박·보완)를 받은 뒤에 구현·배포를 시작한다. 사용자가 `!계획!` 또는 `!계획만!`이라고 하면 그 계획 작업의 Codex 세션은 **Reviewer(astra)**를 쓴다
- 구현은 Muse에게 먼저 배정하고, 서로 독립된 일은 Sol이 병렬로 맡는다. 같은 파일을 동시에 고치지 않는다(별도 worktree, 소유자 기록)
- **검수자 배정(구현자와 대척점 모델):** 검수는 고정 커밋 + 별도 검수 worktree에서 한다. 모델의 종료 메시지나 빈 출력만으로 완료 처리하지 않는다
  - Muse(OpenCode)가 구현 → **Reviewer(sol)**
  - Sol이 구현 → **Reviewer(sonnet)**
  - Sonnet이 구현 → **Reviewer(sol)**
  - 그 밖(Opus·Terra 등)이 구현 → 기본 **Reviewer(sol)**. 구현자와 같은 모델이면 Reviewer(sonnet)
- **3회 규칙:** 같은 오류(같은 검수 지적·같은 실패 유형)를 3회 고쳐도 해결되지 않으면 **Reviewer(astra)**를 불러 원인·설계를 다시 본다. 회차는 총괄이 ledger에 센다
- 조사(Gemini, 한도 시 Terra) 결론은 오케스트레이터가 코드·이미지·시험으로 다시 확인한 뒤에 받아들인다
- **GitHub Actions artifact 보관 1일(2026-11-02 사용자 지시, 모든 safetyreport 레포):** 별도 브랜치·개별 빌드·수동 실행 워크플로를 포함해 `actions/upload-artifact`는 항상 `retention-days: 1`로 둔다. artifact 용량은 계정의 모든 레포가 함께 쓴다. 워크플로를 새로 만들거나 고칠 때도 같다
- 모델 문자열이 바뀌면 이 표와 `docs/agent-dispatch-runbook.md`, 그리고 해당 CLI 기본 설정을 함께 고친다. World 프로필 변경이 필요하면 사용자에게 요청한다

### 팀 정본(`~/projects/safetyreport/.team/`) 갱신 규칙
- **누가:** 총괄(Orchestrator), 총괄이 없을 때는 대리 총괄(deputy)
- **언제 (그때마다 즉시):** 발주, 회수, 검수 판정, 출고, 사용자 결정이 생기면 `ledger.md`와 `decisions.md`를 바로 고친다
- **인계·세션 종료·재시작 전:** `HANDOFF.md` 맨 위의 현황을 지금 상태로 바꿔 쓴다
- 구현·검수·조사 담당자는 `.team`을 직접 고치지 않는다. 보고서(자기 `status/<이름>.md`, 검수 결과 파일, 보고 메시지)로만 알린다
- 이 갱신은 총괄이 규정을 지켜서 하는 것이고, 시스템이 자동으로 해 주지 않는다. 사용량이 갑자기 끊기면 마지막 갱신이 빠질 수 있으므로, 재시작하기 전에 사용자가 "팀 정본 갱신해"라고 말하면 그 자리에서 갱신한다

## 권한 — 최대 허용 (herdr 작업자)

외부 작업자는 herdr 페인에서 권한 질문 없이 띄운다(Codex `--dangerously-bypass-approvals-and-sandbox`, OpenCode `--auto`, Claude `--dangerously-skip-permissions`, agy `--dangerously-skip-permissions` — 사용자 승인 2026-10-26·10-31). 구현자는 Muse(우선)·Sol(보조), 정식 검수는 기본 Astra, Jev 는 쓰지 않는다(2026-10-31).

**권한 범위 — 최대 허용(2026-10-31 사용자 지시 「권한은 최대한 허락하는 쪽으로 모두 맞추고」).** 이 플래그로 띄운 작업자는 작업서의 일을 끝내는 데 필요한 명령을 질문 없이 실행한다.
- 허용: 자기 worktree·작업 브랜치의 파일 쓰기와 커밋(총괄 대리 커밋이 기본이 아니다), 네트워크, 작업 공간 안 패키지·도구 설치, docker·`sudo`, 운영 데이터·로그·컨테이너 상태 읽기, 시험용 일회용 서비스·컨테이너 기동과 정리, 작업서가 지정한 운영 단계(출고·재적재·스냅샷·기기 시험 등)의 실행.
- 남기는 금지(되돌릴 수 없거나 바깥에 영향이 가는 것만): 비밀값·토큰 출력·전송, 실주문·실결제·주문 API, 사용자 승인 없는 원격 push·출고·스토어 업로드, 운영 데이터 삭제·수동 수정(작업서가 지정한 운영 단계 제외), 다른 작업의 worktree 쓰기, 전역 설정(`~/.claude`·`~/.codex`·셸 rc 등) 변경, 여러 에이전트가 함께 쓰는 공용 서비스(adb 서버·운영 Redis 등) 재시작.
- 지킨 여부는 작업서의 사후 검사(`git status --short`, `find <경로> -newer <marker>`, 운영 기록)로 확인한다.

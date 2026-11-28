# 확장 구조 및 운영 메모

현재 제품 버전 1.3.0(셀프호스트 삭제, 클라우드 전용). `src/background.js`를 esbuild로 묶은 `build/background.js`, `content.js`, `popup.js`, `options.js`, `shared-ui.js`가 실행 기준이다. 작업 기록은 `CHANGELOG.md`, 기능표와 사용 안내는 `README.md`에 둔다.

- `src/migration.js`: 1.3.0 셀프호스트 삭제 migration. worker 최초 초기화(`ready`)에서 `srMigration` 버전이 낮을 때만 실행한다. PC 요청은 만들지 않고 alarm(`safetyreport_poll`)·`sr-crawl-` 알림·배지를 API가 있을 때만 best-effort로 정리하며, 받아 둔 PC host·notifications 권한 반납을 best-effort로 시도하되(실브라우저 회수는 미검증, manifest의 host_permissions·content script 범위는 유지) 셀프호스트 저장 키(local: `selfhost`·legacy `serverUrl`/`apiKey`/`notifyCrawlDone`/`pollInterval`·`srCrawlState`·`selfhostBlocked`·`wasCrawling`·`backendMode`·`backendMigration`, sync의 같은 키)만 `remove`한다. `storage.clear()` 금지. 모든 단계가 재실행 가능하며 `srMigration`은 마지막에 기록한다. 순서는 local(API 키 포함) → sync → 버전 기록이며, 실패하면 버전을 기록하지 않고 `srMigrationError`(step·code·at·attempts, 값 없음)를 남긴 채 클라우드 초기화는 계속한다. 로그인은 자동으로 하지 않는다.
- `src/background.js`: 클라우드 전용 worker. 신뢰된 컨텍스트(popup/options)만 로그인/로그아웃/요약/연결 테스트를 할 수 있고 content는 STATUS·SEARCH·NUMBERS만 가능하다. `storage.local`은 TRUSTED_CONTEXTS로 제한한다. 계정 변경과 worker 재시작은 요청 abort·세대 갱신·캐시 폐기·페이지 알림을 수행한다. cloud client는 필요할 때만 생성하며, SDK의 오래된 refresh 재시도도 클라이언트 세대로 차단한다. 자동 refresh 없음, 요청 시 refresh·401 재시도는 flight를 공유한다. alarm·notification·PC 요청 경로와 모드 개념은 없다(옛 `SET_MODE`/`SAVE_SERVER`/`TEST_SERVER`/`CRAWL_*` 메시지는 `UNKNOWN_MESSAGE`).
- `STATUS`(팝업/옵션의 연결 상태)는 `srStatusCache`(storage.local, identity는 로그인 계정 `cloud:<user id>`)로 캐시하고 worker 재시작에도 살아남는다. 캐시가 있으면 네트워크 없이 즉시 반환하고, 없거나(`message.fresh`) 명시 새로고침이면 그 자리에서 실제로 확인한다. 캐시가 있지만 오래됐으면(정상 5분/실패 30초) 백그라운드에서만 다시 확인해 결과가 바뀌면 `STATUS_CHANGED`를 보낸다. 로그인·로그아웃·계정 전환은 identity가 달라지거나 명시적으로 캐시를 비워 다음 확인을 즉시 실제로 만든다. `TEST_CLOUD`(옵션의 명시적 "연결 테스트")는 이 캐시를 쓰지 않고 항상 실제로 확인한다. `STATUS` flight는 identity와 세대가 모두 같을 때만 공유하고, 이전 요청의 완료가 새 flight를 지우지 않는다. popup.js와 options.js 모두 `STATUS_CHANGED`를 듣는다. options.js는 이 알림과 `srStatusCache` 변경에서 로그인 상태만 갱신해 진행 중/완료된 연결 테스트를 보존하고, `AUTH_CHANGED`/`WORKER_RESTARTED` 및 계정 변경에서 기존 전체 동기화·테스트 무효화를 수행한다.
- cloud: 기존 Supabase JS PKCE Kakao OAuth 및 `chrome.identity.launchWebAuthFlow`, my-reports POST만 사용한다. API 키·토큰·서버 원문 오류를 content script에 전달하지 않는다. `src/myReportsClient.js`가 요청/오류와 DTO projection을 담당한다. 신고 분류(`category`)는 traffic·parking·safety·living·other 5종(observation-v5, 2026-10-11)이며, summary의 traffic/parking/other 세 집계만 필수이고 safety/living은 있으면 통과·없어도(구버전 서버) 실패시키지 않는다.
- `content.js`: 문서당 하나의 이벤트 controller, `#VHRNO`·`#add1` 노드 identity 재바인딩, closed Shadow DOM 패널. 원본 입력·클릭 전파를 막지 않는다. 정규화 차량 query는 4글자부터 패널을 열고 요청한다(차량번호 없음 체크 시 숨김). `src/myReportsClient.js`의 소비자 입력 검증도 4~64자로 맞췄다. cloud 정본 계약과 현재 서버 코드는 아직 6~64자여서 4~5자 요청의 `QUERY_LENGTH`는 지원 제한 안내로 표시한다(0건으로 위장하지 않음). cloud 완료에는 정본·Edge·DB 변경이 필요하며 이 작업에서 서버/계약 사본은 수정하지 않았다. 비동기 세대 검증을 유지한다. 화면 데이터 TTL은 60초이며 만료 후 재열기에서 재조회한다. 신고/담당자 페이지는 목록별 flight와 현재 상태 병합으로 처리한다. 차량·주소 모두 정규화 값이 바뀌면 닫힌 패널도 다시 연다. 같은 값은 닫힘을 유지하고 클릭/포커스로 재연다. 주소는 input/textarea의 value 또는 일반 요소의 textContent를 읽고 input/change/텍스트·value 속성 mutation을 감시한다. 화면이 보일 때 300ms마다 두 노드 identity·값·차량번호 없음 체크를 비교해 이벤트 없는 value 대입도 감지한다(같은 값은 렌더·요청·디바운스 재설정 없음). 초기/교체 노드와 hash 이동 때 포커스 없이 두 값을 다시 읽는다. IME 조합 중에는 조회 예약을 멈춘다. 차량 600ms·주소 700ms 디바운스, worker 60초 캐시·동일 요청 flight 공유는 유지한다. 주소·차량 두 패널은 동시에 열려 있을 수 있다(상호 배타 숨김 없음). `position()`은 고정 크기 대신 내용 높이(그리드 `minmax(0,1fr)` 행 + `.sr-panel-content`의 단일 스크롤)에 맞추고 화면 높이를 넘으면 그 안에서 스크롤한다. 겹칠 자리면 차량 패널을 왼쪽으로 배치하거나 좁은 화면에서 두 패널의 높이를 나누고 내부 스크롤로 처리한다. 주소 `collapsed`는 수동 버튼만 변경하며 자동 접힘은 없다. 주소 패널은 X만 닫는다. 외부 pointerdown/Escape는 차량 패널에만 적용한다. 주소의 open/dismissed/collapsed, 확정 query/data/status, source node 수명주기는 분리되어 있다. 같은 주소 DOM 교체·일시 부재·hashchange는 결과와 사용자 상태를 보존한다. 900ms 지속된 빈 주소는 본문을 선택 안내로 바꾸며 패널은 유지한다. AUTH_CHANGED/DATA_INVALIDATED/WORKER_RESTARTED는 데이터와 요청 세대만 폐기하고 열린 패널 안에서 다시 조회한다. 계정 변경은 숨겨진 DOM까지 즉시 비운다. 제거된 host는 open일 때만 같은 객체를 다시 붙인다. 조회 결과 총 0건이면 결과/처분 타일·담당자 목록·빈 목록 상자 대신 한 줄 안내만 보여준다(이 분기는 `render()` 안에만 있고 `shared-ui.js`의 `summary()`/`records()`는 그대로라 popup.js/options.js는 영향 없음). 패널 전용 글자 크기·여백 축소는 `panel()`이 매 패널마다 여는 closed ShadowRoot 안 `<style>`에만 있어 `ui-tokens.css`/`ui-components.css` 원본과 popup/options 화면 크기에는 영향이 없다.
- `options.js`: 카카오 계정 상태·로그인/로그아웃·클라우드 연결 테스트·테마만 있다. 모드 선택·서버 주소·API 키 UI는 없다. runtime/storage 변경을 묶어 계정 상태를 동기화하고 같은 계정 토큰 갱신은 연결 테스트를 취소하지 않는다. PC에만 있던 신고는 모바일에서 가져와 공유해야 보인다는 안내 카드(`#pcNotice`)를 둔다.
- `shared-ui.js`: my-reports DTO allowlist 표시. 없는 금액·서버 통계를 가짜 0으로 만들지 않는다. 결과·처분 별도 톤, 입력 HTML escape. 검색 카드 원문 링크는 `/#mypage/mysafereport/<source_report_id>`. 분류 5종 한글 라벨과 신고 카드의 분류 칩(category 없는 행은 칩 생략), 장식용 inline SVG 아이콘 helper(`icon()`, 외부 폰트·CDN 없음)를 여기 한 곳에 둔다.
- `ui-tokens.css` / `ui-components.css`: 기존 PC 토큰, 모바일 딥 다크·상태톤·13~16px 글자 크기와 단일 스크롤 유지. `content.css`는 host만, 실제 스타일은 ShadowRoot 안에 넣는다. 처리 결과/처분은 분포 막대 + 범례가 있는 타일(`sr-tile`) 카드, 신고 카드는 결과 톤 왼쪽 악센트선 + 아이콘 메타 줄로 구성한다.
- `contracts/my-reports/`: map 정본의 바이트 사본. 직접 고치지 않고 map의 `scripts/integration/sync_contract_copy.py --contract my-reports --to <이 레포>`로 갱신한다. 운영 지침은 map `docs/integration/chromeextension/EXTENSION_HANDOFF.md` 및 `REPORT.md` §6.
- 안전신문고 페이지 범위: 실제 사이트는 `www.safetyreport.go.kr`와 `www` 없는 `safetyreport.go.kr`를 서로 리다이렉트 없이 동일하게 서빙한다(2026-10-12 확인). content_scripts와 Shadow DOM 스타일 WAR는 이 네 조합(`http`/`https` × `www` 유무)에만 적용한다. worker content 역할도 같은 네 정확 호스트의 top frame + 확장 ID만 허용한다. 다른 호스트·유사 도메인(`.evil.example` 등)·포트·하위 frame은 거부한다. 사이트는 Backbone.js 해시 라우팅 SPA로 `#content` 한 곳에 뷰를 갈아끼우며 `#VHRNO`/`#add1`는 iframe 밖 평문 DOM이다 — `content.js`의 기존 `MutationObserver(subtree:true)` + `hashchange` 재스캔이 이미 지연 렌더링·라우팅 변경을 다시 붙인다(모바일 전용 하위 도메인은 JSON API만 서빙해 대상이 아니다).
- 권한: manifest 권한은 `storage`·`identity`·`clipboardWrite`와 빌드한 Supabase origin(필수 host)뿐이다. `alarms`·`notifications`·optional host(`http://*/*`, `https://*/*`)는 1.3.0에서 제거했고 `scripts/build.mjs`도 다시 넣지 않는다(`tests/release-build.test.mjs`가 ZIP manifest로 검증). 전체 host grant와 CSP 완화 금지.
- 검증: `npm test`, `npm run test:contracts`, 공개 설정(`SR_SUPABASE_URL`·`SR_SUPABASE_PUBLISHABLE_KEY`)으로 빌드한 뒤 `SR_CHROMIUM_PATH=... npm run test:backend-browser`(1.2.6 저장소 상태를 시드해 업데이트 시나리오 검증, PC mock 요청 0회), `npm run test:action-popup`. migration·권한 시험은 `tests/selfhost-removal.test.mjs`. browser artifact는 `artifacts/backend-browser/`에 생성한다.
- 빌드·릴리스: `scripts/version.mjs`가 `VERSION`의 제품 버전을 검증하고 build manifest·ZIP·태그에 사용한다. `.github/workflows/build.yml`은 dev/main 수동 실행만 허용하며 push 트리거가 없다. `[self-hosted, Linux, X64, "235"]`, 공개 Supabase Variables 필수, 테스트·계약 검사 후 두 브랜치의 ZIP artifact를 1일 보관한다. dev는 태그·Release를 생성하지 않는다. main은 검증된 artifact를 받아 실행 커밋의 태그·GitHub Release를 생성한다. 본문은 기존 버전·커밋·ZIP 설치 안내 뒤 빈 줄과 계산된 태그의 `docs/releases/v<버전>.md` 내용 그대로이며, 자동 생성 노트는 끈다. 파일이 없으면 `::error::`로 경로를 안내하고 Release 생성 전에 실패한다(dev 빌드는 검사하지 않음). main 릴리스 작업에만 쓰기 권한을 부여하고 다른 커밋의 기존 태그는 거부한다. `cws-publish`는 `build`와 `release`의 성공을 모두 기다리므로 태그 충돌이나 GitHub Release 실패 시 스토어 업로드·검토 제출을 실행하지 않는다. workflow 작성과 실제 원격 실행·push·스토어 제출을 구분한다.

안전신문고 링크의 실제 원문 열람, 운영 카카오 로그인·실데이터 A/B 권한·운영 서버, 실제 optional 권한 반납(웹 스토어 업데이트 경로), OS Alt-Tab은 별도 검증한다. 로컬 mock/SDK/Chromium 검증을 운영 검증이라고 부르지 않는다. 다른 저장소·운영 설정·배포·스토어·push를 이 작업으로 변경하지 않는다.

## GitHub 이슈 자동참조를 유발하는 AI 내부 번호 표기 금지

- AI 답변·리뷰·검수·작업 목록의 내부 번호를 인용할 때 해시 기호 바로 뒤에 숫자를 붙이는 이슈 참조형 축약 표기를 사용하지 않는다.
- 저장소 접두사가 있는 이슈 번호나 GitHub가 이슈로 자동 연결하는 다른 축약형도 AI 내부 번호에 사용하지 않는다.
- 대신 ‘검토 항목 5’, ‘리뷰 항목 5’, ‘Astra 검토 항목 5’처럼 일반 문장으로 쓴다.
- 실제 GitHub 이슈/PR을 의도적으로 참조할 때만 대상 저장소와 번호를 검증하고 전체 URL을 사용한다.
- AI 내부 검토 번호에 이슈 종료/해결 키워드를 붙이지 않는다.
- 코드 주석, 테스트 설명, Markdown 문서, 커밋 메시지, PR 제목·본문·댓글, 이슈 댓글, 변경 이력, 릴리스 노트, 자동 생성 보고서와 그 템플릿 모두에 적용한다.
- Markdown 제목·색상값·정규식 등 이슈 참조와 무관한 정상 문법은 무차별 치환하지 않는다.

## 에이전트 배정 (safetyreport 계열 정본의 사본)

> 정본은 `~/projects/safetyreport/AGENTS.md`의 이 절이다. 각 레포 AGENTS.md의 같은 절은 사본이다. 고칠 때는 정본을 먼저 고친 뒤 사본을 모두 같은 글로 맞춘다(2026-10-31 사용자 결정). 작업자를 띄우는 곳은 **Paseo**다(2026-11-10 D138). 총괄은 Claude다(2026-11-21 D343). Sol·Astra는 6.2를 쓴다(D335). **2026-11-28 사용자 결정(D437)으로 부총괄 Neon을 두었다.** 구현·수리는 총괄 → Neon → 구현자 순서로 맡기고, 검수는 지시한 Neon이 하며, 통합 직전에 총괄이 직접 감사한다(D446). 이 결정으로 D39의 대척점 모델 정식 검수(Sol·Sonnet)는 없어졌고 Sonnet은 표에서 뺐다. 조사 모델은 곧 없어지는 argon 대신 Hydrogen을 쓴다(D438). 어려운 작업은 Neon이 직접 고치고 별도 Opus가 검수하며(D440), 3회 규칙은 5회 규칙으로 바꿨다(D441). 시험 기기는 기기 전용 Neon이 맡는다(D442).

| 역할 | 에이전트 | `create_agent`의 `provider` | `modeId` | `thinkingOptionId` |
|---|---|---|---|---|
| 총괄·지휘·통합·최종 판정 | Claude | 사용자가 Paseo 앱에서 직접 띄운다 | | |
| **부총괄**: 총괄에게 받은 일의 원인 찾기·코드 파악, 구현자 지시, 검수, 총괄 보고. 제품 코드는 어려운 작업일 때만 직접 고친다 | Neon | `antigravity/gemini-4-neon-high` | `full-access` | (없음) |
| **시험 기기 전용**: 받은 점검 항목대로 시험 기기를 조작해 시험하고 결과를 보고한다 | Neon(기기 전용 세션) | `antigravity/gemini-4-neon-high` | `full-access` | (없음) |
| **구현 1순위** | Muse | `opencode/opencode-go/muse-spark-1.3-contributor` | `build` | (기본) |
| 구현 병렬, 계약·데이터·보안·CI·통합 | Sol | `codex/gpt-6.2-sol` | `full-access` | `high` |
| **계획**: `!계획!`·`!계획만!` 요청 때와 큰 기능의 계획 기술검토·반박, 그리고 **5회 규칙에서 Neon 직접 수정·Opus 검수로도 안 풀릴 때의 해결** | Astra | `codex/gpt-6.2-astra` | `full-access` | `high` |
| **웹 검색·조사·리서치** | Hydrogen | `antigravity/gemini-4-hydrogen-high` | `full-access` | (없음) |
| 조사: Hydrogen이 한도에 걸렸을 때 | Flash | `antigravity/gemini-3.8-flash-high` | `full-access` | (없음) |
| 조사 대체: **Hydrogen·Flash가 모두 한도에 걸렸을 때만** | Terra | `codex/gpt-6.1-terra` | `full-access` | `high` |
| Claude 작업자: 디자인, Neon이 직접 고친 것의 검수, 기기 전용 Neon이 한도일 때의 기기 시험 | Opus | `claude/claude-opus-5-5` | `bypassPermissions` | (기본) |
| 자문(필요할 때만, "advisor 호출"): 검수·구현을 대신하지 않는다 | Fable | `claude/claude-fable-5-2` | `auto` | (기본) |

### 띄우는 규칙
- 모든 작업자는 **Paseo 에이전트로 띄워 사용자가 Paseo 앱에서 직접 볼 수 있게 한다.** 위 표의 값을 `provider`·`settings.modeId`·`settings.thinkingOptionId`에 그대로 옮겨 적는다. 모델은 항상 적는다. 화면 없이 돌리는 방식(`codex exec`·`agy -p`·`opencode run`·`nohup`)이나 Claude `Agent` 서브에이전트로 다른 모델 몫을 대신 돌리는 방식은 Paseo를 쓸 수 없을 때만 쓰고 이유를 기록한다. 안에서 따로 하위 작업자를 돌리는 `gemini-pro-orchestrator-*` 모델은 그 작업자가 Paseo에 보이지 않으므로 쓰지 않는다
- **누가 누구를 띄우나:** 총괄은 묶음 Neon, 기기 전용 Neon, Astra, 조사(Hydrogen·Flash·Terra), Fable, 그리고 아래 「작은 일」의 구현자를 띄운다. 묶음 Neon은 자기 묶음의 구현자(Muse·Sol), 자기가 직접 고친 것을 검수할 Opus, 그 묶음에 필요한 조사(Hydrogen 순서)를 띄운다. 디자인은 Opus가 맡고(D443), 총괄이 발주서에 적었을 때 묶음 Neon이 띄운다
- **Paseo 프로필은 쓰지 않는다. 이 표가 유일한 기준이다.** 프로필은 이 PC의 모든 프로젝트가 같이 쓰기 때문에 한 프로젝트의 역할이 다른 프로젝트에 섞인다. `list_profiles`가 비어 있어도 정상이고, 생겨도 이 표가 우선한다. 에이전트 이름(Neon·Muse·Sol·Astra·Hydrogen·Flash·Terra·Opus·Fable)은 위 표의 모델을 가리킨다
- **작업 공간:** 총괄이 묶음마다 브랜치와 worktree를 하나씩 만들고 `create_workspace(isolation="local", path=<worktree 절대경로>, projectId=<총괄 작업 공간의 projectId>)`로 등록한 뒤 그 `workspaceId`로 Neon을 띄운다. Neon은 묶음 브랜치에서 구현자마다 worktree를 따로 만들어 같은 `projectId`로 등록하고, 구현자의 결과를 묶음 브랜치에 합친다. `projectId`를 빼면 Paseo 사이드바에 safetyreport 밖의 새 프로젝트로 뜬다. Paseo가 브랜치·worktree를 만드는 방식(`isolation="worktree"`)은 쓰지 않는다
- Muse는 **OpenCode로만** 호출한다. Codex에 Muse 모델 이름을 넘기는 방식은 쓰지 않는다
- **조사 순서(2026-11-28 D438):** `gemini-4-hydrogen-high`를 먼저 부른다. 한도 초과가 로그·화면으로 확인되면 `gemini-3.8-flash-high`로 같은 일을 다시 맡긴다. 그것도 한도 초과면 Terra에게 맡긴다. 한도 초과가 아닌 오류(인증·권한·도구)는 원인을 고쳐 같은 모델로 다시 부른다
- **Neon이 한도에 걸리면(D437):** 다른 모델로 Neon을 대신 띄우지 않는다. 총괄이 그 묶음의 Neon 몫(지시·검수·보고 정리)을 직접 이어받는다. 이미 일하는 구현자는 그대로 두고, 총괄이 그 구현자에게 직접 지시한다. 기기 전용 Neon이 한도에 걸리면 Opus 전용 세션(`opus-device`)이 같은 일을 맡는다(D442)
- **정리:** 각자 **자기가 띄운 에이전트만** `archive_agent`로 정리한다. Neon은 묶음을 보고하기 전에 자기가 띄운 작업자와 그 worktree를 정리한다. 총괄은 통합한 뒤 Neon과 묶음 worktree를 정리한다. **작업 공간도 정리해 사이드바에서 뺀다(D451):** 에이전트를 archive한 뒤 그 일에 쓴 작업 공간을 `archive_workspace`로 정리한다. 작업 공간 정리는 폴더를 지우지 않으므로(2026-11-28 실측: `removedDirectory:false`, 미추적 파일 보존) worktree 폴더는 합쳐졌고 남길 파일이 없음을 확인한 뒤 `git worktree remove`로 따로 지운다. 작업 공간을 정리하면 그 안의 에이전트도 함께 정리되므로, 아직 쓰는 에이전트가 있는 작업 공간은 정리하지 않는다. 특히 총괄·결정 담당처럼 홈 폴더를 함께 쓰는 작업 공간은 정리하지 않는다. 자기가 만든 작업 공간만 정리한다. Neon은 자기가 띄운 작업자의 작업 공간을, 총괄은 통합한 뒤 묶음 작업 공간을 정리한다. 같은 일의 후속 지시는 같은 에이전트에 `send_agent_prompt`로 보낸다. 다른 에이전트·작업 공간·Paseo daemon은 건드리지 않는다
- 모델이 없거나, 권한이 막히거나, 한도에 걸린 경우는 서로 다른 사건으로 기록한다. 위 조사 순서와 Neon 한도 규칙 말고는 다른 모델로 조용히 바꾸지 않는다
- 자세한 절차(발주, Neon 묶음 절차, 질문·권한 요청에 답하기, 끊긴 작업자 이어가기, 완료 감시)는 모바일 레포 `~/projects/safetyreport/safetyreport/docs/agent-dispatch-runbook.md` §0을 따른다

### 작업 규칙
- **계획 게이트:** 계획을 확정하고 기술 검토(반박·보완)를 받은 뒤에 구현·배포를 시작한다. 사용자가 `!계획!` 또는 `!계획만!`이라고 하거나 큰 기능이면, Neon이 쓴 지시안을 총괄이 **Astra**에게 넘겨 검토받은 뒤 구현을 시작한다
- **구현·수리는 Neon을 거친다(D437):** 총괄은 같은 코드·기능을 건드리는 일들을 한 묶음으로 묶어 Neon 하나에게 맡긴다. 서로 닿지 않는 일은 묶음마다 Neon을 따로 띄운다. 총괄은 발주서에 그 묶음이 맡는 파일·기능과, 함께 쓰는 자원 가운데 그 묶음이 쓸 것(`main.dart`·테마·Provider·`pubspec.yaml`·Manifest·Gradle 같은 공용 파일, 시험 기기, 206 접근)을 적는다. 적히지 않은 것이 필요하면 Neon은 쓰지 않고 총괄에게 요청한다. 같은 파일을 두 묶음이 동시에 고치지 않는다. 206 운영 변경·출고·스토어 업로드는 지금처럼 사용자 승인이 있어야 한다
- **작은 일은 총괄이 바로 맡긴다(D437):** 한두 줄 문서·문구 수정처럼 제품 동작이 바뀌지 않는 아주 작은 일은 총괄이 구현자에게 바로 맡기고, 그 일의 지시·검수를 총괄이 한다
- **Neon이 하는 일:** 수리면 원인을 코드·로그·실측에서 직접 찾아(파일:줄) 구현자에게 수리를 지시한다. 기능이면 고칠 곳의 코드를 파악한 뒤 지시한다. 제품 코드는 구현자가 고친다. **어려운 작업이면 Neon이 직접 고칠 수 있다(D440).** 그때는 어려운 이유를 보고서에 적고, Neon이 띄운 별도 Opus 세션이 고정 커밋·별도 worktree에서 그 수정을 검수한다(검수 항목은 아래 Neon 검수와 같다). 총괄은 보고를 보고 그 판단을 바꿀 수 있다. 구현자는 Muse에게 먼저 배정하고, 서로 독립된 일은 Sol이 병렬로 맡는다. 같은 파일을 동시에 고치지 않는다(별도 worktree, 소유자 기록)
- **시험 기기(D442):** 시험 기기(S20·K20·Fold·iPhone 등)는 총괄이 띄운 기기 전용 Neon 세션 하나가 맡고, 다른 세션은 기기를 직접 조작하지 않는다. 묶음 Neon은 기기 시험이 필요하면 시험할 빌드와 SHA, 설치 방법, 점검할 부분과 통과 기준을 적어 기기 전용 Neon에게 보낸다. 기기 전용 Neon은 받은 순서대로 시험하고 결과(화면·로그·통과 여부)를 요청한 Neon과 총괄에게 보고한다. 기기 연결·조작 규칙은 홈 `~/projects/safetyreport/CLAUDE.md` 「시험 기기」 절과 모바일 레포 런북을 따른다
- **작업서:** Neon이든 총괄이든 구현자에게 주는 작업서에는 원인 수리 원칙, 임시 파일 삭제, artifact 1일 보관, 보고할 경로를 적는다. Muse 작업서에는 모바일 레포 `docs/agent-dispatch-runbook.md` §4 "Muse 작업서"의 공통 문단을 붙이고(2026-11-16 사용자 결정), 작업서 하나에 덩어리 하나를 넣고, 지킬 규칙은 문장으로 풀어 적는다. 여러 규칙이 맞물리는 설계·안전 경로는 Muse에게 주지 않는다
- **검수는 지시한 Neon이 한다(D437, D39의 대척점 검수를 대체):** 구현자는 끝나면 지시한 Neon에게 보고한다. Neon은 고정 커밋에서 직접 검수한다. 지시대로 됐는지, 원인 설명이 실제 응답·로그·실측과 맞는지, 수리를 빼면 실패하는 시험이 있는지, 바뀐 파일이 맡긴 범위 안인지, 우회·덮기가 없는지를 본다. 구현자의 종료 메시지나 빈 출력만으로 완료 처리하지 않는다. 지적을 고친 뒤 다시 확인하는 것도 Neon이 한다
- **전체 사전 검사는 CI에서 한 번(2026-11-24 사용자 결정 D409):** 구현자는 올리기 전에 분석, 바뀐 범위의 시험, 바뀐 범위와 닿는 몇 초짜리 빠른 검사(저장 설정 목록·계약 검사 등)만 돌린다. 전체 사전 검사(모바일은 `tool/verify_refactoring.sh` 13단계, 약 70분)는 저장소에 올린 뒤 CI(`verify.yml`)가 한 번 돌린다. 같은 커밋에서 전체 검사를 따로 되풀이하지 않는다. CI가 떨어지면 원인을 고친다
- **CI용 push(D439):** Neon은 자기 묶음 브랜치를 CI용으로 원격에 올릴 수 있다. main·dev·태그·릴리즈 브랜치와 강제 덮어쓰기는 여기에 들지 않는다. CI 결과를 볼 때는 그 실행의 커밋 SHA가 자기가 올린 SHA와 같은지 먼저 확인한다
- **합치기 전에 CI를 직접 돌린다(D447):** safetyreport 레포의 CI는 push만으로는 돌지 않는다(모바일 `verify.yml`, map `product-check.yml`, auth `check.yml`은 PR·수동 실행 전용). Neon은 총괄에게 통합을 요청하기 전에 묶음 브랜치에서 그 레포의 검사 워크플로를 직접 실행한다(`gh workflow run <워크플로> --ref <묶음 브랜치>`, 모바일은 `distributed_verify=true`). 검사 워크플로가 없는 레포(ops-console 등)는 고정 커밋에서 그 레포의 시험 명령을 돌린다. 여러 레포를 건드린 묶음은 레포마다 돌린다. 보고서에는 레포별 실행 번호와 SHA를 적고, 총괄은 감사에서 그 SHA가 통합할 SHA와 같은지 확인한다. 통과한 CI가 없는 SHA는 통합하지 않는다
- **Neon 보고:** 묶음이 모두 끝나면 Neon은 총괄에게 보고서로 알린다. 보고서에는 한 일, 원인(파일:줄)과 수리, 검수 결과, CI 실행 번호와 그 SHA, 띄운 작업자의 agentId, 실패 회차, 지운 것과 남긴 것(사유), 남은 일을 적는다
- **통합 직전 총괄 감사(D446):** 총괄은 묶음 브랜치·worktree를 통합하고 세션을 정리하기 바로 전에 직접 감사한다. 보고서의 검수 결과와 같은 SHA의 CI 통과를 확인하고, 실제 diff를 읽어 원인 설명이 코드와 맞는지, 바뀐 파일이 맡긴 범위 안인지, 덮거나 우회한 수리가 없는지 본다. 문제가 있으면 통합하지 않고 Neon에게 되돌려 보낸다. 감사를 통과한 뒤에 통합하고 세션을 정리한다
- **총괄의 감독:** 총괄은 Neon과 그 아래 작업자를 지켜보다가 바로잡는다. 바로잡을 때는 이런 경우다: Neon이 직접 하지 못하는 일(시험 기기, Mac mini, 권한, 공용 자원)이 있을 때, 다른 커밋의 CI를 보고 있을 때, 표와 다른 모델을 쓸 때, 덮는 수리를 받아들일 때. 지시는 Neon에게 한다. Neon이 끊기거나 멈췄을 때만 구현자에게 직접 지시하고, 그 내용을 Neon에게도 알린다
- 에이전트 제목은 `<에이전트>-<작업>`으로 단다(예: `neon-<작업>`, `neon-device`, `muse-<작업>`, `sol-<작업>`, `opus-review-<작업>`, `opus-design-<작업>`, `hydrogen-<작업>`, `astra-plan-<작업>`)
- **5회 규칙(D441, 이전 3회 규칙을 대체):** 같은 오류(같은 검수 지적·같은 실패 유형)를 구현자가 5회 고쳐도 해결되지 않으면 어려운 작업으로 보고 Neon이 한 번 직접 고친다. 그 수정은 별도 Opus 세션이 검수한다. 그래도 해결되지 않으면 Neon은 멈추고 총괄에게 보고하고, 총괄은 Neon의 원인 판단과 기록을 붙여 **Astra**에게 원인·설계를 다시 보게 한다. 회차는 Neon이 세어 보고에 적고 총괄이 ledger에 옮긴다. 작업자가 일하다 끊긴 것(Paseo 상태 `closed`)은 실행기 이상이지 실패 회차가 아니다
- 조사(Hydrogen, 한도 시 Flash, 그다음 Terra) 결론은 조사를 맡긴 쪽(총괄 또는 Neon)이 코드·이미지·시험으로 다시 확인한 뒤에 받아들인다
- **임시 파일은 쓰고 나면 지운다(2026-11-17 사용자 지시):** 이 PC의 `/tmp`는 램디스크가 아니라 디스크다. 남겨 두면 그대로 디스크를 채운다(2026-11-17 `/tmp` 1.45TB). 총괄·Neon·구현자·조사자 모두 `/tmp`와 작업 공간에 만든 임시 작업트리·빌드 산출물·시험용 폴더·컨테이너·볼륨을 **그 일이 끝나면 바로 지운다.** 보고에는 지운 것과 일부러 남긴 것(사유)을 적는다. 남이 만든 것과 쓰는 중인 것은 지우지 않는다. 총괄과 Neon은 결과를 회수할 때 남은 것이 없는지 확인하고, 모든 작업서에 이 규칙을 적는다
- **GitHub Actions artifact 보관 1일(2026-11-02 사용자 지시, 모든 safetyreport 레포):** 별도 브랜치·개별 빌드·수동 실행 워크플로를 포함해 `actions/upload-artifact`는 항상 `retention-days: 1`로 둔다. artifact 용량은 계정의 모든 레포가 함께 쓴다. 워크플로를 새로 만들거나 고칠 때도 같다
- **하위 에이전트 완료 감시·알람 필수(2026-11-02 사용자 지시):** 작업자를 발주·재발주·재개할 때마다 그 자리에서 완료 알림(`notifyOnFinish`)을 켠다. Neon도 자기가 띄운 작업자에 켠다. 총괄은 백그라운드 감시를 함께 걸고, 감시 대상에 Neon과 그 아래 작업자를 모두 넣는다. 감시는 보고 파일 생성·갱신, 질문·권한 요청 대기, 작동 중이던 작업자의 멈춤(`idle`·`closed`·`error`), 한도·용량 오류, 예상 시간 초과를 모두 잡는다. 알림을 처리하면 곧바로 감시를 다시 걸고, 감시 기준 시각(MARK)은 실제로 처리를 마친 보고까지만 올린다. 자세한 명령은 모바일 레포 `docs/agent-dispatch-runbook.md` "완료 감시·알람" 절
- 모델 문자열이 바뀌면 이 표와 사본, 모바일 레포·map 레포의 `docs/agent-dispatch-runbook.md`를 함께 고친다. Paseo 모델 목록에 없는 모델을 써야 하면 사용자에게 요청한다(`~/.paseo/config.json`은 전역 설정이라 작업자가 고치지 않는다)

### 팀 정본(`~/projects/safetyreport/.team/`) 갱신 규칙
- **누가:** `ledger.md`·`HANDOFF.md`는 총괄(Claude). `decisions.md`(사용자 결정 기록)와 결정 요약(`reports/decisions-digest-*.md`)은 **결정 담당 세션**(Hermes, Sol 6.2 — Paseo 제목 `hermes-sol-decisions`)이 고친다(2026-11-21 사용자 결정 D345·D349)
- **언제 (그때마다 즉시):** 총괄은 Neon 발주, Neon 보고 회수, 통합, 출고가 생기면 `ledger.md`를 바로 고친다. 발주 기록에는 Paseo `agentId`를 적고, Neon 아래 작업자의 `agentId`와 실패 회차는 Neon 보고서에서 옮겨 적는다
- **사용자 결정:** 총괄은 사용자 결정이 필요한 질문을 결정 담당에게 보내고, 결정 담당이 사용자에게 묻는다. 사용자의 답(결정 담당 세션에 직접 말한 결정 포함)은 결정 담당이 `decisions.md`에 원문과 번호로 적고 총괄에게 `[결정 D번호]`로 알린다. 총괄은 지난 결정을 기억으로 쓰지 않고 결정 담당에게 조회한다(컨텍스트 압축 뒤에도 같다). Neon도 지난 결정을 기억으로 쓰지 않고 결정 담당에게 직접 조회한다. 사용자에게 새로 물을 일은 총괄에게 올린다(D444)
- **인계·세션 종료·재시작 전:** `HANDOFF.md` 맨 위의 현황을 지금 상태로 바꿔 쓴다
- Neon·구현·조사 담당자는 `.team`을 직접 고치지 않는다. 보고서(자기 `status/<이름>.md`, 보고 메시지)로만 알린다
- 이 갱신은 총괄과 결정 담당이 규정을 지켜서 하는 것이고, 시스템이 자동으로 해 주지 않는다. 사용량이 갑자기 끊기면 마지막 갱신이 빠질 수 있으므로, 재시작하기 전에 사용자가 "팀 정본 갱신해"라고 말하면 그 자리에서 갱신한다


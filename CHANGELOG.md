# Changelog

작업, 버그 수정, 세션 기록용 문서.

- 구조/운영 컨텍스트는 `CLAUDE.md`에 유지
- 2026-05-06에 기존 `CLAUDE.md`의 작업 로그를 이 파일로 이관

---

## 2026-10-03 · 1.2.1 최근 변경 검토의 버그·UI 개선

수정:
- 신고·담당자 동시 페이지 요청은 각각 현재 누적 목록에 병합한다. 목록별 중복 요청을 막고 실패 안내와 재시도 버튼을 유지한다.
- 차량·주소 패널 화면 데이터에 60초 유효기간을 적용한다. 같은 검색어를 다시 열 때 만료된 결과를 재조회하고, hash 이동 후 같은 DOM 노드의 현재 값을 다시 읽는다. 닫은 주소 패널은 주소 클릭/포커스로 다시 연다.
- 옵션 runtime/storage 알림을 묶어 외부 모드·계정·서버 변경을 반영하고 편집 중인 입력값을 보존한다. 선택된 모드를 빈 안내 항목으로 바꿀 수 없게 한다.
- URL·키·알림·확인 주기 수정과 모드 전환은 이전 입력값 테스트를 무효화한다. 권한 요청 전부터 작업을 식별해 늦은 권한 승인·테스트 응답도 적용하지 않는다.
- 저장 결과·저장된 서버 연결 상태·현재 입력값 테스트를 분리한다. 저장 후 실제 연결을 확인하고, URL·키를 정규화해도 저장 완료 안내를 유지한다. 로그인/로그아웃 실패는 별도 오류 영역에 유지한다.
- 알림이 허용된 selfhost 폴링은 실행 상태 전환과 별도로 `/crawl/done/ext` 완료 기록을 읽으며 done=true일 때만 완료 알림을 만든다. 알림 미사용·권한 없음·cloud에서는 소비하지 않는다. 시작/완료 알림 ID를 분리한다. 기존 서버의 마지막 기록을 읽고 제거하는 계약은 그대로이며 서버가 제공하지 않는 기기별 큐를 가정하지 않는다.
- 처리중 배지의 마지막 정상 확인 건수를 서버 origin·키 SHA-256 지문에 묶어 저장하고 worker/브라우저 재시작 때 복원한다. 복원 자체는 통신하지 않으며 cloud·다른 서버/키·차단·폴링 실패에는 이전 건수를 표시하지 않는다.
- selfhost 크롤링 상태·시작/중지 메뉴를 팝업 상단으로 옮겨 최대 200개 최근 답변 앞에서 접근할 수 있게 한다. 디자인 토큰·closed Shadow DOM·원본 이벤트 전파와 모드별 통신 분리는 유지한다.

검증:
- `npm test`: 48개 통과. 추가 회귀 14개는 동시 페이지 응답 순서 양쪽·중복 클릭, 화면 캐시 만료, 같은 노드의 페이지 이동·주소 재열기, 모드 동기화·편집 보존·빈 선택, 늦은 테스트/권한 응답·모드 왕복·중간 화면 없는 외부 왕복, 같은 계정 토큰 갱신과 계정 변경 구분, 저장/연결 분리, 로그인/로그아웃 오류 유지, 200건 앞 크롤링 메뉴, 짧은 완료 기록 소비·중복 방지·비활성 미소비, 배지 복원 범위·실패를 검사한다.
- `npm run test:contracts`: 10개 통과. PC/map 정본 계약 사본은 변경하지 않았다.
- `npm run build`: 1.2.1 기본 selfhost 빌드 통과. cloud 공개 설정 없는 빌드를 운영 cloud 검증으로 부르지 않는다.
- 별도 unpacked Chromium 153.0.8010.12 + 로컬 mock 서버: 옵션 두 탭 모드 동기화, closed Shadow DOM·같은 주소 노드 hash 이동, 실제 alarm dispatch의 폴링 사이 완료 알림, worker CDP 중단 및 브라우저 재시작 뒤 배지 복원 통과. 기존 설치/마이그레이션·크롤링 제어·복사·입력 교체·focus·모드별 통신·버전/인증/오프라인 검사도 통과.
- 실제 action popup 경계 검사 통과: 460×510, footer 509, 본문 가로 overflow 없음. 라이트/다크 옵션·팝업 캡처를 검수했다. 결과는 `artifacts/backend-browser/`.
- 실제 카카오 OAuth·운영 Supabase/PC 서버·실제 OS Alt-Tab·설치 권한 다이얼로그는 미검증이며 mock/SDK/Chromium 결과와 구분한다.

다른 저장소·운영 설정은 변경하지 않았으며 로컬 커밋만 작성한다. push·배포·스토어 제출 없음.

---

## 2026-10-03 · 1.2.0 셀프호스팅 / 클라우드 실제 백엔드 분리

최신 확장 dev `b0127dc`를 fast-forward한 뒤 `feat/backend-modes-20261003`에서 작업. 최초 미커밋 변경 없음. 로컬 구현·커밋이며 push·배포·스토어 제출 없음.

변경:
- 옵션 상단에 `backendMode: selfhost | cloud`와 명시 선택 대기를 추가. 과거 서버 주소·API 키·연결 테스트·알림·확인 주기를 복구하고 각 모드 설정을 따로 보존한다. 저장과 입력값 연결 테스트를 구분한다.
- worker adapter가 실제 PC REST와 Supabase my-reports POST를 분기한다. 차량·주소·요약·최근 답변·번호 복사·공식 원문/내 서버 상세·서버 관리·크롤링 제어·알림·배지를 복구/유지한다. 모드별 기능표는 README.
- selfhost 인증·동의는 서버가 결정하며 확장 Supabase 로그인은 불필요. cloud에는 서버 키·호환 헤더·크롤링 메뉴·폴링·처리중 배지를 보내거나 표시하지 않는다. 실패 시 다른 백엔드로 전환하지 않는다.
- explicit 선택 > legacy 단일 설정 추론, 양쪽 설정/신규 설치는 선택 UI. legacy sync 서버 설정을 TRUSTED_CONTEXTS local에 먼저 옮기고 비밀키 사본만 제거. worker·브라우저 재시작에도 선택 유지.
- 모드/서버/계정 변경 때 AbortController·세대 검증·backend/서버 origin 또는 Supabase 계정/조회 조건 캐시 폐기. SDK의 이전 refresh 재시도도 원래 client 세대에 묶어 빠른 모드 왕복 후 추가 통신을 막는다. 명시 로그아웃은 오프라인에서도 자기 local 세션을 제거한다.
- PC 정본 `contracts/selfhost-compat/README.md`, `vectors.json`을 바이트 복사. PC dev `a35b7d2` 기반 `fix/v3-user-reports-20261003` 작업 트리에 생성된 정본을 사용했다(당시 원격 dev에는 아직 없음). README SHA-256 `e316079f01cbcb2a2f4b37d0be732b198587b9c36ca7a5abe5b4cb9ded428a24`, vectors `c618527719c7a54790b051a632a2093e697499596742fe5028f94b149e85bd6f`. map my-reports 사본은 수정하지 않았다.
- 인증된 버전 probe의 실제 서버 major >=3 및 최상위 protocol 지원 필드를 매 실제 요청 전에 검사. 4자리/dev/product 1.x를 올바르게 처리. 연결 테스트는 실제 상태 API·동의 게이트까지 확인. 409 호환 거부는 알람을 중단하고 수동 연결 테스트로 재개. 기존 구현처럼 REST만 사용하며 WS/4406 경로는 없음.
- 필수 host permission은 Supabase origin 하나, selfhost는 optional HTTP/HTTPS 선언에서 입력 origin 하나만 요청. 알림도 선택 권한. CSP 변경 없음. DTO를 worker에서 투영하고 원문 오류는 코드 allowlist로만 전달한다.
- 기존 디자인 토큰·13~16px 글자·결과/처분 색상·closed Shadow DOM·원본 입력/클릭 전파 유지. worker 재시작은 열린 패널을 닫지 않고 캐시를 버려 재조회한다.

자동 검증:
- `npm test`: 34개 통과 (Node 22, 실제 Chrome UI fixture 테스트 포함).
- `npm run test:contracts`: 10개 통과. map MANIFEST, PC 계약 스냅샷 및 공유 벡터, 헤더/오류/DTO 검사.
- worker/adapter: 신규·legacy 서버만·cloud 세션만·양쪽·명시 모드·재시작, selfhost→cloud→selfhost의 늦은 응답·서버/계정 변경, 중복 poll/알림/배지, 업데이트 거부 지속 중단, 오프라인 로그아웃을 검사했다.
- 실제 Supabase JS SDK + mock HTTP로 만료 세션·모드 왕복 중 refresh를 검사. selfhost의 cloud 요청 0건, cloud의 자기 서버 요청 0건. 갱신을 중단한 뒤 SDK가 내부 재시도를 마칠 때까지 기다려 실제 추가 네트워크 0건과 토큰 보존을 확인했다.
- `npm run build`: 제품 1.2.0, 기본 selfhost 가능 / cloud 공개 설정 없는 빌드 통과.

별도 실제 브라우저 검증:
- `SR_CHROMIUM_PATH=/home/better0101/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome npm run test:backend-browser`: Chromium 153.0.8010.12 unpacked 확장, 실제 service worker와 closed Shadow DOM content script, 로컬 mock 서버로 통과.
- 옵션·팝업·차량/주소 패널, 라이트/다크, 서버 키 마스킹, 실제 번호 복사, 서버 크롤링 시작/중지, 모드 변경 뒤 서버 요청 0건, node 교체·tab 전환·blur/focus·Alt-Tab 키 조합·클릭 버튼 release 뒤 패널 유지, 원래 페이지 click/input 이벤트 전달을 검사했다.
- 새 설치와 legacy/cloud/양쪽/명시 선택의 cold-start 마이그레이션을 각각 브라우저 프로필에 저장한 후 재시작해 확인. CDP로 worker를 실제 중단한 뒤 전역 marker 소멸 및 첫 검색 정상 유지를 확인. 서버 2.x·protocol 미지원·401·오프라인 안내를 구분했다.
- `npm run test:action-popup`: 실제 action popup 460px, 단일 스크롤·footer/viewport 경계 통과.
- 캡처와 결과는 `artifacts/backend-browser/`, 기존 cloud fixture 캡처는 `artifacts/ui-review/`. 이미지의 폰트·상태톤·마스킹·모드별 메뉴를 별도로 검수했다.

검증 한계:
- 실제 카카오 OAuth, 운영 Supabase/my-reports/PC 서버, 실데이터 A/B 권한, 로그인된 안전신문고 원문 링크의 실제 열람은 검증하지 않았다. SDK·mock·브라우저 통과와 구분한다.
- 실제 OS 창 전환 Alt-Tab은 headless 환경에서 미검증. 키 조합·실제 브라우저 tab 이동·blur/focus 회귀를 검사했다.
- 브라우저 테스트 사본 manifest에 해당 mock origin/알림만 미리 허용했다. 운영 설치의 Chrome 권한 허용 다이얼로그는 미검증.
- 다른 저장소 코드는 변경하지 않았다. 사용자 후속 지시로 PC 저장소에 `pull --ff-only`만 수행했으며 로컬 수정은 보존했다. 운영 설정은 변경하지 않았다.

---

## 2026-09-30 · my-reports-v1 계약으로 전환

- map 정본 계약 `contracts/my-reports/`(v1)를 사본으로 추가하고 MANIFEST 검사 테스트를 둔다.
- offset/limit/expected_version 초안 대신 서명 커서(`next_cursor`)로 목록·담당자·최근 3일·번호 페이지를 넘긴다. 담당자는 100명 제한 없이 `담당자 더 보기`.
- 번호 복사는 500개 페이지를 끝까지 모은 뒤에만 클립보드에 쓰고, 페이지 사이 자료 변경·불완전 목록·상한 초과는 복사하지 않는다.
- 요약은 v1 중첩 필드(status/disposition/fine_amount)와 서버 `accept_rate`를 쓰고 확정 금액이 없으면 0원이 아니라 “확인된 금액 없음”으로 표시.
- 원문 링크는 서버 `official_url`을 공식 접두사로 다시 확인해서만 사용. 팝업은 서버가 정한 최근 기간(`recent_start~recent_end`)을 표시.
- 오류: 401 refresh 1회, 403 접근 불가, 409/`INVALID_CURSOR` 첫 페이지부터 1회 재조회, 429 `Retry-After` 동안 요청 중단, 비계약 응답은 실패로 처리.
- 테스트 fixture를 계약 fixture(로컬 스택 실제 응답)로 교체. 운영 DB·Edge 배포와 실제 확장 설치 검증은 별도.

---

## 2026-09-30 · 1.1.0 로컬 구현 후보

- 서버 주소/API 키·크롤링 제어·주기 알림·처리중 배지를 제거하고 worker 소유 Kakao PKCE 로그인 및 본인 완료 신고 조회 API로 전환.
- 원본 차량번호·공식 신고 상세 링크·6글자 차량 부분 검색·주소/담당자 요약과 번호 복사를 새 UI 계약으로 구성.
- Shadow DOM 패널, DOM 교체 감시, 단일 전역 이벤트 controller, 비동기 세대 검증으로 입력 클릭 직후 닫힘과 오래된 응답 문제 수정.
- PC 토큰 기반 라이트/딥 다크, 460×570 팝업, 13~16px 정보 밀도와 단일 본문 스크롤 적용.
- 로컬 빌드/모의 테스트 완료 여부는 최종 검증 결과로 따로 기록. 운영 DB·Edge·스토어 배포는 이 이력만으로 완료가 아니다.

---

## 2026-05-06

### 중복 신고 변경도 크롤링 완료 알림으로 표시

상태: 완료

변경:
- `background.js`
  - `/api/v1/crawl/done/ext` 응답의 `notification_kind=duplicate` 항목을 인식하도록 확장
  - 일반 신고 변경과 중복 신고 변경을 다른 문구로 렌더링
  - 알림 제목도 `신고 N건, 중복 N건` 형태로 요약되도록 조정

검증:
- `node --check background.js`

비고:
- 중복 신고 변경은 현재 `신규 중복군`, `멤버 변경`, `대표건 변경` 세 종류를 구분해서 알림 줄을 만든다.

### 차량번호/주소 패널 중복 조회 억제 + stale 응답 무시

상태: 완료

변경:
- `background.js`
  - `FETCH_VEHICLE`, `FETCH_ADDRESS` 에 대해 동일 URL 기준 in-flight Promise dedupe 추가
  - 같은 요청이 동시에 들어오면 하나의 fetch 결과를 공유하고, 완료 후 map에서 제거
- `content.js`
  - 차량번호 패널: `vehicleInFlightValue`, `vehicleRequestSeq`, `lastData` 기반 중복 요청 억제
  - 주소 패널: `addrInFlightValue`, `addrRequestSeq`, `lastAddrData` 기반 중복 요청 억제
  - 이미 로딩 중인 값에 대한 `focus`/`click`/MutationObserver 재호출 방지
  - 늦게 도착한 stale 응답이 새 패널 상태를 덮어쓰지 않도록 sequence guard 추가
  - `hashchange` 시 차량/주소 in-flight 상태도 함께 초기화

검증:
- `node --check background.js`
- `node --check content.js`
- 실제 서버 로그 기준으로 같은 차량번호/주소가 짧은 시간에 반복 호출되던 패턴을 코드 경로와 대조해 원인 확인

비고:
- 이 수정은 확장 쪽 중복 호출과 UI race를 줄이는 1차 대응이다.
- 서버 `/api/v1/vehicle`, `/api/v1/address` 는 여전히 부분일치 전체 스캔 성격이라,
  DB가 커지면 서버 최적화가 추가로 필요할 수 있다.
- 서버 파서 회귀 확인과 fixture 검증은 `safetyreport` 레포 CHANGELOG에 기록한다.

### 문서 역할 분리

상태: 완료

변경:
- `CHANGELOG.md` 신설
- `CLAUDE.md` 를 구조/작동 방식/주의점 중심 문서로 재작성
- 기존 `CLAUDE.md` 작업 로그를 `CHANGELOG.md` 로 이관
- `.gitignore` 에서 `CLAUDE.md` 제외 규칙 제거

---

## 2026-04-22

### 신고 페이지 우측 주소별 신고 패널 추가

상태: 완료

변경:
- `content.js`
  - `#add1` span 감시(MutationObserver) → 주소 변경 시 자동 조회 + 패널 표시
- `content.css`
  - `#sr-address-panel` — `position: fixed; right: 10px` 우측 고정 패널
  - 패널 구조: 상단 통계(처리상태별 건수/비중, 과태료/범칙금 비중, 담당자별 막대 그래프)
    + 하단 스크롤 목록 (VHRNO 패널과 동일한 카드 형식)
- 서버: `search_by_address()` 함수 추가 (위반장소 부분 일치 검색, exclude_withdraw 반영)
- 서버: `GET /api/v1/address?q=주소` 엔드포인트 추가
- `background.js`
  - `FETCH_ADDRESS` 메시지 핸들러 추가 (FETCH_VEHICLE과 통합)
- `hashchange`
  - 주소 패널도 초기화

비고:
- 취하 데이터 숨기기 설정이 VHRNO 패널에도 반영되도록 `search_by_vehicle()`에 `exclude_withdraw` 필터 추가

---

## 2026-04-18

### 팝업 UI 개선

상태: 완료

변경:
- 팝업 가로 360px → 380px
- 최근 3일 답변 목록 최대 높이 120px → 200px
- 최근 3일 답변 클릭 시 안전신문고 공식 사이트 대신 웹앱 `/data/all?open=신고번호`로 이동
  - `popup.js`: ID 기반 → 신고번호 기반 클릭 링크 변경
  - 서버 `data_table.html`: `?open=신고번호` URL 파라미터 자동 감지 → 검색 + 상세 모달 자동 오픈

---

## 2026-04-17

### SPA 해시 이동 대응 + 완료 알림 개선

상태: 완료

변경:
- SPA 해시 이동 시 차량번호 패널 미표시 수정
  - `hashchange` 이벤트 감지 → 상태 초기화 후 300ms 대기 후 재초기화
  - `attachedInput` 추적으로 동일 요소 중복 이벤트 등록 방지
- 크롤링 완료 알림 미발송 문제 수정
  - 원인: `/crawl/done` 파일이 WS 브로드캐스트 시 이미 소비됨
  - 수정1: `background.js` — `wasCrawling→!isRunning` 전환 자체를 완료 신호로 사용
  - 수정2: 서버에 `crawl_done_ext.json` (크롬 확장 전용) 추가
    - `save_crawl_done_ext()` / `get_and_clear_crawl_done_ext()` / `GET /api/v1/crawl/done/ext`
    - 완료 핸들러 3곳에서 저장
  - 알림 내용: 신고번호 + 신고명 (최대 3건, 초과 시 `외 N건`)
- 팝업 연결 상태 옆 서버 버전 표시
  - `GET /api/v1/server/version` 엔드포인트 추가 (updater.py 활용, GitHub 최신 버전 비교)
  - 최신: `v2.1.4 ✓`
  - 구버전: `v2.1.3 → 2.1.4`
  - 확인불가: `v2.1.4`

---

## 2026-04-16

### 권한/스토어 대응 수정

상태: 완료

변경:
- 스토어 재설치 후 권한 없이 fetch 시도하는 문제 수정 (1.0.2)
  - 원인: `chrome.storage.sync`는 유지되지만 `optional_host_permissions`은 재허용 필요
  - 수정: `popup.js load()`에서 `chrome.permissions.contains()` 로 권한 사전 확인
  - 권한 없으면 "권한 필요" 상태 표시 + "권한 허용" 버튼 노출
- `options.js` 연결 테스트 버튼도 권한 요청 추가
- 스토어 심사 대응 (1.0.3)
  - `manifest.json`: `clipboardWrite` 권한 추가
  - `content.js`: `vehicleNumber`, `err.message` 삽입 시 `esc()` 적용
  - 개인정보처리방침 URL 필요

---

## 2026-04-15

### 저장 시 권한 요청 컨텍스트 수정

상태: 완료

변경:
- 스토어 버전에서 `Failed to Fetch` 문제 수정 (1.0.1)
  - 원인: `chrome.permissions.request()`를 `storage.sync.set()` 콜백 내부에서 호출해 사용자 제스처 컨텍스트 만료
  - 수정: `options.js` 저장 버튼 핸들러에서 권한 요청을 첫 번째 호출로 이동
  - 권한 거부 시 저장도 중단

---

## 2026-04-14

### Chrome 웹 스토어 권한 심사 대응

상태: 완료

변경:
- `manifest.json`
  - `host_permissions: ["<all_urls>"]` → `optional_host_permissions: ["<all_urls>"]`
- `options.js`
  - 서버 URL 저장 시 해당 origin에 대한 호스트 권한 런타임 요청 추가

---

## 2026-04-10

### 초기 버그 수정과 패널 개선

상태: 완료

변경:
- 아이콘: 서버 이미지 기반 16/48/128 리사이즈
- `popup.js`
  - API 응답 필드명 camelCase로 수정
- `popup.html/css`
  - 일부수용 카드 추가 (5열 그리드)
- `content.js`
  - 차량번호 fetch → background SW 경유 (Mixed Content 우회)
  - `#VHRNO` MutationObserver 대기 추가 (동적 로드 대응)
  - focus 이벤트 추가
  - 카드 필드 확장: 신고번호, 차량번호, 처리기관, 담당자, 신고내용
  - 헤더 "신고번호 복사" 버튼 추가
  - `lastData` 캐시 도입: focus/click 시 캐시 결과 즉시 재표시
  - 패널 요약 2그룹 개편
  - 카드 클릭 → 안전신문고 신고 상세 새 탭
- `background.js`
  - `FETCH_VEHICLE` 메시지 핸들러 추가
- 팝업 교통위반 요약: 범칙금 → 경고/범칙금
- 크롤링 알림: `wasCrawling`을 `storage.local`에 저장
- 배지 필드명 수정: `processing_count` → `processingCount`
- 최근 3일 답변 확장: 신고번호, 차량번호, 과태료, 담당자 추가 / 클릭 → 안전신문고 새 탭
- 팝업 너비 320 → 360px
- `VERSION` 파일 + `set_version.py` 추가

비고:
- "연결중인 기기" 미표시는 정상 — 크롬 확장은 REST API만 사용, WebSocket 미연결

---

## 2026-04-09

### 초기 구조 생성

상태: 완료

변경:
- 크롬 확장 초기 구조 생성
  - `manifest.json`
  - `popup`
  - `options`
  - `background`
  - `content`
- 서버에 `GET /api/v1/vehicle/{vehicle_number}` 엔드포인트 추가
  - 서버 `search_by_vehicle()` 함수 추가
- `content.js`
  - 안전신문고 신고 페이지 `#VHRNO` 입력 감지 → 이전 신고 내역 플로팅 패널 표시
- `main` / `dev` 브랜치 생성, 초기 커밋

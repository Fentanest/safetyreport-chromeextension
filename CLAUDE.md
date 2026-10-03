# 확장 구조 및 운영 메모

현재 제품 버전 1.2.2. `src/background.js`를 esbuild로 묶은 `build/background.js`, `content.js`, `popup.js`, `options.js`, `shared-ui.js`가 실행 기준이다. 작업 기록은 `CHANGELOG.md`, 모드별 기능표와 사용 안내는 `README.md`에 둔다.

- `src/backendConfig.js`: `backendMode: selfhost | cloud` 및 null(선택 대기)의 순수 마이그레이션. 명시 선택 우선, legacy 서버와 Supabase 세션을 모두 보존한다. 서버 origin만 받고 HTTP·LAN·localhost·IPv6를 지원한다.
- `src/background.js`: 모드 dispatch, 신뢰된 컨텍스트만 설정/로그인/크롤링 제어 허용. `storage.local`은 TRUSTED_CONTEXTS로 제한한다. 모드/계정/서버 변경과 worker 재시작은 요청 abort·세대 갱신·캐시 폐기·페이지 알림을 수행한다. cloud client는 필요할 때만 생성하며, SDK의 오래된 refresh 재시도도 클라이언트 세대로 차단한다. 자동 refresh 없음, 요청 시 refresh·401 재시도는 flight를 공유한다. 모드 전환은 로그아웃하지 않는다.
- `src/selfhostClient.js` / `src/selfhostCompat.js`: API 키와 실제 manifest 제품 버전·protocol 3 헤더로 PC REST API를 호출한다. 매 실제 요청 전에 `/server/version`의 실제 major와 최상위 호환 필드를 검사한다. 연결 테스트는 `/crawl/status` 게이트도 확인한다. 제품 1.x 확장을 막거나 버전을 3으로 속이지 않는다. 409 호환 오류는 폴링을 중단하며 자동 fallback 없음. 기존 REST 경로만 쓰므로 WS/4406 재연결 경로는 없다.
- selfhost 폴링: 단일 alarm/flight, 서버 origin·API 키 SHA-256 지문으로 이전 실행 상태를 구분하고 worker 재시작 뒤 복원. 시작·완료/중복 변경 알림과 처리중 배지는 selfhost에만 있다. 알림은 optional permission. cloud에선 alarm과 기존 알림을 정리한다. 알림이 허용된 selfhost 폴링은 소비형 `/crawl/done/ext`를 실행 상태 전환과 별도로 확인하고 done=true일 때만 완료 알림을 만든다. 마지막 정상 처리중 건수를 같은 서버·키 지문에 묶어 재시작 때 복원하며 실패·차단·서버/키 변경 시 복원하지 않는다.
- cloud: 기존 Supabase JS PKCE Kakao OAuth 및 `chrome.identity.launchWebAuthFlow`, my-reports POST만 사용한다. selfhost 헤더나 API 키를 보내지 않는다. API 키·토큰·서버 원문 오류를 content script에 전달하지 않는다. `src/myReportsClient.js`가 요청/오류와 DTO projection을 담당한다.
- `content.js`: 문서당 하나의 이벤트 controller, `#VHRNO`·`#add1` 노드 identity 재바인딩, closed Shadow DOM 패널. 원본 입력·클릭 전파를 막지 않는다. 정규화 차량 query 6글자 미만은 두 모드 모두 요청하지 않는다. 비동기 세대 검증을 유지한다. 화면 데이터 TTL은 60초이며 만료 후 재열기에서 재조회한다. 신고/담당자 페이지는 목록별 flight와 현재 상태 병합으로 처리한다. hash 이동 때 같은 노드도 다시 읽으며 주소 클릭/포커스로 닫은 패널을 재연다.
- `options.js`: runtime/storage 변경을 묶어 현재 모드를 동기화하고 편집 중인 서버 값은 보존한다. 저장 결과·저장된 서버 연결·입력값 테스트·계정 오류를 분리한다. 입력 수정/모드 왕복은 이전 테스트 응답을 무효화한다. 중간 화면 없는 빠른 외부 왕복도 알림 세대로 무효화하며 같은 계정 토큰 갱신은 연결 테스트를 취소하지 않는다. 팝업의 selfhost 크롤링 조작은 최근 목록 앞에 표시한다.
- `shared-ui.js`: 모드별 DTO allowlist 표시. cloud 완료 통계와 selfhost 전체/검색 통계를 혼동하지 않는다. 없는 금액·서버 통계를 가짜 0으로 만들지 않는다. 결과·처분 별도 톤, 입력 HTML escape. 검색 카드 원문 링크는 `/#mypage/mysafereport/<source_report_id>`. selfhost 최근 답변은 자기 서버 `/data/all?open=신고번호`.
- `ui-tokens.css` / `ui-components.css`: 기존 PC 토큰, 모바일 딥 다크·상태톤·13~16px 글자 크기와 단일 스크롤 유지. `content.css`는 host만, 실제 스타일은 ShadowRoot 안에 넣는다.
- `contracts/my-reports/`: map 정본의 바이트 사본. 직접 고치지 않고 map의 `scripts/integration/sync_contract_copy.py --contract my-reports --to <이 레포>`로 갱신한다. 운영 지침은 map `docs/integration/chromeextension/EXTENSION_HANDOFF.md` 및 `REPORT.md` §6.
- `contracts/selfhost-compat/`: PC `safetyreport` 정본의 바이트 사본. product/version·HTTP 오류·WS 계약·공유 vectors를 그대로 복사한다. 소비자 테스트의 스냅샷 해시도 정본 복사에 맞춰 갱신한다.
- 안전신문고 페이지 범위: content_scripts와 Shadow DOM 스타일 WAR는 `http://www.safetyreport.go.kr/*`, `https://www.safetyreport.go.kr/*`에만 적용한다. worker content 역할도 같은 HTTP/HTTPS 정확 호스트의 top frame + 확장 ID만 허용한다. 다른 호스트·유사 도메인·하위 frame은 거부한다.
- host permission: 필수는 빌드한 Supabase origin만, optional HTTP/HTTPS 범위에서 사용자가 입력한 서버 origin만 클릭 시 요청. 전체 host grant와 CSP 완화 금지. 테스트 manifest의 exact mock origin 사전 허용을 실제 권한 다이얼로그 검증으로 부르지 않는다.
- 검증: `npm test`, `npm run test:contracts`, 빌드 후 `SR_CHROMIUM_PATH=... npm run test:backend-browser`, `npm run test:action-popup`. browser artifact는 `artifacts/backend-browser/`에 생성한다.

안전신문고 링크의 실제 원문 열람, 운영 카카오 로그인·실데이터 A/B 권한·운영 서버, OS Alt-Tab은 별도 검증한다. 로컬 mock/SDK/Chromium 검증을 운영 검증이라고 부르지 않는다. 다른 저장소·운영 설정·배포·스토어·push를 이 작업으로 변경하지 않는다.

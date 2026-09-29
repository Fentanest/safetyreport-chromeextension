# 확장 구조 및 운영 메모

현재 버전 1.1.0의 실행 기준은 `src/background.js`를 esbuild로 묶은 `build/background.js`, `content.js`, `popup.js`, `options.js`, 공통 `shared-ui.js`다. 과거 서버 API 설명은 1.0.x 이력이며 현재 계약이 아니다. 작업 기록은 `CHANGELOG.md`에 남긴다.

- `src/background.js`: Supabase JS PKCE Kakao OAuth 및 `chrome.identity.launchWebAuthFlow`를 worker에서 소유한다. `storage.local`은 TRUSTED_CONTEXTS로 제한한다. 개인 조회는 `my-reports` Edge Function에만 POST한다. content script는 토큰을 받지 않는다.
- `content.js`: 문서당 하나의 전역 이벤트 controller, 현재 `#VHRNO`·`#add1` 노드 identity 재바인딩, Shadow DOM 패널. 원본 페이지의 입력·클릭 전파를 막지 않는다. 정규화 차량 query 6글자 미만은 요청하지 않는다.
- `popup.js` / `options.js`: 완료 신고·최근 답변/계정·테마. 서버 URL·API 키·크롤링 UI 없음.
- `shared-ui.js`: DTO allowlist 표시, 결과/처분 별도 톤, 안전신문고 상세 URL builder. 입력값 HTML escape. 안전신문고 원문 링크는 PC 소스의 `/#mypage/mysafereport/<source_report_id>` 규칙을 따른다.
- `ui-tokens.css` / `ui-components.css`: PC `safetyreport/dev` 토큰과 모바일 딥 다크·상태톤을 출발점으로 이식. `content.css`는 host만, 실제 패널 스타일은 ShadowRoot에 넣는다.
- `contracts/my-reports/`: map 저장소가 정본인 my-reports-v1 계약(README·schema·`types.ts`·fixtures)의 바이트 사본. 직접 고치지 않고 map의 `scripts/integration/sync_contract_copy.py --contract my-reports --to <이 레포>`로 갱신한다. `src/myReportsClient.js`가 요청 모양·오류 분류를 담당하고 `types.ts`의 정규화를 그대로 쓴다(esbuild가 번들). 연동 지침은 map `docs/integration/chromeextension/EXTENSION_HANDOFF.md`, 운영 적용 순서는 map `docs/integration/chromeextension/REPORT.md` §6.
- 테스트: `npm test`(Node `--experimental-strip-types`). 브라우저 테스트는 `CHROME_PATH`(기본 `/usr/bin/google-chrome`)의 Chrome/Chromium을 쓴다.

외부 링크가 실제 신고 상세를 여는지는 안전신문고 로그인된 브라우저에서 별도 검증해야 한다. 소스 규칙만 확인한 상태를 실사이트 검증으로 부르지 않는다. 운영 카카오 로그인·실데이터 A/B 권한 테스트도 로컬 모의 테스트와 구분한다.

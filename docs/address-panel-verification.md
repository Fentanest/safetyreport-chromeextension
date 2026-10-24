# 주소 패널 지속 표시 검증 — 1.2.5

2026-10-15. 기준 코드: 수정 전 `ed7aed0`, 수정 후 이 문서를 포함한 1.2.5 릴리스 커밋.
대상은 안전신문고 문서의 `#sr-address-panel-host`와 closed ShadowRoot 내부이며 action popup이 아니다.

## 조사한 표시 상태 경로

| 경로 (`content.js`) | 수정 전 | 수정 후 |
| --- | --- | --- |
| document capture `pointerdown` | 지도, 라벨, 체크박스, 빈 공간이면 address까지 `hide(kind,true)` | 차량만 외부 클릭 닫힘. 지도 selector 예외 없음 |
| `keydown` Escape | 차량이 닫혀 있으면 주소 닫힘 | 차량만 적용 |
| `position()` | 차량과 충돌하면 `autoFold=true`, 본문에 `sr-panel-collapsed` 효과 | 위치/크기만 변경. 좁은 화면은 높이를 나눠 내부 스크롤 |
| `rebind()` | #add1 객체 교체마다 invalidate/hide/query 초기화 | 이전 listener AbortController/observer 해제 후 재연결. 동일 주소는 data/query/접힘/본문 DOM 유지 |
| `addressChanged()` | 짧거나 빈 값이면 즉시 주소 숨김 | 연결된 노드의 빈 값이 900ms 지속돼야 확정 주소/결과 폐기, 열린 창은 선택 안내 표시. DOM 부재는 조회 주소를 지우지 않음 |
| hashchange | 두 패널 모두 숨김/초기화 후 다시 조회 | 주소 상태 유지, DOM 재연결만 수행 |
| AUTH_CHANGED/DATA_INVALIDATED | invalidate 후 hide | 기존 데이터/요청 세대 폐기 후 열린 창 안에서 갱신. 계정 데이터는 숨겨진 DOM까지 즉시 삭제 |
| WORKER_RESTARTED | 열린 상태에 한해 재조회 | 같은 표시 정책 유지. 실제 worker 종료/재시작 검사 포함 |
| search/loadPage/copy의 catch/finally | 늦은 응답 및 재렌더 경로 | 세대/열림 검사 유지. 오류 상태 보존, 주소 응답에 DOM 연결 여부를 요구하지 않음 |
| `show`, `hide`, `refreshVisibility`, host.hidden | 표시 상태 변경 지점 | 주소 hide 진입은 X 버튼 하나. show는 최초/새 선택/주소 클릭. focus/rebind/응답은 X를 취소하지 않음 |
| host 제거 | 참조만 남아 패널 소실 | open일 때 기존 host/root 객체만 재부착. 닫은 host는 복원하지 않음 |
| `render`, collapsed class | autoFold 또는 수동 값 | 수동 버튼만 collapsed 변경. 레이아웃이 class 변경하지 않음 |

`display`, `hidden`, `visibility`, `opacity`, DOM 제거 및 query 초기화도 검색했다. `content.css`의 기존 hidden 규칙은 유지했고 표시 강제 CSS, 무조건 열기 타이머, 전역 이벤트 차단을 추가하지 않았다. 기존 300ms 스캔은 값 변경 감지 용도로 유지한다.

## 실제 DOM과 개인정보

사용자가 대화에 제공한 전체 HTML에서 아래 관계를 확인했다. 원문 파일 전체는 저장소에 저장하지 않았다.

- `#frmSafeReport` → `.table_bbs.singo.tb_sty03` → table/tbody/tr/td → article 안의 `span#add1`.
- 같은 주소 td 안의 별도 `article.daumMap.article > div#map`, 내부 타일/컨트롤 계층.
- 차량 라벨은 th, `input#VHRNO`와 `.ota_check_td` 안 checkbox/label/span은 td.
- 제목/본문은 `#C_A_TITLE`, `#C_A_CONTENTS`.
- `C_ADD1/C_ADD2`는 신고주소와 다른 값이므로 fallback으로 사용하지 않는다.

`tests/fixtures/address-panel.html`은 이 관련 구조만 옮기고 주소는 테스트 값으로 바꿨다. 인적 사항, 기존 host와 저장된 closed shadow, SDK 스크립트/외부 타일은 포함하지 않았다. 테스트 초기화도 잔존 `.sr-extension-host`를 제거한 후 content script를 한 번 실행한다. fixture는 지도 SDK 동작을 복원한 것이 아니다.

## 수정 전/후 분리 재현

`tests/address-panel-persistence.test.mjs` 38개: 수정 전 **6 통과 / 32 실패**, 수정 후 **38 통과**. 수정 전 content/shared/style 바이트를 `artifacts/address-baseline`에 보존해 동일한 최종 테스트를 실행했다.

- 지도는 실제 브라우저 mouse down → 여러 단계 move → up. 누름/이동 각 단계/놓음에서 내부 본문 검사. 주소 유지/새 주소, 결과 있음/0건을 cloud/selfhost 각각 실행.
- 차량 input 중앙(빈 값/조회 가능한 값), label, td 빈 공간, checkbox, checkbox label 및 내부 span을 분리.
- 넓은 화면 input 직접 클릭은 수정 전에도 통과했다. 라벨·주변 영역은 pointerdown에서 open=false/hidden=true가 됐다.
- 좁은 화면의 직접 입력/조회는 수정 전 open=true/hidden=false인 채 autoFold=true, collapsed class, 본문 display:none으로 실패했다. 입력 DOM 교체 없이도 재현되므로 자동 접힘을 별도 원인으로 확인했다.
- 같은 주소 DOM 교체/일시 제거/빈 값 복원은 재조회 횟수, 기존 결과와 스크롤, 오래된 노드 이벤트 무효화를 검사.
- 느린 A → B는 B 대기 중 이전 카드가 없는지, B 완료 후 늦은 A가 결과를 덮어쓰지 않는지 검사.
- 0건/통신 오류, 리사이즈/스크롤/포커스/hash/알림, host 복원, 수동 접힘, X 이후 응답/교체/복귀, 계정 변경 후 과거 성공 응답 차단 포함.

배포 코드에는 관측 API가 없다. 테스트에서만 attachShadow 반환값을 보관하며 **mode는 closed 그대로**다. 테스트용 소스 계측으로 open/collapsed/autoFold/query/generation 및 hide 호출 스택/이벤트 target을 관측했다. 실제 본문/제목의 checkVisibility, hidden, collapsed, 높이, viewport 경계, elementFromPoint 가림, host 중복 수를 함께 검사한다. 로그에 계정 정보나 신고 원문은 넣지 않는다.

## 검증 명령과 범위

- `npm test`: 145 통과. 기존 주소 통계/담당자 페이징/차량 조회/UI 및 새 38개 포함.
- `npm run test:contracts`: 12 통과.
- `node --test tests/release-build.test.mjs`: 3 통과. 소스/build/ZIP content.js 동일성 및 배포 코드에 테스트 훅이 없음을 추가 검사.
- `npm run test:action-popup`: 통과. action popup 변경 없음 확인.
- `npm run test:backend-browser`: 실제 확장 manifest 주입, 실제 background dispatch, closed shadow를 CDP로 관측. mock selfhost 결과 및 cloud 로그인 안내, 실제 worker stop/restart, host 복원, X, 탭 복귀, 100/125/150/200% 브라우저 배율 통과. 이 검사를 릴리스 workflow에도 추가했다.
- `node scripts/check-address-live.mjs`: 실제 사이트의 비로그인 자동차·교통위반 폼과 Kakao SDK 대상. 실제 위치 선택·드래그 단계·확대/축소·차량/라벨/체크박스·제목/본문·차량 입력/삭제·탭 복귀·Escape·X 검증. 조회 본문은 cloud 비로그인 안내이며 실제 신고 데이터 검증은 아니다.

실제 계정의 운영 cloud/selfhost 신고 데이터, OS 수준 Alt+Tab은 미검증이다. headless 탭 전환/blur/focus 검사는 OS 창 전환 검증으로 부르지 않는다. 사용자 데스크톱에 기존 설치된 웹 스토어 확장 버전은 변경/로드 확인하지 않았으며, 별도 Chromium 프로필에서 새 빌드를 명시적으로 로드했다.

## 빌드 일치

- 버전: `VERSION`, 소스 manifest, build manifest, ZIP manifest, 브라우저 `chrome.runtime.getManifest()` 모두 **1.2.5**.
- 실제 사이트 테스트 로드 경로: `~/projects/safetyreport-chromeextension/build` (manifest 수정 없음).
- mock backend 테스트는 build 사본의 manifest에 localhost mock origin/notifications만 허용한 `/tmp/sr-backend-browser-*/extension`을 로드한다. 테스트 종료 시 임시 프로필/사본은 정리한다.
- content.js SHA-256: `f1bef4be1ec5942b0533b31d46ff7e533e938b5da22b3df6abcf0ceed889dde8`. 소스/build/실제 로드한 resource 바이트 비교 통과.
- 로컬 Chromium: 140.0.7339.186. 계약 fixture 브라우저 테스트는 CHROME_PATH 또는 시스템 Google Chrome.
- 패키지: `artifacts/safetyreport-extension-1.2.5.zip`. build 설정은 기존 릴리스 workflow의 공개 설정과 동일.
- 실행 로그/캡처: `artifacts/full-tests.log`, `address-panel-before.log`, `backend-browser/result.json`, `address-live/result.json`. artifacts는 git에서 제외한다.

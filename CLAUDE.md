# 나만의 안전신문고 — 크롬 확장 컨텍스트

크롬 확장(`safetyreport-chromeextension`) 코드베이스 파악 / 구조 / 동작 방식 / 함정 기록 문서.

- 작업/버그/세션 이력은 `CHANGELOG.md`에만 기록한다.
- `CLAUDE.md`에는 구조, 설계 의도, 운영상 주의점만 남긴다.
- `CLAUDE.md`, `CHANGELOG.md`는 git 추적 대상이다.

---

## 프로젝트 개요

안전신문고 사이트와 서버 프로젝트(`/home/better0101/projects/safetyreport`)를 연결하는
Chrome Manifest V3 확장.

핵심 역할은 세 가지다.

- 팝업에서 서버 상태/요약/최근 답변/크롤링 제어 제공
- 안전신문고 신고 페이지에서 차량번호 기준 이전 신고 이력 패널 제공
- 같은 페이지에서 주소 기준 신고 이력 우측 패널 제공

확장은 WebSocket을 쓰지 않고, 모두 HTTP API로만 서버와 통신한다.

---

## 디렉토리 구조

```
safetyreport-chromeextension/
├── manifest.json        # Manifest V3 설정
├── popup.html
├── popup.css
├── popup.js             # 팝업 UI + 서버 요약/상태/버전/크롤링 제어
├── options.html
├── options.js           # 서버 URL / API 키 / 호스트 권한 저장 및 연결 테스트
├── background.js        # Service Worker, 주기 폴링, 알림, 콘텐츠 fetch 프록시
├── content.js           # 안전신문고 페이지 차량번호/주소 패널
├── content.css          # 신고 페이지 패널 스타일
├── icons/               # 16/48/128 아이콘
├── README.md            # 사용자 안내
├── CHANGELOG.md         # 작업/버그/세션 이력
├── CLAUDE.md            # 이 문서
└── VERSION              # 확장 버전 문자열
```

연관 서버 레포:

- `/home/better0101/projects/safetyreport`

---

## 현재 주요 구조 요약

- 팝업(`popup.js`)은 `/api/v1/summary`, `/api/v1/crawl/status`, `/api/v1/server/version` 을 병렬 호출한다.
- 옵션 페이지(`options.js`)는 서버 origin에 대한 `optional_host_permissions` 를 런타임에 요청한다.
- 콘텐츠 스크립트(`content.js`)는 안전신문고 페이지 DOM을 감시해 차량번호 `#VHRNO`, 주소 `#add1` 변화를 잡는다.
- 실제 서버 fetch는 Mixed Content 우회를 위해 콘텐츠 스크립트가 직접 하지 않고 `background.js` service worker에 위임한다.
- `background.js` 는 같은 `FETCH_VEHICLE` / `FETCH_ADDRESS` URL에 대한 in-flight 요청을 공유해서 중복 서버 호출을 줄인다.
- 차량번호/주소 패널은 최근 응답 캐시와 in-flight 키를 유지해, 같은 값 재조회와 늦게 도착한 stale 응답 덮어쓰기를 막는다.

---

## 권한 모델

`manifest.json`

- 기본 권한: `storage`, `notifications`, `alarms`, `clipboardWrite`
- 호스트 권한: `optional_host_permissions: ["<all_urls>"]`

중요:

- 설치 시점에 서버 접근 권한을 미리 다 받지 않는다.
- 사용자가 `options.html` 또는 팝업에서 서버 URL을 설정한 뒤, 그 origin에 한해 `chrome.permissions.request()` 를 호출한다.
- `chrome.permissions.request()` 는 반드시 사용자 제스처 핸들러 안에서 직접 호출해야 한다.

---

## 서버 계약

확장이 직접 쓰는 주요 엔드포인트:

- `GET /api/v1/summary`
- `GET /api/v1/crawl/status`
- `GET /api/v1/crawl/done/ext`
- `GET /api/v1/server/version`
- `POST /api/v1/crawl/start`
- `POST /api/v1/crawl/kill`
- `GET /api/v1/vehicle/{vehicle_number}`
- `GET /api/v1/address?q=...`

인증:

- 모든 API 호출은 `X-API-Key` 헤더 사용

중요 제약:

- 확장은 현재 REST API만 사용한다.
- 서버의 "연결 중인 기기"에서 WebSocket 클라이언트로 보이지 않는 것은 정상이다.

---

## 팝업 흐름

`popup.js`

- 설정값(`serverUrl`, `apiKey`)이 없으면 미설정 상태를 렌더링한다.
- 서버 origin 호스트 권한이 없으면 "권한 필요" 상태를 렌더링한다.
- 권한과 설정이 준비되면:
  - `/api/v1/summary`
  - `/api/v1/crawl/status`
  - `/api/v1/server/version`
  를 병렬 요청한다.
- 최근 답변 클릭 시 서버 웹앱의 `/data/all?open=신고번호` 로 이동한다.

---

## 백그라운드 흐름

`background.js`

- `chrome.alarms` 로 주기적 `crawl/status` 폴링
- `wasCrawling -> !running` 전환 감지 시 `/api/v1/crawl/done/ext` 로 완료 알림 생성
- 콘텐츠 스크립트의 `FETCH_VEHICLE`, `FETCH_ADDRESS` 메시지를 받아 서버 fetch 수행

### 중복 요청 억제

동일 URL 기준 in-flight dedupe를 사용한다.

- 키: `FETCH_VEHICLE:/api/v1/vehicle/...`
- 키: `FETCH_ADDRESS:/api/v1/address?...`

같은 키로 동시에 들어온 요청은 하나의 Promise를 공유하고, 완료 후 map에서 제거한다.

이 로직은 같은 차량번호/주소 패널이 짧은 시간에 여러 번 로딩되면서 서버를 반복 호출하던 문제를 줄이기 위한 것이다.

---

## 콘텐츠 스크립트 흐름

`content.js`

### 차량번호 패널

- 대상 입력: `#VHRNO`
- 트리거:
  - `input`
  - `focus`
  - `click`
- 4자 이상일 때만 조회
- `lastData`, `lastQueried`, `vehicleInFlightValue`, `vehicleRequestSeq` 로
  - 같은 값 중복 조회 억제
  - 이미 로딩 중인 값 재호출 방지
  - 늦게 도착한 응답 무시

### 주소 패널

- 대상 요소: `#add1`
- MutationObserver 로 주소 텍스트 변경 감지
- `lastAddrData`, `lastAddrQueried`, `addrInFlightValue`, `addrRequestSeq` 로
  - 같은 주소 재조회 억제
  - 로딩 중 주소 재호출 방지
  - stale 응답 무시

### SPA 이동

- `hashchange` 시 차량/주소 패널 상태를 모두 초기화하고 다시 바인딩한다.

---

## 알려진 성능 특성

확장 자체는 중복 호출을 줄였지만, 서버 검색 API는 여전히 비싼 편일 수 있다.

- `/api/v1/vehicle/{vehicle_number}`
- `/api/v1/address?q=...`

현재 서버 구현은 merge 테이블 3개를 각각 부분일치 검색(`contains` / SQL `LIKE '%...%'`) 하고,
정렬까지 수행한다.

즉:

- DB가 커질수록 응답 시간이 선형적으로 늘 수 있다.
- 같은 차량번호/주소에 대해 짧은 시간에 중복 요청이 들어오면 체감 로딩이 커진다.

확장 쪽에서 중복 요청을 줄였더라도, 장기적으로는 서버에 다음 개선 여지가 있다.

- 검색용 보조 인덱스
- exact/prefix match 전용 엔드포인트
- watchlist/read path 예외 처리 포함 쿼리 경량화
- 확장 전용 요약 응답 또는 캐시

---

## 디버깅 포인트

### 1. 저장 후에도 연결 실패

- `options.js` 에서 서버 origin 호스트 권한이 실제로 허용됐는지 확인
- `popup.js` 의 "권한 필요" 상태 여부 확인
- API 키가 유효한지 `/api/v1/crawl/status` 로 테스트

### 2. 차량번호/주소 패널이 계속 로딩

먼저 확인할 것:

- `background.js` 에서 동일 URL 중복 요청이 dedupe 되는지
- `content.js` 에서 같은 값이 `focus` + `click` + `MutationObserver` 로 중복 스케줄되지 않는지
- 서버 로그에 5xx가 있는지
- 서버 검색 응답은 200인데 패널이 반복 로딩되면 stale 응답/중복 요청 경쟁을 의심

### 3. 크롤링 완료 알림이 안 뜸

- 알람 폴링이 실행되는지
- `wasCrawling` 상태 전환이 있었는지
- 서버의 `/api/v1/crawl/done/ext` 가 값 없이 소비되고 있지 않은지

---

## 변경 이력 규칙

- 구조 변경, 설계 의도, 운영상 주의점은 `CLAUDE.md`
- 작업/버그/세션 기록은 `CHANGELOG.md`

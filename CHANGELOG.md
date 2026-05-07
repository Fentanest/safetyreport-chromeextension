# Changelog

작업, 버그 수정, 세션 기록용 문서.

- 구조/운영 컨텍스트는 `CLAUDE.md`에 유지
- 2026-05-06에 기존 `CLAUDE.md`의 작업 로그를 이 파일로 이관

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

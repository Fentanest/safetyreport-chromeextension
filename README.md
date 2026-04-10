# 나만의 안전신문고 — Chrome 확장

안전신문고 민원 처리 현황을 Chrome 브라우저에서 바로 확인할 수 있는 확장 프로그램입니다.  
[나만의 안전신문고 서버](https://github.com/Fentanest/safetyreport)와 연동하여 동작합니다.

---

## 주요 기능

- **현황 요약** — 팝업에서 전체·처리중·수용·불수용 건수 한눈에 확인
- **교통위반 요약** — 과태료·범칙금·불수용·미확인 건수 표시
- **최근 3일 답변** — 최근에 처리된 신고 목록 빠르게 확인
- **크롤링 제어** — 팝업에서 바로 크롤링 시작·중지
- **차량번호 검색** — 안전신문고 사이트 접속 시 차량번호를 서버 DB에서 즉시 검색
- **대시보드 바로가기** — 서버 웹 대시보드를 새 탭으로 열기

---

## 설치

Chrome 웹 스토어에 등록되지 않은 개발자 모드 확장입니다.

1. 이 저장소를 클론하거나 ZIP으로 다운로드
   ```
   git clone https://github.com/Fentanest/safetyreport-chromeextension.git
   ```
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 **개발자 모드** 활성화
4. **압축 해제된 확장 프로그램 로드** 클릭 → 클론한 폴더 선택

---

## 설정

1. 확장 아이콘 클릭 후 우측 상단 **설정(⚙)** 버튼 클릭
2. **서버 주소** 입력 (예: `http://192.168.1.100:6819`)
3. **API 키** 입력 — 서버 웹 UI의 **기기 연동** 페이지에서 발급
4. **저장** 클릭 → 팝업에서 연결 상태 확인

---

## 차량번호 검색

[안전신문고 사이트](https://www.safetyreport.go.kr) 접속 시 페이지 우측 하단에 검색 버튼이 표시됩니다.  
차량번호를 입력하면 서버 DB에서 해당 차량의 신고 이력을 조회할 수 있습니다.

---

## 연관 프로젝트

- [safetyreport](https://github.com/Fentanest/safetyreport) — 서버 (FastAPI + Selenium)
- [safetyreport-mobile](https://github.com/Fentanest/safetyreport-mobile) — Android 앱

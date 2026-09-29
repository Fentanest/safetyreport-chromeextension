# 나만의 안전신문고 Chrome 확장

안전신문고 사이트에서 카카오 계정으로 **본인이 공유한 완료 신고**를 조회합니다. 차량번호 입력은 공백 제거·NFC 정규화 후 한글을 포함한 6글자부터 부분 검색합니다. 주소 패널은 선택된 주소와 같은 주소의 본인 완료 신고를 보여줍니다. 확장 아이콘에서는 완료 신고 요약과 최근 3일 답변을 확인합니다.

신고 카드에는 원본 차량번호, 실제 신고번호, 신고·답변일, 결과·처분, 확인된 금액, 주소·기관·담당자, 위반법규와 숫자 별점을 표시합니다. 제목·본문·답변 원문·첨부는 조회·표시하지 않습니다. 원천 ID가 유효한 카드의 링크는 공식 안전신문고 상세 경로로 새 탭을 엽니다. 안전신문고 로그인은 카카오 커뮤니티 로그인과 별개입니다.

## 개발 및 빌드

Node.js 22 이상에서 `npm ci && npm test && npm run build`. 실제 Chrome action popup 크기는 unpacked 확장을 지원하는 Chromium 경로를 `SR_CHROMIUM_PATH`에 지정해 `npm run test:action-popup`으로 확인한다. `build/`가 unpacked 확장 디렉터리다. 테스트용 기본 빌드는 인증 설정 없는 상태로 생성된다. 실제 연결 빌드는 기존 Supabase 프로젝트의 **공개** URL·publishable key를 환경변수 `SR_SUPABASE_URL`, `SR_SUPABASE_PUBLISHABLE_KEY`에 지정한 뒤 `npm run build`를 실행한다. service_role 키나 Kakao secret은 절대 넣지 않는다.

`build/manifest.json`의 host permission은 주어진 Supabase origin 하나로 생성된다. 운영자에게는 map 저장소의 `docs/my-reports.md`에 있는 DB 마이그레이션, Edge 배포, Origin allowlist, Supabase Auth Redirect URL 추가 절차가 필요하다. 미배포 함수나 미등록 Redirect URL 상태에서는 로그인이 완료되어도 신고를 조회할 수 없다.

확장 ID가 정해진 뒤 `chrome.identity.getRedirectURL('supabase-auth')`로 얻은 정확한 URL을 기존 Supabase Auth Redirect URLs에 **추가**한다. 기존 PC·모바일·지도 Redirect URL을 지우지 않는다. 실제 Chrome 웹 스토어 ID와 unpacked 개발 ID가 다를 수 있다. Kakao 개발자 콘솔에는 기존 Supabase Auth callback을 유지한다.

`build/` 안에는 확장 실행 파일만 복사한다. 첨부 ZIP, 원본 사용자 스크린샷, 테스트, 문서는 패키지에 들어가지 않는다. 예전 서버 URL·API 키·크롤링·주기 알림 설정은 새 버전에서 제거된다. `chrome.storage.sync`의 레거시 서버 설정도 업데이트 후 지운다.

## 개인정보

Supabase access/refresh token은 신뢰된 확장 컨텍스트로 접근을 제한한 `chrome.storage.local`에 보관하며 코드에서는 worker만 사용한다. content script에는 보내지 않는다. 본인 신고 DTO는 worker 메모리에 최대 60초·50개 키로만 캐시한다. 검색어와 원본 차량번호는 API URL이 아닌 POST 본문으로 전달한다. 공개 지도와 달리 원본 차량번호는 **본인 인증된 개인 조회**에서만 표시한다. 자세한 안내는 [개인정보 안내](docs/extension-privacy.md)를 참고한다.

코드 구현·로컬 빌드는 운영 DB 적용, Edge 함수 배포, Chrome 웹 스토어 공개를 뜻하지 않는다.

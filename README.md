# 나만의 안전신문고 Chrome 확장

옵션 상단에서 **셀프호스팅 / 클라우드**를 선택합니다. 팝업과 차량·주소 입력 옆 패널에서 현재 연결과 조회 범위를 확인할 수 있습니다. 라이트·딥 다크·시스템 테마와 Shadow DOM 패널을 사용합니다. 차량번호는 NFC 정규화·공백 제거 후 6글자부터 부분 검색합니다.

## 모드별 기능

| 기능 | 셀프호스팅 | 클라우드 |
|---|---|---|
| 인증·연결 | 복구: 내 safetyreport 서버 주소·기기 연동 API 키. 확장 카카오 로그인 불필요. 서버 자체 인증·필수 동의는 필요 | 유지: Supabase/Kakao PKCE 로그인. 개인 서버 설정 불필요 |
| 차량 조회 | 복구: `GET /api/v1/vehicle/{차량번호}`. 서버의 부분 일치 검색, 처리중 포함, 서버 취하·중복 설정 적용 | 유지: my-reports/search. 본인이 공유한 답변 완료 신고의 부분 일치 검색 |
| 주소 조회·담당자 | 복구: `GET /api/v1/address?q=주소`. 서버의 부분 일치 검색과 반환된 전체 목록의 담당자 집계 | 유지: my-reports/search. 같은 주소의 본인 완료 신고, 서버 집계·담당자 커서 페이지 |
| 요약·처분 | 복구: `/api/v1/summary` 전체/처리중/교통위반 요약, 검색 패널의 서버 상태·처분 집계 | 유지: my-reports/summary 및 검색 전체 요약. 완료 4종·처분·확정 금액. 처리중·교통 전용 집계는 미지원 |
| 최근 답변 | 복구: summary의 `recent_answers`, 서버가 정한 최근 기간·최대 200건 | 유지: 서버가 정한 최근 3일 기간과 커서 페이지 |
| 신고번호 복사 | 복구: 서버 검색 전체 목록의 실제 번호를 중복 제거 후 복사. 번호 없는 신고 제외 | 유지: my-reports/numbers의 마지막 페이지까지 검증한 뒤 복사. 불완전 목록은 복사하지 않음 |
| 신고 원문 링크 | 유지: 검색 카드의 공식 안전신문고 내부 ID 상세 링크 | 유지: 검증된 `official_url`로 공식 안전신문고 상세 |
| 내 서버 상세·관리 | 복구: 최근 답변 클릭은 `/data/all?open=신고번호`, 팝업의 내 서버 열기 | 모드별 미지원: 표시하지 않음 |
| 크롤링 시작·중지 | 복구: `/crawl/start` (`crawl_mode: full`) / `/crawl/kill`. 서버의 동의·초기화 게이트 적용 | 모드별 미지원: 표시하지 않음 |
| 크롤링 시작·완료 알림·배지 | 복구: `/crawl/status` 확인 주기, `/crawl/done/ext` 완료 변경·중복 변경 알림, 처리중 배지 | 모드별 미지원: 폴링·배지·알림 없음 |

확장에 신고 제목·본문·답변 원문·첨부를 표시하지 않습니다. 셀프호스팅 완료 알림은 예전처럼 서버가 제공한 신고번호·제목 또는 중복 변경을 사용합니다. 클라우드에 없는 서버 필드나 금액을 가짜 값으로 만들지 않습니다. 한 모드의 실패를 다른 모드로 우회하지 않습니다.

## 사용 방법

셀프호스팅: 옵션에서 모드를 선택하고 `http://192.168.0.10:6819` 같은 서버 주소와 **기기 연동** 메뉴에서 발급한 API 키를 입력합니다. **저장**은 설정을 적용하고, **연결 테스트**는 현재 입력값을 저장하지 않고 검사합니다. 저장 결과·현재 입력값 테스트·저장된 서버 연결 상태를 각각 표시합니다. 주소나 키를 수정하면 이전 테스트 결과를 지우고, 늦게 도착한 응답을 표시하지 않습니다. 열린 옵션 탭들은 현재 모드·계정 상태를 동기화하며 편집 중인 서버 입력값은 보존합니다. localhost·LAN·IPv6의 HTTP/HTTPS 서버를 사용할 수 있습니다. 현재는 서버의 origin 주소를 입력합니다(사용자 정보·경로·쿼리·fragment 제외). 해당 origin에만 접근 권한을 요청합니다. 알림을 켜면 별도 알림 권한을 요청합니다. 알림 권한을 원하지 않으면 체크를 해제하고 저장합니다. 확인 주기는 1~1440분입니다.

크롤링 상태와 시작·중지 버튼은 팝업 상단에 있습니다. 알림을 허용한 셀프호스팅 모드에서는 실행 상태와 별도로 서버의 완료 기록을 확인하여 폴링 사이에 끝난 크롤링도 알립니다. `/crawl/done/ext`는 서버의 마지막 완료 기록을 읽고 제거하는 기존 계약이므로, 여러 확장이 같은 서버 기록을 소비하는 경우 서버가 제공하지 않는 기기별 알림 보장은 만들지 않습니다.

처리중 배지는 같은 서버·키의 마지막 정상 확인값을 재시작 후 복원하고 다음 폴링에서 갱신하며, 폴링 실패·다른 서버/키·차단 상태에서는 복원하지 않습니다.

셀프호스팅 서버는 **제품 major 3 이상 + protocol 3 지원**이 필요합니다. `3.0.0.0`, `3.0.0.0-dev`를 지원합니다. 매 실제 요청·재연결 전에 인증된 `/api/v1/server/version`으로 확인하며, 연결 테스트는 상태 API와 서버 동의 게이트까지 확인합니다. 서버 2.x·호환 정보 없음·미지원 protocol은 연결을 거부합니다. HTTP 409의 업데이트 요구는 주기 폴링을 중지하며, 서버/확장을 업데이트한 뒤 연결 테스트로 재개합니다. 네트워크·API 키·동의·버전 문제는 각각 안내합니다. 이 확장은 REST를 사용하고 WS를 연결하지 않습니다.

클라우드: 옵션에서 모드를 선택하고 카카오로 로그인합니다. 서버 URL·API 키를 입력하지 않아도 됩니다. 본인이 PC·모바일에서 커뮤니티에 공유한 완료 신고만 조회합니다. 안전신문고 원문 보기의 로그인은 별도입니다. 클라우드 연결 테스트는 실제 my-reports 조회까지 확인합니다. 로그인·로그아웃 실패 안내는 계정 상태와 별도 영역에 유지됩니다.

검색 패널을 닫았다 다시 열 때 60초가 지난 차량·주소 결과는 재조회합니다. 닫은 주소 패널은 표시된 주소를 클릭하면 다시 열립니다. 페이지 이동 후 입력 노드가 그대로여도 현재 주소를 다시 읽습니다. 신고·담당자 더 보기는 동시에 요청해도 각 목록의 누적 결과를 보존하며, 같은 목록의 중복 요청은 제한합니다.

## 기존 설정과 모드 전환

- 명시적으로 저장된 `backendMode: selfhost | cloud`를 최우선으로 유지합니다.
- 선택 이력이 없고 과거 서버 설정만 있으면 셀프호스팅으로, 기존 Supabase 세션만 있으면 클라우드로 마이그레이션합니다.
- 양쪽 설정이 있거나 신규 설치라면 선택 화면에서 직접 결정합니다. 토큰 유효성을 확인하기 위한 숨은 통신으로 모드를 정하지 않습니다.
- 과거 `storage.sync`의 서버 설정은 신뢰된 `storage.local`에 먼저 보존하고 sync의 비밀키 사본을 제거합니다. 이미 제거된 옛 키를 복구할 수는 없습니다.
- 모드 전환은 두 설정과 클라우드 세션을 보존합니다. 비활성 모드의 요청·폴링을 중지하고 진행 중 요청을 취소합니다. 늦은 응답은 세대로 검사해 버립니다. 캐시는 backend + 서버 origin 또는 Supabase origin/계정 + 조회 조건으로 분리하고 전환 때 지웁니다.
- 선택은 worker·브라우저 재시작 후 유지됩니다. **로그아웃**은 확장 클라우드 세션을 명시적으로 종료하는 별도 동작입니다.

## 개발 및 검증

Node.js 22 이상에서 `npm ci && npm test && npm run build`. `build/`가 unpacked 확장 디렉터리입니다. 기본 빌드는 클라우드 공개 설정 없이도 셀프호스팅을 사용할 수 있습니다. 클라우드 연결 빌드는 기존 프로젝트의 **공개** URL·publishable key를 `SR_SUPABASE_URL`, `SR_SUPABASE_PUBLISHABLE_KEY`에 지정합니다. service_role 키나 Kakao secret을 넣지 않습니다.

GitHub Actions는 같은 이름의 저장소 Variables `SR_SUPABASE_URL`, `SR_SUPABASE_PUBLISHABLE_KEY`를 빌드 환경에 주입합니다. Actions의 ZIP에는 이 공개 설정이 포함되므로 사용자가 옵션에 입력할 필요가 없습니다. 로컬 빌드는 해당 환경변수를 별도로 지정해야 하며 GitHub Variables를 자동으로 가져오지 않습니다.

### GitHub 빌드·릴리스

`.github/workflows/build.yml`은 `main` push 또는 Actions의 **Build & Release Chrome extension → Run workflow**로 실행합니다. 수동 실행은 `dev`·`main`만 허용합니다. Linux x64 셀프호스트 러너의 라벨은 `self-hosted`, `Linux`, `X64`, `235`입니다. 러너 서비스는 직접 실행하며 이 workflow는 서비스를 설치하거나 시작하지 않습니다. Node 24 기반 Actions를 실행할 수 있는 최신 러너, `zip`·`unzip`, Chromium 실행용 Linux 라이브러리가 필요합니다. Node.js 22와 테스트용 Chromium은 workflow에서 준비하며 `sudo`로 시스템 패키지를 설치하지 않습니다.

`VERSION`을 정본으로 읽어 `build/manifest.json` 버전, `v<VERSION>` 릴리스 태그, `safetyreport-extension-<VERSION>.zip` 파일명을 맞춥니다. `python3 set_version.py <버전>`으로 소스 manifest와 함께 갱신할 수도 있습니다. 테스트·계약 검사와 공개 설정을 포함한 빌드·패키징이 성공하면 해당 실행 커밋에 GitHub Release를 게시하고 ZIP을 첨부합니다. ZIP을 풀어 `manifest.json`이 있는 폴더를 로드하세요. GitHub의 자동 **Source code** ZIP에는 빌드 결과가 없습니다.

릴리스에는 두 Supabase Variables가 모두 필요하며 없으면 중단합니다. 기존 버전 태그가 다른 커밋을 가리키면 릴리스하지 않으므로 코드가 바뀌면 `VERSION`을 올려야 합니다. 같은 커밋의 재실행은 해당 릴리스에 ZIP을 다시 첨부할 수 있습니다. 동시 릴리스는 직렬로 실행하고 실행 중인 작업을 취소하지 않습니다. GitHub Release는 Chrome 웹 스토어 제출과 별개입니다.

`npm run test:contracts`는 map 정본 my-reports 사본의 MANIFEST와 PC 정본 selfhost-compat 사본·테스트 벡터를 검사합니다. 정본 사본을 임의로 수정하지 않습니다. my-reports 갱신은 map의 `scripts/integration/sync_contract_copy.py --contract my-reports --to <확장 레포>`를 사용합니다. selfhost-compat는 PC `contracts/selfhost-compat/`에서 파일을 그대로 복사하고 스냅샷 해시를 검사합니다.

실제 Chromium 설치 검증은 unpacked 확장을 지원하는 실행 파일을 `SR_CHROMIUM_PATH`에 지정해 `npm run test:backend-browser`와 `npm run test:action-popup`을 실행합니다. 전자는 production 코드와 실제 worker/content script를 로컬 mock 서버로 검사하고, 테스트 사본 manifest에 **그 mock origin과 알림만** 미리 허용합니다. 실제 권한 허용 팝업과 카카오 인증·운영 서버 검증은 별도입니다. 결과와 화면 캡처는 `artifacts/backend-browser/`, 검증 기록은 `CHANGELOG.md`에 남깁니다. OS Alt-Tab 자체는 headless 검증에 포함되지 않습니다.

Supabase 통신의 필수 `host_permissions`는 빌드 시 지정한 프로젝트의 HTTPS origin 하나로 자동 설정됩니다. 안전신문고 패널의 정적 주입은 `content_scripts.matches`에서 `http://www.safetyreport.go.kr/*`, `https://www.safetyreport.go.kr/*` 두 주소에만 허용하고, Shadow DOM 스타일 리소스도 같은 범위에 공개합니다. background의 메시지 검증 역시 정확한 www 호스트의 최상위 페이지와 확장 ID만 허용합니다. 안전신문고 API를 background가 호출하거나 쿠키를 읽는 권한은 추가하지 않습니다. 개인 서버 주소는 설치 시 알 수 없으므로 manifest의 optional HTTP/HTTPS 범위 안에서, 저장/테스트 클릭 때 **입력한 origin 하나만** 요청합니다. `<all_urls>`나 전체 HTTP/HTTPS 권한을 한꺼번에 요청하지 않으며 CSP를 완화하지 않습니다.

클라우드 운영 적용 절차는 map `docs/integration/chromeextension/REPORT.md` §6을 따릅니다. 확장 ID의 `chrome.identity.getRedirectURL('supabase-auth')`를 기존 Supabase Auth Redirect URLs에 추가하고 기존 PC·모바일·지도 URL은 유지합니다. Origin allowlist와 OAuth Redirect URL은 서로 다른 설정입니다. 이 저장소의 로컬 빌드·테스트는 운영 배포나 스토어 제출을 뜻하지 않습니다.

## 개인정보

API 키와 Supabase access/refresh token은 `TRUSTED_CONTEXTS`로 제한한 `storage.local`에 보관합니다. content script에는 비밀키를 보내지 않고 worker가 목적지와 모드를 결정합니다. DTO allowlist의 조회 결과만 전달합니다. 캐시는 worker 메모리에서 최대 60초·50개 키를 사용합니다. 클라우드 검색어는 POST 본문, 셀프호스팅 검색어는 기존 서버의 GET 경로/쿼리로 전송합니다. 자세한 내용은 [개인정보 안내](docs/extension-privacy.md)를 참고하세요.

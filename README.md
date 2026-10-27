# 나만의 안전신문고 Chrome 확장

카카오 계정으로 로그인해 **내가 커뮤니티에 공유한 완료 신고**를 안전신문고 화면 옆 패널과 팝업에서 조회합니다. 1.3.0부터 PC 앱(셀프호스팅) 연결은 지원하지 않습니다. 팝업은 열릴 때 마지막으로 확인된 로그인 상태를 바로 보여주고, 실제 확인은 필요할 때만(계정 변경 직후, 이전 확인 실패 후, 시간이 꽤 지났을 때) 뒤에서 하며 바뀐 경우에만 화면을 갱신합니다. 팝업의 새로고침 버튼은 그 자리에서 다시 확인합니다. 라이트·딥 다크·시스템 테마와 Shadow DOM 패널을 사용합니다. 차량번호는 NFC 정규화·공백 제거 후 4글자부터 패널을 열고 부분 검색합니다. 현재 클라우드 서버의 6글자 제한에 걸리면 지원 제한 안내가 표시되며, 4글자 검색에는 서버 업데이트가 필요합니다. 차량·주소 값을 바꾸면 닫았던 패널도 다시 열립니다. 신고 분류는 교통위반·주정차위반·안전신고·생활불편·기타 5종으로 표시하며, 각 신고 카드 첫 줄에 분류 칩으로 붙습니다(분류 정보가 없는 구버전 서버 응답은 칩을 만들지 않습니다).

## 기능

| 기능 | 설명 |
|---|---|
| 인증 | Supabase/Kakao PKCE 로그인. 서버 주소·API 키 입력 없음 |
| 차량 조회 | my-reports/search. 본인이 공유한 답변 완료 신고의 부분 일치 검색 |
| 주소 조회·담당자 | my-reports/search. 같은 주소의 본인 완료 신고, 서버 집계·담당자 커서 페이지 |
| 요약·처분 | my-reports/summary 및 검색 전체 요약. 완료 4종·처분·확정 금액 |
| 최근 답변 | 서버가 정한 최근 3일 기간과 커서 페이지 |
| 신고번호 복사 | my-reports/numbers의 마지막 페이지까지 검증한 뒤 복사. 불완전 목록은 복사하지 않음 |
| 신고 원문 링크 | 검증된 `official_url`로 공식 안전신문고 상세 |

확장에 신고 제목·본문·답변 원문·첨부를 표시하지 않습니다. 없는 값이나 금액을 가짜 값으로 만들지 않습니다.

## 사용 방법

옵션에서 카카오로 로그인합니다. 본인이 모바일·지도에서 커뮤니티에 공유한 완료 신고만 조회합니다. 안전신문고 원문 보기의 로그인은 별도입니다. 클라우드 연결 테스트는 실제 my-reports 조회까지 확인합니다. 로그인·로그아웃 실패 안내는 계정 상태와 별도 영역에 유지됩니다. 열린 옵션 탭들은 계정 상태를 동기화합니다.

검색 패널을 닫았다 다시 열 때 60초가 지난 차량·주소 결과는 재조회합니다. 주소 패널은 X로 직접 닫기 전까지 지도 드래그, 차량번호 조작, 바깥 클릭, Escape, 포커스 복귀에도 계속 표시됩니다. 접기 버튼을 직접 누르지 않으면 본문도 유지됩니다. 좁은 화면에서는 두 패널을 나누어 배치하고 각각 내부 스크롤을 사용합니다. 닫은 주소 패널은 표시된 주소를 클릭하거나 새 주소를 선택하면 다시 열립니다. 같은 주소의 DOM 교체나 데이터 갱신으로는 다시 열리지 않습니다. 페이지 이동 후 입력 노드가 그대로여도 현재 주소를 다시 읽습니다. 신고·담당자 더 보기는 동시에 요청해도 각 목록의 누적 결과를 보존하며, 같은 목록의 중복 요청은 제한합니다.

주소 패널의 담당자별 수용률·과태료처분율은 건수와 분모를 함께 표시합니다. 해당 주소·기관·담당자의 고유 완료 신고 전체(결과 미상 포함)를 분모로 사용합니다. 수용률은 수용 건수만, 과태료처분율은 과태료 처분 건수를 분자로 하며 일부 수용·범칙금 단독을 각각 더하지 않습니다. 금액 없는 과태료도 처분 건수에 포함하며 확정 금액은 별도로 표시합니다. 실제 0건은 `0.0%`, 분모 0 또는 집계 미제공은 `—`입니다. 담당자 페이지를 더 받아도 각 담당자의 전체 분모는 바뀌지 않습니다.

## 1.2.6에서 업데이트하면 (셀프호스트 삭제)

- 업데이트 후 worker가 처음 시작할 때 한 번 정리합니다. PC 서버로는 어떤 요청도 보내지 않습니다. 진행 중이던 PC 폴링 alarm과 크롤링 알림, 처리중 배지를 지우고, 받아 둔 PC 서버 접근·알림 권한의 반납을 시도하며(실제 브라우저에서 회수되는지는 미검증), 저장된 서버 주소·API 키·확인 주기·크롤링 상태 같은 셀프호스트 저장 키만 정확히 삭제합니다(`storage.clear()`를 쓰지 않으므로 테마·클라우드 세션은 그대로입니다).
- 정리는 중간에 끊겨도 다음 시작 때 다시 실행되며, 마지막에 `srMigration` 버전을 기록합니다. alarms·notifications API는 권한이 빠진 새 버전에서는 존재하지 않으므로 있는지 확인한 뒤 최선을 다해 정리하고, 없다고 클라우드 초기화가 실패하지 않습니다.
- 확장은 클라우드로만 동작합니다. 기존 클라우드 로그인은 유지되고, 셀프호스트만 쓰던 분은 옵션이나 팝업에서 카카오로 직접 로그인해야 합니다(자동 로그인하지 않습니다).
- **PC에만 있던 신고는 모바일 앱에서 가져와 커뮤니티에 공유해야 이 확장에 보입니다.** 옵션 화면에도 같은 안내가 있습니다.

## 개발 및 검증

Node.js 22 이상에서 `npm ci && npm test && npm run build`. `build/`가 unpacked 확장 디렉터리입니다. 확장은 클라우드 전용이므로 릴리스 빌드에는 커뮤니티 서버의 **공개** URL·publishable key가 필요합니다. 기존 프로젝트의 값을 `SR_SUPABASE_URL`, `SR_SUPABASE_PUBLISHABLE_KEY`에 지정합니다. service_role 키나 Kakao secret을 넣지 않습니다.

GitHub Actions는 저장소 Variables `LOCAL_SUPABASE_URL`, `LOCAL_SUPABASE_PUBLISHABLE_KEY`(다른 레포와 같은 이름, 2026-10-12부터 셀프호스트 커뮤니티 서버 — 확장 쪽 PC 셀프호스트 기능과는 무관한 서버 이름입니다)를 빌드 환경의 `SR_SUPABASE_URL`, `SR_SUPABASE_PUBLISHABLE_KEY`로 주입합니다. Actions의 ZIP에는 이 공개 설정이 포함되므로 사용자가 옵션에 입력할 필요가 없습니다. 로컬 빌드는 해당 환경변수를 별도로 지정해야 하며 GitHub Variables를 자동으로 가져오지 않습니다.

### GitHub 빌드·릴리스

`.github/workflows/build.yml`은 Actions의 **Build & Release Chrome extension → Run workflow**에서 `dev` 또는 `main`을 선택해 수동으로만 실행합니다. push로는 실행하지 않습니다. Actions에서 수동 실행하려면 workflow 파일이 기본 브랜치에도 있어야 합니다. Linux x64 셀프호스트 러너의 라벨은 `self-hosted`, `Linux`, `X64`, `235`입니다. 러너 서비스는 직접 실행하며 이 workflow는 서비스를 설치하거나 시작하지 않습니다. Node 24 기반 Actions를 실행할 수 있는 최신 러너, `zip`·`unzip`, Chromium 실행용 Linux 라이브러리가 필요합니다. Node.js 22와 테스트용 Chromium은 workflow에서 준비하며 `sudo`로 시스템 패키지를 설치하지 않습니다.

`VERSION`을 정본으로 읽어 `build/manifest.json` 버전, `v<VERSION>` 릴리스 태그, `safetyreport-extension-<VERSION>.zip` 파일명을 맞춥니다. `python3 set_version.py <버전>`으로 소스 manifest와 함께 갱신할 수도 있습니다. 두 브랜치 모두 테스트·계약 검사와 공개 설정을 포함한 빌드·패키징을 실행합니다. `dev`는 ZIP을 artifact에만 업로드하고 태그·Release를 생성하지 않습니다. `main`은 검증된 artifact를 내려받아 해당 실행 커밋에 `v<VERSION>` 태그와 GitHub Release를 생성하고 ZIP을 첨부합니다. 릴리스 본문은 기존 버전·커밋·ZIP 설치 안내 머리말에 빈 줄과 `docs/releases/v<VERSION>.md`의 내용을 그대로 이어 붙입니다(`Full Changelog` 포함, 자동 생성 노트 없음). 파일이 없으면 `::error::`로 경로를 안내하고 Release 생성 전에 실패하며, 릴리스를 만들지 않는 dev 빌드는 이 파일을 요구하지 않습니다. ZIP을 풀어 `manifest.json`이 있는 폴더를 로드하세요. GitHub의 자동 **Source code** ZIP에는 빌드 결과가 없습니다.

두 브랜치의 artifact는 `safetyreport-extension-<브랜치>-<VERSION>-<실행 ID>-<재실행 번호>` 이름으로 **1일** 보관합니다. 이 보관 기간은 Actions artifact에 적용하며 GitHub Release의 첨부 ZIP은 유지됩니다.

두 브랜치의 빌드에는 두 Supabase Variables가 모두 필요하며 없으면 중단합니다. `main`은 기존 버전 태그가 다른 커밋을 가리키면 릴리스하지 않으므로 코드가 바뀌면 `VERSION`을 올려야 합니다. 같은 커밋의 재실행은 해당 릴리스에 ZIP을 다시 첨부할 수 있습니다. `dev`는 기존 릴리스 태그와 관계없이 빌드합니다. 같은 브랜치의 실행은 직렬로 처리하고 실행 중인 작업을 취소하지 않습니다. 빌드 작업은 읽기 권한만 사용하며 main 릴리스 작업에만 `contents: write`를 부여합니다. GitHub Release는 Chrome 웹 스토어 제출과 별개입니다.

`npm run test:contracts`는 map 정본 my-reports 사본의 MANIFEST와 테스트 벡터를 검사합니다. 정본 사본을 임의로 수정하지 않습니다. my-reports 갱신은 map의 `scripts/integration/sync_contract_copy.py --contract my-reports --to <확장 레포>`를 사용합니다. (1.3.0에서 PC 정본의 selfhost-compat 사본은 삭제했습니다.)

실제 Chromium 설치 검증은 공개 설정으로 빌드한 뒤 unpacked 확장을 지원하는 실행 파일을 `SR_CHROMIUM_PATH`에 지정해 `npm run test:backend-browser`와 `npm run test:action-popup`을 실행합니다. 전자는 1.2.6이 남긴 저장소 상태(셀프호스트만·혼합·클라우드만·로그아웃)를 시드하고 브라우저를 재시작해, 실제 worker가 정리하고 옛 PC mock 서버에 요청을 한 번도 보내지 않는지 검사합니다. 테스트 사본 manifest는 그 mock origin을 `host_permissions`에 넣으므로 optional 권한 반납은 이 검사가 아니라 `tests/selfhost-removal.test.mjs`의 worker 시험이 확인합니다. 카카오 인증·운영 서버·로그인 세션이 필요한 실제 데이터 화면 검증은 별도입니다. 결과와 화면 캡처는 `artifacts/backend-browser/`, 검증 기록은 `CHANGELOG.md`에 남깁니다. OS Alt-Tab 자체는 headless 검증에 포함되지 않습니다.

Supabase 통신의 필수 `host_permissions`는 빌드 시 지정한 프로젝트의 HTTPS origin 하나로 자동 설정됩니다. 안전신문고 패널의 정적 주입은 `content_scripts.matches`에서 `http://www.safetyreport.go.kr/*`, `https://www.safetyreport.go.kr/*`와 `www`가 없는 `http://safetyreport.go.kr/*`, `https://safetyreport.go.kr/*`(실제 사이트가 두 주소를 리다이렉트 없이 동일하게 서빙합니다) 네 주소에만 허용하고, Shadow DOM 스타일 리소스도 같은 범위에 공개합니다. background의 메시지 검증 역시 이 정확한 호스트들의 최상위 페이지와 확장 ID만 허용합니다. 안전신문고 API를 background가 호출하거나 쿠키를 읽는 권한은 추가하지 않습니다. 1.3.0부터 optional host 권한(`http://*/*`, `https://*/*`)과 `alarms`, optional `notifications`가 없습니다. 최종 manifest의 권한은 `storage`·`identity`·`clipboardWrite`와 위 host 권한뿐이며 CSP를 완화하지 않습니다. 빌드 테스트가 ZIP의 manifest로 이를 검증합니다.

클라우드 운영 적용 절차는 map `docs/integration/chromeextension/REPORT.md` §6을 따릅니다. 확장 ID의 `chrome.identity.getRedirectURL('supabase-auth')`를 기존 Supabase Auth Redirect URLs에 추가하고 기존 PC·모바일·지도 URL은 유지합니다. Origin allowlist와 OAuth Redirect URL은 서로 다른 설정입니다. 이 저장소의 로컬 빌드·테스트는 운영 배포나 스토어 제출을 뜻하지 않습니다.

## 개인정보

Supabase access/refresh token은 `TRUSTED_CONTEXTS`로 제한한 `storage.local`에 보관합니다. content script에는 비밀키를 보내지 않고 worker가 목적지를 결정합니다. DTO allowlist의 조회 결과만 전달합니다. 캐시는 worker 메모리에서 최대 60초·50개 키를 사용합니다. 검색어는 POST 본문으로 전송합니다. 자세한 내용은 [개인정보 안내](docs/extension-privacy.md)를 참고하세요.

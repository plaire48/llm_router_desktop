# 포털 홈에서 메일 자동 연결

2026-10-14. 1.2.5 최신 소스의 메일 인증 후속 수정. 설치 파일 배포와 사내 실계정 검증은 수행하지 않았다.

## 사용자 흐름

기본 진입점은 `http://kor3.samsung.net/portalapp/home`이다. 사용자가 확인한 회사 흐름은 `http://samsung.com` → `http://samsung.net/loginapp/login` → 포털 홈이다. 누비는 로그인 주소를 직접 조립하거나 아이디/비밀번호를 대신 제출하지 않는다. 홈에 접속하고 서버가 필요한 로그인 경로로 보내도록 둔다.

- 이미 로그인되어 있으면 같은 세션으로 사용자 정보와 메일함을 확인해 연결한다.
- 로그인이 필요하면 누비 브라우저 안에서 회사 로그인 화면을 이용한다. 본창과 팝업의 POST, opener, 리다이렉트를 유지한다.
- 홈 로그인 후 고정 메일 API가 정상 응답하면 자동 연결한다. 별도 메일 화면 이동이나 ‘메일 열기’ 버튼은 없다.
- 유효한 지속 쿠키가 있으면 앱 재시작 후 로그인 창 없이 복원한다. 서버의 세션 만료 정책을 우회하지 않는다.

## 실제 구현

`persist:nubi-company`의 Chromium 세션을 공유한다. 포털 페이지가 준비되어 있으면 그 페이지의 같은 origin 조회를 사용한다. 백그라운드 조회와 연결 검증은 같은 세션을 지정한 Electron `net.request`를 쓴다. 숨은 창은 `about:blank`에 유지하며 별도 로그인 탐색을 하지 않는다. 쿠키나 토큰을 추출하거나 다른 저장소로 복사하지 않는다.

고정 조회 경로와 기존 요청 본문은 유지한다.

| 시점 | 조회 |
| --- | --- |
| 연결/복원 확인 | `/mail/rest/v1/mails/userinfo/read`, `/mail/rest/v1/mails/desktop/folders` |
| 필요한 계정 식별 보충 | 본인의 받은/보낸 메일 목록과 메타데이터 |
| 연결 후 동기화 | 메일함, 목록, 요약, EML 원문 |
| 결재 화면 요청 | 기존 읽기 전용 결재 목록/상세 |

비밀번호 필드가 없다는 이유로 로그인 완료를 추정하거나 중간 페이지를 강제로 이동시키던 보정을 제거했다. 로딩 중인 인증 팝업을 기다리며, 사용자가 다시 연결하면 이전 복원 요청을 중단하고 완료를 기다려 같은 인증 흐름이 겹치지 않게 한다.

## 리다이렉트 계약

브라우저의 SSO 리다이렉트는 기존 BrowserHost가 처리한다. 반면 API 조회는 로그인 주소를 따라가지 않는다. 인증이 없으면 연결 대기 또는 재로그인 상태로 돌아간다.

허용된 메일 호스트에서 같은 경로/쿼리의 HTTP → HTTPS 전환만 한 번 허용한다. POST와 본문을 유지하며 이후 HTTPS로 고정한다. 다른 호스트, 다른 포트, 인증 정보가 포함된 주소, 다른 경로, HTTPS → HTTP 전환은 조회 대상으로 허용하지 않는다. TLS 검증은 유지한다.

처음 검토한 `session.fetch`는 실제 Electron에서 `redirect: manual`일 때 3xx 응답을 노출하지 않고 `Redirect was cancelled`로 거절했다. 이 때문에 동일한 Chromium 세션을 쓰는 `net.request`의 `redirect` 이벤트로 상태/목적지를 확인하고, 원 요청을 중단한 뒤 허용된 정확한 HTTPS 경로만 새 조회한다. 서버 로그인 POST를 재생하는 것이 아니며 고정 읽기 API에 한정된다.

근거: [Electron Session](https://www.electronjs.org/docs/latest/api/session), [Electron ClientRequest](https://www.electronjs.org/docs/latest/api/client-request), [Electron fetch 구현](https://github.com/electron/electron/blob/main/lib/browser/api/net-fetch.ts). 새 인증 라이브러리나 쿠키 복사 방식은 도입하지 않았다.

## 검증

전체 단위 검사 1,247개 중 1,051 통과, 실패 0, 건너뜀 196. 관련 검사 28개 통과, Electron 로컬 빌드와 디자인 identity 검사 통과. [최종 결과](../verification/mail-auth-fix-2026-10-14/results.json)와 같은 폴더의 실행 로그를 참조한다.

- 관련 단위 검사: origin 제한, HTTPS 전환, POST/본문 보존, 팝업 대기, 취소, 오래된 세션 응답 무효화, 복원/연결 직렬화, minify 후 조회 스크립트의 origin 유지.
- 실제 Electron의 격리된 모의 프로토콜: 302, 팝업 POST, 307/308 POST 유지, 303 GET 복귀, opener, HTTP → HTTPS API 전환, 소유 탭 정리. 홈에서 연결하며 메일 페이지 GET을 하지 않는다.
- 실제 loopback HTTP 서버와 Electron 쿠키 저장소: 로그인 전 API 리다이렉트 미추적, HttpOnly 테스트 쿠키 발급, 홈에서 자동 연결, 무관한 partition의 인증 분리, 프로세스 종료/재시작 후 지속 쿠키 복원, 이미 로그인된 홈에서 재연결.
- 초기 모의 폼의 `_blank`가 실제 opener를 보존하도록 `rel="opener"`를 명시했다. 합성 서버의 인증 boolean만으로 성공했던 이전 검사를 쿠키 기반 검사와 구분한다.
- Electron 로컬 빌드 및 전체 회귀 검사를 별도로 기록한다. 샌드박스 localhost 접근 차단으로 실패한 최초 회귀는 최종 결과로 사용하지 않는다.

사내 서버의 실제 쿠키 scope/수명/CSRF 요구, mySingle 연계, Windows 11 설치판 성공은 아직 확인하지 않았다. 이번 수정이 현장 Whitelabel 404 자체를 해결했다고 확정하지 않는다. 최종 사용자 동작은 포털 홈 로그인 한 번이며, 사내 확인에서도 메일 페이지 수동 이동을 정상 절차로 요구하지 않는다.

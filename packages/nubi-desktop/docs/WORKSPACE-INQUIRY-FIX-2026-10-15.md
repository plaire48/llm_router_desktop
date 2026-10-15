# Desktop 문의 인증 경로 수정

## 확인한 문제와 변경

원본 AI Workspace와 Desktop 문의 코드를 비교했다. Desktop은 인증값을 main에만 보관하지만 `githubJsonRead.js`의 문의 유형 조회는 원본의 브라우저 직접 fetch로 남아 있었다. renderer의 회사 API 직접 접근 제한과 인증값 부재 때문에 작성 화면에서 `Failed to fetch`가 발생할 수 있는 경로다.

- branch 기준 SHA, 마스터 내용, 큰 파일의 immutable blob 조회 모두 기존 `ghesFetch` IPC로 연결했다. 회사 인증값은 main에서만 붙인다.
- 기준 SHA 요청의 오류 처리에 누락된 URL을 전달해 HTTP 오류가 `Invalid URL`로 가려지지 않게 했다.
- Workspace 요청/본문 수신의 네트워크 실패를 안전한 오류 코드로 전달한다. 원시 게이트웨이 응답과 인증값은 표시하지 않는다. 문의 목록은 연결 실패, 로그인 필요, 권한 문제를 구분한다.
- 불확실한 문의 등록은 자동 재전송하지 않는다. 기존 UUID로 등록 결과만 다시 조회한다. 기존 담당자 선택 및 권한 검증은 유지한다.

## 검증

- `node --test tests/workspace-inquiry-flow.test.mjs tests/workspace-fetch.test.mjs tests/ghes-account-failure.test.mjs`: 13개 통과.
- 실제 client → renderer IPC bridge → host transport에 합성 GHES 응답을 연결해 목록, 마스터 조회, 접수, 상세, 응답 유실 뒤 중복 없는 재조회, 403, 로그아웃을 확인했다. 전역 fetch를 차단해 직접 요청의 재발도 검출한다.
- `node scripts/check-workspace-embed.mjs`: 1100/440px 실제 컴포넌트 화면에서 문의 유형, 담당자 선택, 접수와 본문 재조회. 앱/Talk/재로그인 회귀도 포함한다. 회사로 직접 나가는 renderer HTTPS 요청은 차단한다.

## 확인 범위

회사 서버에 문의를 등록하지 않았다. 실계정, 회사망 및 Windows 설치판 성공을 의미하지 않는다. 사용자가 추가로 보고한 “문의 진입 후 상단 프로필의 회사 계정 확인 실패”는 별도 계정 상태 경로다. 현재 로컬 합성 상태에서는 재현되지 않았으며 실제 오류 코드를 확보하기 전 원인을 확정하지 않는다. 문의 유형 조회 누락을 그 계정 오류나 실서버 목록 실패의 유일한 원인이라고 주장하지 않는다.

# GPT login and passkeys

## Observed issue

사용자는 Google 패스키 인증이 끝나지 않고 `0ms waiting undefinedms failed login_timeout`이 표시된다고 보고했다. 실제 실행창에서 Google 로그인 방법 선택 페이지와 누비 로그인 실패 상태를 확인했다. 계정의 패스키나 비밀번호를 대신 입력하지 않았다.

현재 고정 Electron은 42.11.10이다. 로컬 electron.d.ts의 configureWebAuthn은 macOS Touch ID와 전용 keychainAccessGroup만 지원하며 main.cjs는 이를 설정하지 않는다. 이 기능은 기존 Google 패스키/iCloud Keychain 공유 인증과 다르다. 최신 Electron의 platformPasskeys는 entitlement, provisioning profile와 RP association을 요구하므로 메이저 버전 변경이나 임의 설정만으로 Google 도메인 패스키가 지원된다고 표시하지 않는다. Windows Hello와 실제 계정 완료는 이번 확인 범위가 아니다.

Google은 개발자가 제어하는 내장 user-agent의 OAuth를 제한한다. 패스키 지원을 User-Agent 변경, 인증서 검증 해제 또는 가상 authenticator로 우회하지 않는다. 최신 사용자 결정 2026-10-04에 따라 GPT도 기존 오른쪽 웹 탭만 사용하며 시스템 브라우저 예외를 추가하지 않는다. 다른 인증 방법 선택은 사용자가 Google의 화면에서 직접 완료한다. 내부 웹 경로 통일만으로 Google 패스키 지원이 해결된 것으로 표시하지 않는다.

## Applied fixes

공유 provider의 진행 이벤트에 실제 at/elapsedMs를 항상 넣고 실패 단계도 보존한다. 누비 진단은 한글 단계와 정수 초를 표시하며 과거 이벤트의 누락된 시간도 at으로 계산한다. GPT Desktop만 timeout을 600,000ms로 늘려 다단계 로그인을 기다리고 Office 기본 180,000ms와 AI Pro 설정은 유지한다. 취소/시간 초과 이후 도착한 교환 응답은 성공으로 표시하지 않는다. PKCE/state, 한 번만 교환하는 callback, localhost listener와 메모리 전용 인증 계약은 유지한다.

## Basis and verification

- [Google OAuth policies](https://developers.google.com/identity/protocols/oauth2/policies): secure browsers and embedded user agents.
- [Google native app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app): disallowed_useragent and system browser guidance.
- [Electron app API](https://github.com/electron/electron/blob/main/docs/api/app.md): platform authenticators and passkey entitlements. Installed 42.11.10 type declarations were separately checked.

Electron build completed. No automated tests or real-account authentication were executed. Source fixes do not prove Google passkey support. Restarting the running app is pending user approval because its mail account is currently connected in memory.

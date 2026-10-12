# Workspace 로그인 유지

사용자 결정: Workspace 내부 로그인은 앱 재시작 후에도 유지한다. 다른 브라우저/확장의 인증을 가져오지 않는다.

Electron main의 safeStorage를 이용해 앱 전용 connections-v1에 암호문만 보관한다. macOS Keychain 기반 보호, Windows DPAPI를 사용한다. Linux basic_text 또는 보안 저장소 미제공 시 평문으로 저장하지 않는다. 기존 개발용 암호문을 자동 가져오지 않는다. [Electron 공식 문서](https://www.electronjs.org/docs/latest/api/safe-storage)

후속 품질 수정: 동기 safeStorage가 키체인 확인 중 Electron main을 막는 문제를 줄이기 위해 현재 번들 Electron 42.11.10의 isAsyncEncryptionAvailable/encryptStringAsync/decryptStringAsync를 사용한다. API별 10초 대기는 실패로 처리하며 동기/평문 fallback을 두지 않는다. 암호화가 늦게 끝나도 타임아웃 이후에는 파일을 쓰지 않으며 로그아웃 순서를 유지한다. 키 교체 신호가 있으면 검증한 레코드를 원자적으로 재암호화한다. 이 API는 로컬 OS 저장 함수이며 ChatGPT/AI Pro의 브라우저 로그인 방식을 API key 방식으로 바꾸지 않는다.

공식 문서는 비동기 사용을 권고하며, [고정 버전 소스](https://github.com/electron/electron/blob/v42.11.10/shell/browser/api/electron_api_safe_storage.cc)의 kEncryptSyncCompat와 shouldReEncrypt 반환을 확인했다. 별도 보안 저장 라이브러리나 인증 런타임을 도입하지 않았다. 비동기 대기 중 timer 응답, 지연된 저장/로그아웃, 키 교체와 교체 실패의 기존 암호문 보존을 포함한 11개 로컬 검사가 통과했다. 아래 실제 macOS 복원 결과와 Windows/Linux 미검증 범위를 구분한다.

AI Pro, ChatGPT, FabriX 및 회사 GHES 로그인에 적용한다. 모델/추론 선택과 ChatGPT 갱신 토큰 교체도 보관한다. 재시작 시 카탈로그/계정을 다시 확인한 뒤 연결 상태를 표시한다. 일시적인 네트워크 오류에서는 저장 인증을 지우지 않는다. 로그아웃은 해당 저장 인증을 지운다. 기존 메일 비밀번호, DB 인증과 Office/브라우저 확장은 이번 변경 범위가 아니다.

저장 API는 main과 신뢰된 worker 사이의 별도 IPC이며 렌더러 RPC나 모델 도구로 노출하지 않는다. 레코드 키는 고정 목록이며 저장 직렬화와 파일 교체로 토큰 갱신/로그아웃 순서를 유지한다. 상태에는 비밀 값 대신 저장 오류만 전달한다. 보관 실패 시 현재 로그인을 유지하고 다음 시작에는 로그인이 필요함을 알린다.

검사: 새 저장소 인스턴스 복원, 암호문 확인, 평문 fallback 차단, 키/심볼릭 링크 검사, 갱신 후 로그아웃 삭제, 선택 모델/추론 복원, Office 메모리 전용 유지, 네트워크 실패 시 보관 유지의 로컬 검사 통과. 실제 계정 재시작 및 Windows DPAPI 검증은 별도로 기록한다.

실제 macOS 앱에서 ChatGPT 인증과 GPT-6.1-Sol 선택, 모델 목록 갱신 및 암호화 연결 파일 생성을 확인했다. 앞선 동기 구현에서는 재시작 시 macOS 키체인의 접근 확인 대기에서 main 스레드가 멈췄다. 비동기 수정 후 2026-10-12 실제 앱을 종료/재실행했고 추가 로그인 없이 ChatGPT GPT-6.1-Sol과 Light 선택이 복원됐다. 새 대화에서 연결 시험 요청을 보내 오전 06:32에 실제 모델의 `연결 확인 완료` 응답을 확인했다. 이는 해당 macOS/ChatGPT 계정의 복원과 응답 성공이며 Windows DPAPI, AI Pro/FabriX/GHES 실계정 복원은 별도 미검증이다. 메일 비밀번호는 기존 메모리 전용 계약이므로 새 메일 수신에는 재연결이 필요하다.

로그인 뒤 마지막 인증 탭이 닫힐 때 빈 브라우저와 콜백 주소가 남는 문제를 보완했다. 인증 탭의 Chromium 종료도 대화 복귀 이벤트로 처리하고 빈 탭 상태의 주소를 초기화한다. 다른 일반 브라우저 탭이 있으면 유지한다. 탭 생명주기 회귀 3개 통과.

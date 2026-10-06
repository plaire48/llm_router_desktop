# 브라우저 인증 복귀와 상태 전달

## 확인한 문제

공통 인증 HTML의 복귀 버튼은 window.close를 호출했다. Desktop의 BrowserHost는 destroyed 이벤트를 처리하지 않아 이미 닫힌 WebContents를 상태 목록에서 계속 읽을 수 있었다. BrowserPane는 650ms마다 상태 전체를 읽었고 실패를 매번 토스트로 표시했다. 앱 전체가 종료됐다는 사용자 보고가 있었으나 이번 소유 실행기의 종료 코드는 0이며 정확한 종료 원인은 로그로 확정하지 못했다.

## 반영

- Desktop 인증 화면은 고정된 nubi-workspace://auth-return 요청을 보낸다. 인증 탭의 native will-navigate에서 차단하고 해당 탭을 제거한 후 중앙 작업으로 복귀한다. 이 신호는 인증 성공이나 새 권한을 부여하지 않는다. Office/일반 브라우저의 기존 닫기 동작은 유지한다.
- 닫기 RPC와 Chromium destroyed 이벤트가 같은 소유권 제거를 사용한다. 제거가 중복되면 아무 작업도 하지 않는다. 상태 읽기와 레이아웃에서 destroyed 항목을 제외하며 앱 창의 close를 호출하지 않는다.
- 로딩/주소/제목/검색 결과/다운로드 변경 이벤트를 최대 80ms 간격으로 합쳐 전달한다. 650ms 폴링과 빈 탭 자동 생성 루프를 제거한다. 숨긴 페이지의 세션/탭은 유지하고 Chromium의 기본 백그라운드 제한을 해제하지 않는다.
- 마지막 호스트 오류는 시각, 고정 컴포넌트, 정해진 종료 사유와 종료 코드만 보관한다. URL/콜백 code/token/쿠키/페이지 본문/원시 stderr는 기록하지 않는다. 정확한 장애 재현 없이 종료 보고를 해결 완료로 확대하지 않는다.

## 선택 근거와 범위

[Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents/)의 close/destroyed 계약을 사용한다. destroyed 뒤에는 WebContents를 읽을 수 없다. [Electron 성능 가이드](https://www.electronjs.org/docs/latest/tutorial/performance)는 메인/renderer의 불필요한 작업과 블로킹 I/O/IPC를 줄이고 필요한 장기 작업을 worker로 분리할 것을 권한다. 기존 별도 worker와 WebContentsView를 재사용하며 새로운 브라우저 엔진이나 세션 저장소를 도입하지 않는다.

Electron 빌드만 수행한다. 실제 로그인 복귀, 체감 지연 개선, Windows와 사용자 보고 종료의 원인 확정은 개별 관찰이 필요하다. 회사 TLS/Chromium sandbox/권한 검증을 완화하지 않는다.

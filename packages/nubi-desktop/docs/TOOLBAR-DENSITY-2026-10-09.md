# Workspace toolbar and card spacing

첨부한 정돈된 한 줄 메뉴를 참고해 Electron의 창 제목과 도구를 48px 상단 줄로 모았다. 사이드바 접기, 기존 누비 로고/Beta, 현재 대화/프로젝트 제목, 실제 상태, 사용량/위키/새 대화 동작을 유지한다. 로고와 제목을 위한 기존 두 번째 줄과 72px 예약 여백은 실제 Electron에서 제거한다. 메일과 스킬 페이지도 같은 상단을 사용한다. 다른 호스트의 기존 Workbench 헤더는 유지한다.

Electron 공식 [Custom Title Bar](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)를 적용했다. macOS는 hiddenInset과 기존 OS 창 버튼을 사용하고 Windows/Linux는 hidden과 native titleBarOverlay를 사용한다. 제목 영역은 창 드래그, 버튼은 no-drag다. native overlay의 safe-area 환경 변수를 사용하며 별도 창 조작 IPC나 흉내 낸 OS 버튼은 추가하지 않았다. 기존 Nubi/CX 컴포넌트와 아이콘을 재사용하고 의존성은 추가하지 않았다.

입력 박스의 세로 패딩은 12px에서 8px, 한 줄 입력 최소 높이는 44px에서 36px, 도구 줄은 48px에서 36px로 줄였다. 계획 행의 세로 패딩은 8px에서 4px로 줄이고 계획/질문/시작 카드와 로그인 선택 카드도 같은 간격 기준을 사용한다. 입력과 본문 16px / 28px, UI 15px와 보조 14px은 유지한다. 터치의 상단/전송 버튼은 44px을 유지한다. 숨겨진 세부 내용, 승인, 상태와 복구 정보는 삭제하지 않았다.

검증:

- `npm run build:electron`와 `npm run design:check` 통과.
- `npm run test:ui`의 실제 macOS Electron 13개 검사 통과: 파일 편집/저장/readback, 거부 파일, Git 비교/커밋, 비활성 A2A, 긴 규칙, 메일/설정, sandbox, 중앙 Agent, 터미널, 내부 브라우저와 좁은 창.
- 별도 Electron 합성 화면의 상단 높이 48px, 한 줄 입력 박스 높이 93.5px, 본문/입력 16px과 행간 28px 확인. 1280/900/760px 및 200% 글자 확대, 본문 간격 override, 사이드바 접기 뒤 입력 초안 보존 확인. 초기 아이콘 오류는 기존 FolderMark로 수정 후 재확인했다.
- 실제 로그인/설정/메일의 로컬 화면도 별도 임시 상태에서 확인했다. 캡처와 수치는 `verification/typography/density-*`에 있다.

합성 응답은 실제 모델 성공이 아니다. 전체 기능 게이트, Windows 설치판과 실제 Windows native 창 조작은 이번에 검증하지 않았다. OS 창 버튼 자체의 pixels는 Chromium 페이지 캡처에 포함되지 않는다.

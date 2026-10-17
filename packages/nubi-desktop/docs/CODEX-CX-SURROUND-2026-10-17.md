# 첨부 시안과 Codex 흐름을 참고한 Workspace 정돈

이번 기준은 사용자가 재첨부한 [Office 연결 시안](../design/references/workspace-surround-2026-10-17.png)이다. 앞선 파스텔 적용을 수정해 바깥 배경과 안쪽 작업 화면을 구분한다. 파스텔을 모든 제목/메뉴에 채우는 것보다 흰 작업면, 얇은 구분선, 여백과 선택 상태로 위계를 만든다.

## 참고 자료와 적용 판단

[Codex 공식 소개](https://openai.com/index/introducing-the-codex-app/)에서 프로젝트별 대화, 대화 안의 변경 검토, 편집기로 이어가는 흐름을 참고했다. 이는 동작과 정보 구조의 근거다. 16px 여백이나 구체적인 색상은 Codex 공식 규격이 아니라 첨부 시안을 누비에 적용한 설계값이다. 현재 Codex 앱의 직접 화면 자동화 접근은 제한되어 공식 소개와 사용자가 제공한 이미지를 사용했다. 다른 앱의 소스를 열어 제한을 우회하지 않았다.

| 기준 | 적용 |
| --- | --- |
| 연한 파스텔 바깥 | 기존 `--deck-background`를 공통 캔버스로 사용 |
| 하나의 흰 작업 화면 | 상단 아래 16px 여백, 흰 작업면, 1px 선과 0.75rem 모서리 |
| 작은 창 | 760px 이하에서 바깥 여백 8px. 내용/클릭 영역을 임의 축소하지 않음 |
| 단정한 영역 구분 | 사이드바, 상단, 모달 제목/하단을 흰색으로 정돈. 선택/hover/입력에는 기존 연한 토큰. 오른쪽 활성 탭도 시안처럼 연한 파랑 |
| 작업에 집중 | 중앙 에이전트와 오른쪽 파일/브라우저/터미널 유지. 보조 패널의 중복 그림자를 제거 |
| 얇은 탐색 | 실제 56px 메뉴와 레이아웃 계산의 56px 예약 폭을 일치시킴 |
| 브랜드 | AI Pro, ChatGPT, FabriX, Claude 로고와 제공자 색상 유지. Office 문서/앱 식별색과 서식은 별도 |
| 모션 | 앞선 작은 탄성/모션 감소/입력 중단 계약 유지 |

바깥 여백을 빼기 전 창 전체 폭으로 패널을 예약하면 좁은 화면에서 내용이 잘릴 수 있다. renderer의 너비 관찰을 실제 `.desktop-workspace-body`의 내부 폭으로 바꾸고, 해당 영역의 ResizeObserver로 분할 여부와 보조 영역 너비를 계산한다. 네이티브 제목/창 조작 영역은 기존 전체 폭과 높이를 유지한다.

## 검증

`verification/design-token-audit-2026-10-17/codex-surround-gates.json`과 `codex-surround-*.log`에 최종 결과를 기록한다. 실제 빌드된 macOS Electron의 각 보조 작업 캡처 때 바깥 여백의 좌우 균형, 제목 줄 아래 위치, 흰 배경/모서리와 가로 overflow를 검사한다. 작은 창도 같은 검사를 반복한다. 파일 편집/저장, Git, 검색, PTY, 브라우저 탭은 기존 native 검사를 재사용한다. 합성 브라우저 화면은 실제 계정이나 Windows 결과와 구분한다.

- [기본 대화](../verification/all-surfaces/conversation-1280.png)
- [설정](../verification/all-surfaces/settings-1280.png)
- [실제 Electron 파일 화면](../verification/native-surfaces/file-editor.png)

이전 성능 실측은 [iOS 참고 CX/모션 점검](IOS-CX-BENCHMARK-2026-10-17.md)에 보존한다. 이번 바깥 프레임 변경을 동일한 성능 측정으로 소급하지 않는다. Windows 11/Office/NASCA/실계정과 설치판 배포는 별도 검증이다.

최종 결과: 전체 화면 117 상태, 모달 40 기록, 아이콘 18그룹과 제공자 4색, 빌드된 macOS Electron 22동작을 통과했다. 흰 작업면을 마지막으로 정리한 뒤 전체 117 상태를 다시 확인했으며, 활성 탭 색상을 정돈한 뒤 실제 Electron도 재검사했다. `codex-surround-final-gates.json`과 `codex-surround-complete-electron-retry.log`가 해당 후속 근거다. 최초 탭 색 검사 실패는 전환 중간 프레임을 읽은 경우였으며, 동일한 최종 색 기준을 유지하고 조건이 충족될 때까지 기다리는 검사로 정정했다. 최초 실패 로그도 보존했다.

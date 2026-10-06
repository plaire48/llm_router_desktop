# Consistent modal dismissal

사용자 결정: 모든 모달은 우측 상단에 X를 표시하고 모달 바깥 클릭으로 닫히지 않는다. 이전 X 숨김/바깥 클릭 닫기 결정을 대체한다.

기존 DetailPanel은 항상 close ActionButton을 렌더링한다. Desktop의 전역 display:none 규칙을 제거하고 전체 모달과 작은 스킬/추론 창에 공통 닫기 크기/아이콘/호버 토큰을 적용했다. 추론 창은 초기화 동작을 보존한 채 X를 추가했다. 스킬/추론은 외부 pointerdown 닫기 리스너를 제거하고 닫은 뒤 원래 버튼에 초점을 돌린다.

설치된 CX 0.5.4는 backdrop mousedown으로 닫히며 공개 opt-out prop이 없다. Desktop 루트에서 useModalDismissalPolicy를 한 번 설치해 정확한 cx-panel-backdrop 배경이 이벤트 대상이고 직계 deck-dialog aria-modal=true가 있을 때만 pointerdown/mousedown/click을 capture 단계에서 차단한다. 모달 내부 클릭, 컨트롤, 키보드, 폼, 승인 이벤트에는 적용하지 않는다. CX 소스 복제/설치 패키지 수정 대신 기존 activateModal의 inert/Tab 순환/Escape/초점 복원을 그대로 재사용한다. 처리 중 DetailPanel busy/onClose 가드는 유지한다.

도구/셸 선택의 role=menu는 모달이 아니므로 기존 메뉴 동작을 유지한다. Native OS 파일 선택/로그인 창은 별도 호스트 표면이며 웹 모달 규칙으로 조작하지 않는다. 메인 에이전트의 닫기 X는 계속 제공하지 않는다.

확인 범위는 현재 소스/설치된 CX API 검토와 Electron 빌드다. 사용자 요청에 따라 테스트는 실행하지 않으며 실제 모든 모달 클릭 검증/Windows 검증 성공으로 표시하지 않는다.

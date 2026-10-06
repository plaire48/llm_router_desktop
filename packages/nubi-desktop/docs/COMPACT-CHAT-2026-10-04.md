# 채팅 너비와 스크롤 표시

대화와 입력창, 대기열의 최대 너비를 760px에서 공통 `--nubi-chat-width` 700px로 줄였다. 본문과 입력창의 좌우 끝을 같이 맞추고 기존 남는 너비에 맞춘 축소, 사이드바 너비 조절과 도구 줄의 아이콘 전환을 유지한다. 글자 크기와 모델 선택 UI는 변경하지 않았다.

본문의 숨김 규칙에 입력 textarea와 Electron의 바깥 Agent 컨테이너도 포함했다. 보이는 바와 gutter만 없애고 overflow, `useConversationScroll`, 키보드 포커스, 휠/터치, 최신 메시지 이동과 고정 입력창은 유지한다. 코드 블록의 수평 스크롤은 남긴다.

다른 Desktop 목록과 모달의 Chromium 스크롤바는 공통 6px 크기, 둥근 thumb, 축 방향에 맞춘 양 끝 8px 여백을 사용한다. 기존 standard thin 설정이 Chromium의 끝 여백과 둥근 스타일을 덮어쓰는 큐/탭에만 auto를 적용한다. Monaco 자체 스크롤과 원격 브라우저 문서는 바꾸지 않는다. 기존 CSS와 스크롤 hook을 재사용하며 새 패키지를 추가하지 않았다.

사용자 요청에 따라 Electron 빌드만 수행하며 자동 테스트와 실제 모델 호출은 하지 않는다. 화면 확인은 예시 데이터와 구분해 남긴다.

2026-10-04: Electron 빌드 완료. 예시 화면에서 대화와 입력 카드의 너비가 모두 700px이며 좌우 끝이 같은 것을 확인했다. 본문/입력 textarea/바깥 Agent의 scrollbar-width는 none, gutter는 auto, 기존 overflow는 유지된다. 확인 화면은 `/private/tmp/nubi-compact-chat-2026-10-04.png`다. 긴 대화와 Windows의 실제 스크롤 동작은 이번에 별도 검사하지 않았다.

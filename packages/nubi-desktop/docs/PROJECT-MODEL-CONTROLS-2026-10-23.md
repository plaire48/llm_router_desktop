# 프로젝트 연결의 공통 모델·추론 설정

처음 프로젝트를 선택하는 화면과 ‘프로젝트 연결’ 창에 대화창의 `ModelPicker` / `ModelSelection`과 `ReasoningPicker`를 함께 전달한다. 별도 모델 목록이나 추론 선택 UI를 만들지 않는다.

추론 변경은 기존 제공자가 지원하는 옵션과 호스트 확인 절차를 그대로 사용한다. 호스트가 적용한 결과를 확인한 뒤 Workbench의 제공자 상태도 갱신해, 연결 창 아래에 유지한 대화창의 추론 표시가 즉시 일치하도록 했다. 초안은 그대로 유지한다. 제공자가 추론 옵션을 제공하지 않는 모델에는 선택기를 만들지 않는다.

연결 창은 포털로 렌더링되므로 공통 모델 버튼과 추론 칩의 스타일 범위에 `.nubi-project-connect`를 포함했다. 기존 공통 색상·배경 토큰을 재사용하고, 일반 대화상자의 배경 이미지 제거 규칙에서 공통 모델 버튼을 제외한다. 실제 확인에서 연결 창의 추론 아이콘이 회색으로 보이고 모델 버튼의 제공자 배경이 사라지는 문제를 재현한 뒤 수정했다.

`design/workspace-density.css`는 사용자가 알려준 `0bd7814e`의 두 선택자 확장(`:is(.nubi-compose-card,.nubi-start-model,.nubi-wiki-model-chips)`)을 먼저 맞춘 뒤 읽고 수정했다. 세 표면의 범위를 유지하면서 연결 창에도 같은 규칙을 적용했다. 인계 패치는 해당 두 선택자가 이미 확장된 상태를 기준으로 만든다.

## 검증

- `npm run build:electron` 성공.
- `tests/reasoning-picker.test.mjs`, `tests/motion-consumer-tokens.test.mjs`: 2개 통과.
- `scripts/check-project-model-controls.mjs`: 실제 macOS Electron에서 7개 통과. 초기 화면과 연결 창의 공통 구성, 모델 선택 대화상자, 추론 슬라이더 적용, 첫 대화로 선택값 전달, 중첩 창 닫기와 초안·추론 동기화, 공통 제공자 색상·배경, AI Pro/ChatGPT/Claude 옵션, 최소 620px 창 배치, 추론 미지원 모델을 확인했다.

결과와 화면은 `verification/project-model-controls-2026-10-23/`에 기록한다. 제공자 상태는 격리된 IPC fixture이며 실제 인증이나 모델 호출, Windows 설치판을 검증한 결과는 아니다. 기존 전체 게이트·업로드 담당 흐름은 유지한다.

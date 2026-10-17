# Apple HIG 참고 CX 점검과 전환 개선

누비의 기존 컴포넌트와 디자인 토큰을 유지하며 화면 위계, 조작 영역, 상태 피드백과 모션을 대조했다. Apple 지침을 제품 전체의 합격 점수로 환산하지 않는다. 아래는 실제로 조사한 소스와 합성 데이터로 렌더링한 화면의 범위다.

## 비교와 적용

| 요소 | 참고 기준 | 누비에 적용한 내용과 확인 범위 |
| --- | --- | --- |
| 글자와 아이콘 | [Icons](https://developer.apple.com/design/human-interface-guidelines/icons), [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols) | 일반 15px, 읽기 16px, 보조 14px와 역할별 아이콘. 440px/큰 글자에서도 검사. SF Symbols 자산은 포함하지 않음 |
| 정렬과 밀도 | [Layout](https://developer.apple.com/design/human-interface-guidelines/layout) | 공통 여백/서체 토큰, 모달 제목/본문/하단 정렬. 왼쪽 탐색은 사용자 후속 의견에 따라 72→56px, 버튼 48→44px, 간격 20→12px |
| 버튼과 선택 | [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons?changes=latest_1), [Lists and tables](https://developer.apple.com/design/human-interface-guidelines/lists-and-tables) | 역할별 glyph와 실제 클릭 영역 분리. 선택 배경과 키보드 초점 유지. 고정 대화는 목록 상단. 전체 표의 터치 사용성/실사용 조사까지 완료한 것은 아님 |
| 브랜드와 대비 | [Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | 누비 공통 색상과 모델사 색상을 별도 유지. AI Pro 원래 파랑/보라 그라데이션과 ChatGPT 원래 단색을 복원. FabriX/Claude와 로고 자산 유지. 터미널 경로, 추가 행 개수, 현재 페이지 번호의 낮은 대비 보완 |
| 입력과 복구 | [Text fields](https://developer.apple.com/design/human-interface-guidelines/text-fields), [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data) | 이름 있는 필드, 오류/재시도, 초안과 연결 복귀를 기존 흐름에서 검사. 입력창은 기존 사용자 결정대로 초점 때도 얇은 테두리와 그림자 없음 |
| 메뉴와 모달 | [Menus](https://developer.apple.com/design/human-interface-guidelines/menus), [Modality](https://developer.apple.com/design/human-interface-guidelines/modality), [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts) | Tab/Escape/초점 복귀, 비활성 부모 위 확인창, 닫히는 레이어의 inert/포인터 해제. 보이는 모달 수와 실제 활성 모달 수를 구분 |
| 진행과 피드백 | [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators), [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback) | 작업 중/실패/재시도/취소 UI의 기존 상태 표시 확인. 애니메이션을 작업 성공이나 진행률의 근거로 쓰지 않음 |
| 모션 | [Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Reduced motion](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria) | 짧은 이동/투명도, 모션 감소, 입력 시 전환 중단, 리사이즈 프레임 병합. 상세는 아래 |

## 전환 구현

- 모달 열기 360→280ms, 닫기 220→180ms, 크기 전환 360→280ms. 화면 전환 360→280ms. 과한 이동과 overshoot를 줄였다.
- 모달 리사이즈는 한 프레임에 기하 정보를 먼저 읽고 나중에 쓴다. 배경 면을 재사용하고 텍스트는 위치만 이동한다. 진행 내용이 갱신될 때 텍스트가 반복해서 흐려지던 동작을 제거했다.
- 사이드바 드래그의 시각 갱신을 프레임마다 최신 값 한 번으로 병합했다. 마지막 정확한 너비 저장, Escape 취소, 키보드 조절과 포인터 해제를 보존한다.
- 화면 캡처 전환이 준비되지 않아도 120ms 뒤 실제 상태를 반영한다. 사용자 입력이 오면 기다리는 상태 변경을 즉시 반영하고 전환을 중단한다. 실행/승인 상태를 애니메이션 뒤로 지연하지 않는다.
- 닫기 때 모든 자식의 애니메이션을 순회하지 않는다. 답변 표시의 blur를 제거하고 짧은 투명도 변화만 사용한다. 시스템 모션 감소/백그라운드 정지를 유지한다.

## 제한된 성능 실측

실제 제품 훅과 전체 CSS를 사용하는 합성 fixture를 Chrome에서 실행했다. 자동화 감지로 모션이 꺼지는 일반 기능 검사와 달리 이 시험은 모션을 명시적으로 활성화하고 native View Transition 호출도 확인한다. CPU 4배 제한, 전후 각각 3회, 드래그 480개 이벤트와 화면/모달 전환을 포함한다. 빌드 등 무거운 작업과 겹친 회차는 비교에서 제외하고 별도 보관했다.

| 중앙값 | 변경 전 | 변경 후 |
| --- | ---: | ---: |
| 너비 스타일 쓰기 횟수 | 482 | 14 |
| Layout 횟수 | 95 | 76 |
| 스타일 재계산 횟수 | 322 | 262 |
| 스타일 재계산 시간 | 0.265006초 | 0.261406초 |
| rAF 프레임 간격 p95 | 약 16.8ms | 약 16.8ms |
| CDP TaskDuration | 0.520144초 | 0.563962초 |

스타일 쓰기는 97.1%, Layout 횟수는 20.0%, 재계산 횟수는 18.6% 줄었다. 그러나 p95 프레임 간격은 사실상 같고 전체 TaskDuration 중앙값은 약 8.4% 늘었다. 따라서 전체 CPU 감소, FPS 상승이나 모든 화면의 멈춤 해결로 보고하지 않는다. 변경 후 세 회차 모두 남은 종료 레이어/변형 배경/inert 잠금이 없었고 마지막 너비는 389px로 일치했다.

자료: `verification/motion-2026-10-17/before/result.json`, `mochi-final/result.json`. 탄성 조정 전의 최적화 결과는 `after/result.json`에 별도로 보존했다. 중간 회차 `after/intermediate-result.json`, 빌드 중첩 회차 `after/build-overlap-result.json`도 남겼다. 일반/모션 감소 각각 모달 6회 기능 검사는 `verification/design-token-audit-2026-10-17/cx-motion-responsiveness.log`, 관련 Node 25개 검사는 `cx-motion-focused.log`다.

## 화면 QA와 한계

117 상태의 실제 제품 컴포넌트 렌더링, AI Workspace 기본/보조 18상태, Office 미리보기 6상태에 보이는 텍스트 대비와 조작 이름 수집을 추가했다. 단색 배경 합성에 대한 텍스트 대비이며 gradient, 반투명 애니메이션과 로고는 별도 취급한다. 네이티브 checkbox의 작은 그림 대신 실제 label 선택 영역을 측정하도록 검사기를 정정했다. 외부 웹, 작성 문서, 코드 영역과 실제 Windows/Office/NASCA는 이 결과에 포함하지 않는다.

브랜드/탐색 후속 검사와 스크린샷은 `verification/design-token-audit-2026-10-17/brand-rail-*`, `verification/icon-scale-2026-10-17/`에 기록한다. 최초 56px 메뉴에서 1px 내부 overflow를 발견해 패딩을 조정했다. 브랜드 시험의 잘못된 시작 화면 선택도 보존하며 제품 결함 수정 성적으로 계산하지 않는다. 처음 모달 회귀에서 입력창 초점 테두리 불일치를 발견했고 기존 차분한 테두리 계약으로 복구했다.

[전체 토큰 점검](DESIGN-TOKEN-AUDIT-2026-10-17.md), [아이콘 조정](ICON-SCALE-IOS-2026-10-17.md), [고정 대화](CONVERSATION-PINS-2026-10-17.md)를 함께 본다. 실제 이용자 조사, VoiceOver, Windows 설치판과 회사 데이터의 전체 업무 검증은 후속 범위다.

사용자가 제공한 Office 연결 시안의 연한 하늘/라벤더/민트 배경을 선호한다고 확인했다. 공통 바깥 배경은 새 팔레트를 만들지 않고 기존 `--deck-background`로 연결했다. 흰 읽기 패널, 옅은 선택 배경과 선명한 본문 대비를 유지하며 제공자 색상을 앱 강조색으로 덮지 않는다.

최종 분위기 결정은 연한 파스텔과 작은 탄성이다. 사용자 후속 요청에 따라 모달 열기/크기 변화는 280ms, 닫기는 180ms로 조정했다. 버튼 복귀 곡선은 1.56의 과한 overshoot를 1.18로 줄이고 주 동작 누름은 0.97/0.95의 작은 압축으로 맞췄다. 크기 변화의 탄성은 배경 면에 적용하고 본문은 위치만 이동한다. 최종 탄성 버전도 별도로 3회 측정했으며 위 표에는 그 최종 결과를 사용한다. 이전 결과와 덮어 합치지 않는다.

파스텔 활용을 넓혀 사이드바/왼쪽 메뉴에는 `--nubi-surface-chrome`, 상단 도구/보조 탭/모달 제목과 하단에는 `--nubi-surface-header`를 적용했다. 기존 선택 파랑과 흰색을 65%/35%로 섞는 의미 토큰이며 새 제공자 색을 만들지 않는다. 강제 색상 모드에서는 Canvas를 사용한다. 읽기 영역과 모달 본문은 흰색으로 유지한다.

최종 파스텔/탄성 스타일의 UI 재검사는 `verification/design-token-audit-2026-10-17/mochi-pastel-gates.json`을 기준으로 한다. 전체 117 상태, AI Workspace 기본/보조, Office 미리보기 6상태, 아이콘 18그룹과 제공자 4색, 모션 일반/감소 각각 6회, 빌드된 macOS Electron 도구 흐름을 순차 실행했다. 이전 전체 Node 회귀를 이 최종 CSS 버전으로 다시 실행한 것은 아니다. 모션 관련 Node 9개는 `mochi-motion-tests.log`, 최종 빌드는 `mochi-pastel-build.log`에 기록했다.

최신 사용자 재확인: 파스텔을 제목/메뉴 전체에 넓히는 방향을 수정했다. 첨부 시안처럼 바깥 파스텔과 안쪽 흰 작업면을 구분하고 Codex의 작업 흐름을 참고했다. 최종 시각 기준과 검사는 [Codex CX/바깥 프레임 후속](CODEX-CX-SURROUND-2026-10-17.md)을 따른다. 앞선 중간 스타일/측정 기록을 지우거나 최종 소스 결과로 소급하지 않는다.

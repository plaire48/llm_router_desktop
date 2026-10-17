# iOS 참고 아이콘 크기 조정

아이콘 크기를 역할별로 줄였다. 글자와 아이콘의 시각적 무게를 맞추고 실제 누르는 영역은 별도로 유지한다. 디자인 기준은 `workspace-identity.css`, 최종 적용 계층은 `workspace-icons.css`다.

## Apple에서 참고한 원칙

- [Icons](https://developer.apple.com/design/human-interface-guidelines/icons): 같은 계열의 모양과 선 두께를 유지하고, 주변 글자와 시각적 무게/정렬을 맞춘다. 도형마다 시각적 크기가 다를 수 있다.
- [SF Symbols](https://developer.apple.com/design/human-interface-guidelines/sf-symbols): 글자 크기에 상대적인 small/medium/large scale로 강조 수준을 조절한다.
- [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons?changes=latest_1): 손가락 등으로 쉽게 선택할 수 있는 영역을 확보한다. iOS의 일반적인 기준은 44pt다.

아래 CSS px 값은 누비 Desktop에 맞춘 적용값이다. Apple이 모든 아이콘에 지정한 고정 크기나 pt와 CSS px의 동일성을 뜻하지 않는다. 기존 공통 SVG 자산과 누비 파랑, 글꼴 및 버튼 동작을 사용한다.

## 실제 변경 전후

루트 글자 16px, 1280px 창의 실제 계산값을 비교했다.

| 위치 | 이전 glyph | 이후 glyph | 일반 포인터의 최종 선택 영역 |
| --- | ---: | ---: | --- |
| 왼쪽 탐색 | 24px | 20px | 44 × 44px |
| 상단 도구 | 18px | 17px | 36 × 36px |
| 대화 목록 | 16px | 14px | 기존 행 유지 |
| 입력창 도구 | 20px | 16px | 36 × 36px |
| 모달 닫기 | 20px | 16px | 40 × 40px |

펼침 화살표는 12px 토큰을 사용한다. 목록 보조 동작/탭/출처는 14px, 일반 동작은 16px다. 모달 제목의 장식 배지는 40px에서 32px로 줄이고 안의 아이콘도 동작 크기에 맞춘다. 그림, 실제 캡처, 로고와 작성 문서의 SVG는 조절 대상과 구분한다.

크기는 rem을 사용해 글자를 확대하면 같은 위계로 확대된다. 440px 창의 루트 20px에서 탐색 25px, 상단 21.25px, 목록 17.5px, 일반 동작 20px를 확인했다.

터치 포인터에서는 상단 도구와 모달 닫기 영역을 최소 44 × 44 CSS px로 맞췄다. 기존 CSS 우선순위 때문에 상단 너비가 36px에 남던 실패를 재현하고 수정했다. 선택한 탐색/상단/입력창/닫기 버튼은 `hasTouch` 환경의 `(pointer:coarse)`와 실제 영역을 함께 검사한다. 제품 전체의 iOS 접근성 인증을 뜻하지 않는다.

## 검증과 근거

`npm run test:icons-ui`는 실제 제품 컴포넌트와 전체 Desktop CSS를 사용해 일반 1280px, 글자를 키운 440px, 터치 440px의 18개 아이콘 그룹을 확인한다. 크기, 선택 영역, JavaScript 오류와 스크린샷을 기록한다. `test:gates`에도 연결했다.

변경 전 자료는 앞서 115개 화면 검사를 통과한 번들을 별도 폴더에 보관해 사용했다. 변경 후 소스를 이전 상태처럼 재구성하지 않았다. 첫 시험에서는 정적 파일 서버의 404 처리, toolbar host 누락, 초기 사이드바 로드 대기와 분할된 fixture CSS 로드 문제를 수정했다. 이들은 제품 오류 개선 성적으로 계산하지 않는다.

- [변경 전 대화 화면](../verification/icon-scale-2026-10-17/before-conversation-1280.png)
- [변경 후 대화 화면](../verification/icon-scale-2026-10-17/after-conversation-1280.png)
- [작은 창 설정 모달](../verification/icon-scale-2026-10-17/after-settings-440.png)
- [실제 변경 전 수치](../verification/icon-scale-2026-10-17/before.json)
- [실제 변경 후 수치](../verification/icon-scale-2026-10-17/after.json)

후속 전체 화면/모달/AI Workspace/Office 미리보기/빌드된 Electron 검사 결과는 `verification/design-token-audit-2026-10-17/icon-gates.json`과 `icons-*.log`에 남긴다. 앞선 글자/색상/간격 검토는 [전체 토큰 점검](DESIGN-TOKEN-AUDIT-2026-10-17.md)이다. 회사 실계정과 Windows 설치판 검증은 별도다.

후속 사용자 요청으로 왼쪽 메뉴 전체 폭을 72→56px, 버튼 48→44px, 세로 간격 20→12px로 줄였다. 1280px/440px/터치 환경에서 버튼이 메뉴 안에 들어가고 가로 잘림이 없는지 검사한다. 제공자 4곳의 실제 로그인 버튼 배경이 기존 제공자 토큰과 일치하는지도 확인한다.

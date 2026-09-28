# 캡처 실패와 UIA 관찰 분리

Windows Office 창의 UIA 읽기가 성공해도 PrintWindow가 실패하면 기존 코드는 관찰 전체를 버렸다. 캡처와 PNG 인코딩 오류만 분리해 UIA 요소를 유지하고 `imageStatus=unavailable`을 반환하도록 수정했다. 이미지와 해시 및 크기는 비운다. 원인은 native 응답에 고정 코드로만 남긴다.

전면 창, 프로세스, 제외 영역, 문서 fingerprint 재검사는 유지한다. 접근 대상이나 UIA 관찰 자체가 실패하면 기존처럼 전체 관찰을 거부한다. 이미지 메모리 부족 등 예상하지 않은 실패도 성공으로 바꾸지 않는다. 다른 캡처 API, 암호화 우회, 물리 마우스 입력은 추가하지 않았다.

기존 worker는 이미지가 없으면 UIA 텍스트만 별도 검토 모델에 전달한다. 이미지 지원 모델이어도 `imageViewed=false`, `renderingVerified=false`를 유지한다. GUI 동작 후의 텍스트 관찰은 동작 결과를 재확인할 근거이며 문서 완료나 저장의 증거가 아니다. 캡처 실패를 이유로 이미 실행한 동작을 재전송하지 않는다.

## 선택 근거

- [Microsoft UI Automation control patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview): UIA의 의미 있는 요소/패턴 관찰을 픽셀 관찰과 분리해 재사용한다. 기존 System.Windows.Automation을 유지하고 중복 자동화 런타임을 추가하지 않는다.
- [Anthropic computer-use BP](https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude): 이미지 해상도와 좁은 영역 확대는 별도 품질 문제다. 현재 전체 창 캡처의 최대 960×640 및 90KB 제한은 작은 문서 글자 판독에 한계가 있다. 관찰된 영역만 고해상도로 가져오는 후속 개선을 검토하되 이번 변경에는 넣지 않았다. Qwen의 이미지 지원이나 판독 정확도를 가정하지 않는다.

추가 라이브러리 없음. 기존 UIA, System.Drawing, Pi, p-map과 화면 검토기를 유지한다. 기존 정책이 허용한 UIA 정보를 계속 활용하는 것으로 NASCA 캡처 정책을 우회하지 않는다. UIA도 차단되면 진행할 수 없다.

## 검증 범위

`node --test tests/office-capture-fallback.test.mjs tests/office-view.test.mjs tests/virtual-cursor-contract.test.mjs`

새 검사 4개는 이미지 지원 모델의 텍스트 대체 경로, 모델 검토 중 문서 변경 거절, GUI 동작 중복 방지, native 소스의 제한된 오류 격리 계약을 확인한다. 기존 화면 검사 22개와 사용자 물리 커서 입력 금지 검사 1개를 함께 실행한다. 이 검사는 mock RPC와 소스 검사이며 실제 캡처를 실행하지 않는다.

사용자의 최종 빌드 요청이 없어 native/설치 빌드는 실행하지 않았다. 다음 Windows 검증에서는 PrintWindow 반환 실패, GDI 인코딩 실패, 검토 중 창 전환, 캡처 차단 환경의 UIA 허용/거절을 각각 검사해야 한다. Office 2016, Windows 11, NASCA와 실제 모델 판독 성능은 이번 변경으로 검증되지 않는다.

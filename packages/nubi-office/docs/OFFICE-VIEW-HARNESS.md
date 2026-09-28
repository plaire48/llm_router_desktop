# Office 작업 위치와 화면 검토

2026-09-23. Windows Office 2016, Qwen 3.8 27B 기준. 기본 목적은 문서 작성이며 화면 관찰은 실제 값, 수식, 구조와 저장 검증을 보완한다.

## 실행과 표시

1. 기존 계획과 승인 후 앱별 COM 도구가 작은 변경을 실행하고 실제 문서 값을 다시 읽는다.
2. Excel은 첫 변경 범위를 선택하고 스크롤한다. Word는 관찰한 문단/입력칸을 선택한다. PPT는 관찰한 슬라이드/도형을 선택한다. 여러 변경의 모든 위치를 동시에 표시했다는 의미가 아니다.
3. 별도 프로세스가 해당 Office 프로세스의 전면 창만 UI Automation으로 관찰하고 PrintWindow로 캡처한다. UIA 160개, 깊이 8, PNG 90KB 제한. 전체 바탕화면이나 임의 앱의 클릭 권한을 부여하지 않는다.
4. 작업 기록은 실제 시작과 결과에 연결된다. 사용자는 접힌 '작업 위치와 화면'에서 캡처를 펼친다. 가상 커서나 임의 진행 애니메이션을 성공 근거로 사용하지 않는다.
5. 모델의 inspect_office_view / show_document_target / act_office_view / review_office_view 도구로 추가 관찰과 검토가 가능하다. 새 Excel 초안은 첫 native 열기 후 화면을 관찰하고 별도 검토를 시도한다.

화면 검토는 같은 선택 모델의 독립 문맥 호출이며 tools=[]다. 기존 Nubi goalReviewMessages/parseGoalReview를 실제 재사용한다. 기존 p-map 읽기 전용 하위 분석은 유지하고 COM 수정은 순차 실행한다. 화면 검토에 별도 쓰기 권한은 없다.

## 근거와 복구

- 원본 문서/범위와 fingerprint를 관찰 전후에 검사한다. 창 이동이나 닫힘, 소스 변경, 오래된 캡처는 재관찰을 요구한다.
- 이미지 입력은 실제 제공자 메타데이터의 supports_images=true가 있고 해당 어댑터가 이미지 전달을 지원할 때만 사용한다. FabriX는 현재 텍스트 전달 경로이므로 제외한다. 모델 목록을 줄이거나 사용자의 모델을 교체하지 않는다. Qwen의 이미지 지원을 이름으로 추정하지 않는다.
- 이미지 미지원 시 UIA 텍스트/범위 검토만 수행한다. imageViewed=false / renderingVerified=false로 색, 잘림과 전체 시각 품질은 미확인이다. 이미지가 있어도 판단은 캡처 당시 보이는 영역과 요청한 검토 항목에 한정한다.
- 이미지 자체는 native 메모리에 최대 3개/2분 보관하고 취소/연결 종료/작업창 종료 시 비운다. Nubi 작업창은 이미지에서 가리고 UIA 하위 관찰에서 제외한다. 픽셀을 파일, 대화 이력, 압축 컨텍스트에 넣지 않는다. 이미지는 한 번 가져오고 선택 모델의 독립 검토 기준별 호출에만 전달한다.
- 모델 컨텍스트는 이미지 참조, 해시, 시점, 제한된 UIA 항목과 검토 결과를 받는다. UIA 문구는 비신뢰 데이터다. 검토 입력의 UIA 목록은 질문 관련도와 포커스로 골라 최대 30개/9,000자로 제한하며 누락 범위를 표시한다.
- 캡처 실패는 확인 실패로 표시하고 이미 적용한 변경을 다시 쓰지 않는다. 화면 관찰이 실패했다고 값/수식 검증을 성공 또는 실패로 덮어쓰지 않는다. 화면 확인 실패만으로 기존 문서 작성을 막지 않으므로 화면 동일성을 보장하지 않는다.
- 최소화, 다른 전면 창, 렌더링 차단, NASCA 캡처 차단, UIA 누락, 모니터 DPI 차이가 있을 수 있다. 우회하거나 보안 정책을 변경하지 않는다. 암호화 저장은 기존 Office 경로를 유지한다.

## 방법론과 도입 판단

| 후보 | 판단 | 실제 반영 |
|---|---|---|
| [Microsoft UFO](https://github.com/microsoft/UFO), MIT | Windows의 GUI와 API 혼합, Host/App 역할 분리를 참고. 전체 런타임/인증/임의 PC 제어는 중복이라 도입하지 않음 | COM 변경과 UIA 관찰 분리, 읽기 전용 검토 문맥 |
| [Windows UI Automation](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview) | .NET Framework 4.7.2 기본 API 사용 | 별도 프로세스에서 bounded ControlView 조회 및 지원되는 Invoke/SelectionItem/Scroll 패턴. Value 입력/키보드/물리 마우스 fallback 없음 |
| [FlaUI](https://github.com/FlaUI/FlaUI), MIT | 실제 5.0.0 NuGet은 net48/net6/net8. 현 net472 호스트와 직접 맞지 않고 관찰만을 위해 프레임워크/의존성을 늘릴 이점이 부족 | 미도입. 내장 UIA 선택 |
| [Anthropic computer use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | 관찰 → 동작 → 새 관찰, 비신뢰 화면 데이터, 환경별 도구 분리 참고 | 관찰한 대상의 한 동작 뒤 새 관찰, 기존 Office 문서 계약과 사용자 승인 유지 |
| [Vanara](https://github.com/dahall/Vanara), MIT | 물리 입력 후보를 검토했으나 사용자의 커서를 변경하지 않는 요구사항에 맞지 않아 제거 | 미도입. UIA 패턴과 별도 가상 커서 표시 사용 |
| [OpenAI computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) | 런타임 실행과 모델 판단 분리, 화면 재관찰과 consequential action 승인 참고. 전용 모델 API 도입 아님 | Qwen 도구 계약 유지, 입력 dispatch와 업무 성공 분리, 응답 유실 시 receipt 조회 |
| [pywinauto](https://pywinauto.readthedocs.io/en/latest/HowTo.html) | UIA 대상 탐색 접근 참고. 이미 .NET 호스트가 있어 별도 Python GUI 프로세스/의존성 중복은 이점 부족 | 미도입. Python은 승인된 문서 스킬 용도 유지 |
| Nubi/Pi/goal-review/p-map | 기존 실제 번들 유지 | 별도 읽기 전용 모델 호출, 이미지 문맥 한정, 실제 도구 시작/결과 기록 |

## 가상 AI 커서와 실제 동작

사용자 커서는 그대로 유지한다. 두 번째 OS 마우스 장치가 아니라 Office 창 위에 그리는 **AI 작업 위치 표시**다. 표시와 문서 조작을 분리한다.

- `act_office_view`는 최신 viewId/targetId와 hover/click/scroll_up/scroll_down 하나만 받는다. hover는 가상 표시만 하며 물리 호버/툴팁을 발생시키지 않는다. click은 UIA Invoke 또는 SelectionItem, scroll은 UIA Scroll을 호출한다. 지원하지 않으면 `view_pattern_unsupported`로 반환한다.
- **MUST NOT** 사용자 포인터를 이동하거나 `SendInput`, `SetCursorPos`, `mouse_event`, 합성 키 입력, Python GUI 입력으로 대신 실행한다. 드래그/더블클릭/물리 호버 메뉴와 별도 대화상자 자동화는 현재 지원하지 않는다.
- 값/수식/문서 구조는 COM 도구가 우선이다. GUI는 지원되는 Office 화면 요소 조작을 보완한다. GUI로 기존 변경 범위나 코드 실행/저장 승인을 우회하지 않는다. 클릭/스크롤은 기존 채팅 HITL에 대상 이름과 동작을 표시한다.
- helper는 UIA runtime ID, 이름, 종류, bounds, 활성 창/PID, 비밀번호/누비 영역 제외, 대상 hit-test를 다시 확인한다. 120초 지난 관찰이나 변경된 대상은 거부한다. 비신뢰 UI 텍스트를 명령으로 사용하지 않는다.
- native 실행 기록은 operationId와 소비한 viewId를 보존한다. 같은 요청은 영수증만 반환하며 동일 관찰을 다시 조작하지 않는다. 응답 유실은 receipt를 한 번 조회한다. 다음 동작은 새 관찰을 요구한다.
- 가상 포인터 도착 후 문서 바인딩을 재확인하고 실제 동작을 호출한다. 이동 중 취소/창 변경은 대기를 해제하고 실행하지 않는다. 동작 뒤 새 화면 및 범위 fingerprint를 확인한다. 패턴 호출 성공은 업무 완료/저장 성공이 아니다. 상태가 미확정이면 작업을 중지하며 사용자 확인 후 추가 기능 재시작이 필요하다. 취소나 재관찰로 이 차단을 자동 해제하지 않는다.
- 가상 커서는 로컬 Codex의 browser-agent-cursor 모양을 참고해 둥근 화살촉, 검은 면, 흰 테두리로 직접 그린다. 원본 이미지나 런타임 코드를 포함하지 않는다. 상시 이름표를 없애고 클릭 반응에만 누비의 `--deck-blue-deep` 색을 사용한다. no-activate, click-through, 작업표시줄 제외인 독립 표시 창이며 포커스를 받지 않는다. 사용자 커서를 읽어 따라가거나 가로채지 않는다. 성공 체크 모양을 가짜로 재생하지 않는다. 첫 위치는 즉시 표시하고 같은 Office 창에서 최근 관찰한 AI 위치 사이를 160ms ease-out으로 이동한다. 실제 UIA 클릭 dispatch 후에만 240ms의 작은 파동을 표시하며 완료 표시로 쓰지 않는다. Windows SPI_GETCLIENTAREAANIMATION을 읽어 모션이 꺼져 있거나 설정을 읽을 수 없으면 이동과 파동을 생략한다. 사용자 마우스를 시작 위치로 사용하지 않는다. 숨겨진 WinForms의 OnPaint에 의존하지 않고 [UpdateLayeredWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-updatelayeredwindow)로 알파 비트맵을 직접 전달한다.
- 실제 동작 대상에 표시하고 결과 후 짧게 숨긴다. 사용자 취소, Office 창 이동/크기 변경/전면 해제 시 숨긴다. 표시 창을 Office의 owned popup으로 만들지 않아 UIA 제공자의 last-active-popup 활성화 경로와 분리한다. native 선택/스크롤 뒤에는 UIA에서 실제 포커스를 확인한 요소에만 표시한다. 정확한 셀/문단 좌표를 확인하지 못하면 임의 위치를 그리지 않는다. UIA 포커스가 문서 컨테이너라면 그 컨테이너 수준 표시다.
- Office는 하나의 문서 상태와 선택을 공유하므로 사용자의 동시 편집을 완전히 독립된 두 세션처럼 보장하지 않는다. 기존 fingerprint 충돌 검사를 유지한다. 다중 DPI, UIA 제한, 실제 Office/NASCA 조합은 별도 검증 대상이다.

## 검증 구분

소스 테스트는 문서 바인딩, 이미지 손상, 이미지 미지원, 변경된 문서/만료, 취소, 실패한 캡처 후 쓰기 중복 방지, UI 지연 응답을 검사한다. Windows 게이트는 실제 WinForms 창에서 UIA, UTF-8, 이미지, 작업창 제외와 다른 PID 거부를 검사하고 설치된 helper에서도 반복한다. WinForms에서 사용자 커서 불변과 semantic 클릭/스크롤 효과, 가상 표시의 포커스/클릭 통과, 이동/만료 대상 거부도 검사한다. 표시 여부는 native 창의 Visible 상태만으로 판정하지 않으며, 합성 창 캡처에서 실제 커서의 검은 면과 흰 테두리 픽셀도 요구한다. 레이어 창을 포함하려고 [BitBlt CAPTUREBLT](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt)를 테스트에만 사용한다. 제품의 문서 캡처는 기존 창 한정 PrintWindow 경로를 유지한다. 모션 검사는 테스트 전용 설정 delegate로 켜짐/꺼짐, 실제 창 위치 변화, 도착 대기와 이동 취소를 확인한다. 시스템의 모션 설정을 변경하지 않는다. WinForms는 Office COM이 아니다.

Windows Office 2016 실제 선택/스크롤, NASCA, 각 모델의 실계정 이미지 이해, 사용자의 문서 품질은 별도 검증 전이다. 범용 Windows 마우스/호버/키보드 자동화는 제공하지 않는다.

## A2A 범위 결정

사용자 결정에 따라 A2A는 향후 연동 가능성만 남긴다. 이번 구현에는 A2A 프로토콜, 엔드포인트, 에이전트 발견/등록, 외부 작업 위임과 인증을 추가하지 않는다. 현재의 같은 실행 내 읽기 전용 하위 분석과 화면 검토는 A2A 지원을 의미하지 않는다.

## 후속 검토 보강

[Windows 화면 검토 보강](WINDOWS-VIEW-REVIEW-2026-09-23.md)에 따라 기준별 읽기 전용 하위 검토, 실제 native 재관찰 후 결과 채택, 무응답 차단, 부분 성공 재사용, Retry-After 전달을 추가했다. 새 관찰의 UIA/창 정보가 다르거나 이미지 검토의 픽셀이 바뀌면 이전 결과를 폐기한다. 하위 검토는 쓰기/저장 권한을 갖지 않는다.

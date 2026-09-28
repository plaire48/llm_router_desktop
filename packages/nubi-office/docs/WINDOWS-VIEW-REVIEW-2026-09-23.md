# Windows Office 화면 검토 보강

기준: Windows Office 2016 Excel/Word/PowerPoint와 사용자가 선택한 Qwen 3.8 27B 또는 다른 제공 모델. 앱 조작은 기존 Office 도구 범위 안에서만 수행한다. 이 변경은 worker 소스이며 native/설치 빌드를 실행하지 않는다.

## 사용자 작업 흐름

계획 표시 → 앱별 COM 도구로 한 단계 수행 → 실제 값/구조 재조회 → 필요하면 해당 창 캡처와 UIA 관찰 → 독립 화면 검토 → 현재 문서/화면 재확인 → 다음 단계 또는 수정. 화면 검토는 최종 요구사항 검사나 저장 승인 대신 사용할 수 없다. 모든 쓰기마다 이미지를 자동 호출하는 방식이 아니라 모델이 필요에 따라 기존 화면 도구를 선택한다.

사용자 마우스는 그대로 유지한다. 기존 가상 포인터는 AI 작업 위치를 표시하고, 실제 GUI 동작은 지원되는 UIA Invoke/SelectionItem/Scroll로 수행한다. COM 변경과 GUI 동작은 순차 실행한다. 범용 데스크톱 조작, 물리 키보드/마우스 fallback, A2A는 추가하지 않는다.

## 이번에 실제 변경한 부분

| 발견한 문제 | 적용 | 한계 |
|---|---|---|
| 모델 검토 뒤 worker의 이전 binding만 비교 | 기존 `view_observe`를 다시 호출해 native COM fingerprint와 전면 창을 확인한 뒤 UIA 요소/창 정보 비교. 이미지 검토는 픽셀 해시도 일치해야 채택 | 순간 관찰의 일치이며 이후 사용자 편집이나 전체 문서 동일성 보장 아님 |
| 앞의 UIA 30개만 검토해 뒤쪽 관련 요소 누락 | 기존 MiniSearch로 검토 질문과 관련된 원본 요소를 검색하고 포커스 요소와 함께 최대 30개/9,000자로 전달. 누락 범위 표시 | native 자체 관찰은 160개/깊이 8 제한. 검색은 누락 요소의 부재 증명이 아님 |
| 모든 기준을 한 문맥에서 검토 | `criterion` 또는 `criteria` 1~3개. 같은 선택 모델의 독립 문맥과 tools=[] 사용. 기존 p-map 실행기로 최대 2개 병렬, ChatGPT는 1개 | 병렬화가 정확도 향상을 보장하지 않음. 기준당 모델 호출 비용 발생 |
| 취소 신호를 무시하는 모델에서 무한 대기 가능 | 기존 분석 실행기의 Promise.race, 45초 개별 호출 제한, 취소와 모델 변경 검사 재사용 | 서버가 이미 받은 요청의 과금/중단 보장 아님. 늦은 결과는 채택하지 않음 |
| 일부 분기 실패 시 전체 검토 중복 | 같은 view ID/관찰/선택 모델/기준에 한해 성공한 분기를 메모리에서 재사용. 화면이 바뀌거나 새 관찰이면 재검토 | 실행 중 메모리 한정. 재시작 복원 아님 |
| HTTP 상태/Retry-After가 도구 경계에서 유실 | 안전한 상태/대기 시간만 기존 복구 supervisor에 전달. 인증/설정 오류는 반복하지 않음 | 성공한 쓰기나 미확정 UI 입력을 재실행하지 않음 |
| 반환 context의 중첩 값을 바꾸면 내부 근거도 변경 | 관찰/결과/문맥을 복제하고 잘못된 시각과 만료를 거부. 새 검토 시작 시 이전 완료 표시 제거 | 원본 native 신뢰/실제 Office 정확도는 별도 검증 |

검토 결과는 기준별 상태와 근거를 유지하고 모두 통과해야 aggregate complete다. blocked/revise가 하나라도 있으면 완료로 집계하지 않는다. 이 complete는 요청한 화면 검토 기준에만 해당한다. 실제 하위 호출 시작/결과가 기존 진행 기록에 표시된다.

이미지는 native 메모리에서 한 번 가져오고 해시/ID를 검사한다. 이미지 지원이 명시된 모델의 각 검토 분기에 동일 캡처를 전달할 수 있다. 픽셀은 대화 압축, 검토 결과 캐시 또는 디스크에 넣지 않는다. 텍스트 전용 모델은 `imageViewed=false`, `renderingVerified=false`다. 별도 vision 모델로 몰래 교체하지 않는다. 커서 깜빡임 등 화면 변화도 픽셀 불일치가 될 수 있으므로 거절은 보수적이며 전체 이미지 유사도 통과로 완화하지 않는다.

## 방법론과 오픈소스 판단

- [Microsoft UFO의 hybrid actions](https://github.com/microsoft/UFO/blob/main/documents/docs/ufo2/core_features/hybrid_actions.md): native API와 GUI를 역할에 맞게 병행하는 설계 참고. UFO 전체 런타임/MCP/인증은 미도입. 기존 COM/UIA 호스트를 유지하고 검토 뒤 실제 상태를 재확인하는 연결을 보강했다. UFO의 성능 수치를 이 제품의 측정치로 사용하지 않는다.
- [Microsoft UIA control patterns](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-controlpatternsoverview): 요소가 제공하는 패턴으로 동작하는 기존 방식을 유지한다. 미지원 동작을 물리 입력으로 우회하지 않는다. native UIA 코드는 이번 변경에서 수정하지 않았다.
- [Anthropic multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system): 좁은 독립 과업, 제한된 문맥, 병렬 읽기와 주 실행기의 통합 검토를 참고했다. 문서 쓰기 권한과 완료 판단은 주 실행기에 남긴다. Claude SDK/API 도입이나 Claude/Qwen 동등 성능 주장이 아니다.
- 실제 라이브러리 재사용: 기존 **p-map 7.0.4**의 실행 제한, **MiniSearch 7.2.0**의 한국어 검색, 공통 Pi 하네스와 Nubi goal-review 파서. 추가 npm 의존성 없음. 기존 MIT 라이선스/고정 버전 유지. UFO도 MIT이지만 코드를 복사하지 않고 설계만 참고했다.
- FlaUI/pywinauto 대체 런타임은 현 net472 호스트와 기존 UIA 중복 비용 때문에 새로 도입하지 않았다. 기존 비교 근거는 [Office 화면 하네스](OFFICE-VIEW-HARNESS.md)에 있다. 픽셀 유사도/OCR 추가로 미확인을 성공 처리하지 않는다.

## 검증과 남은 작업

수정 전 회귀 검사로 오래된 화면 검토 수용, 관련 UIA 요소 누락, 반환 문맥 변조를 재현했다. 관련 소스 검사 32개가 화면 변화, 이미지 변화, native 재조회 실패, 독립 기준/병렬 한도, ChatGPT 직렬 실행, 이미지 1회 조회, text-only 제한, 타임아웃/늦은 응답/취소, 모델 변경, 영구 오류, 부분 분기 재사용과 Retry-After를 검사한다.

배포 저장소 구성에서 `npm test` 전체 소스 테스트 469개가 통과했다. 상태표에도 같은 범위를 기록했다. 이번 턴은 Windows native 및 설치 빌드 없이 진행한다. 실제 Excel/Word/PowerPoint 2016 UIA/COM, DPI, NASCA 캡처 정책, 실계정 Qwen의 도구 선택/화면 판단/문서 품질은 미검증이다. 최종 빌드 뒤 실제 Windows에서 아래를 별도로 확인해야 한다.

1. 대상 문서 한 단계 편집 후 실제 readback과 해당 창 화면이 일치하는지 확인.
2. 모델 검토 중 사용자 수정/다른 창 전환/스크롤을 수행했을 때 이전 결과가 채택되지 않는지 확인.
3. 사용자 커서 불변, 클릭 승인, 한 번만 실행, 미확정 결과 차단 유지 확인.
4. 캡처 차단 또는 text-only 모델에서 미확인을 정확히 표시하고 완료한 쓰기를 반복하지 않는지 확인.

# Word/PowerPoint 양식 사본 선행

2026-09-23. 소스 구현과 제어 경로 검사 기록이며 실제 Office 2016/NASCA 검증이 아니다. Qwen 3.8 27B를 기준으로 설계하되 선택한 제공자/모델의 정확한 ID를 유지한다. 최종 빌드와 설치 파일 생성은 실행하지 않았다.

## 바뀐 흐름

기존 Word/PPT 편집은 열린 문서를 먼저 수정하고 나중에 새 경로로 저장할 수 있었다. 양식 재사용 요청에는 원본 파일을 보존할 사본이 먼저 필요하다.

`template` 계획은 원본 관찰/질문 → 사본 승인 → native 사본 생성/검사 → 사본 범위로 전환 → 변경별 승인/입력/readback → 요구사항 검토 → 같은 사본 최종 저장 승인을 따른다. 모델이 사본 생성 도구를 선택하기를 기다리지 않고 하네스가 첫 쓰기 앞에 표시 가능한 사본 단계를 삽입한다. 분석은 읽기 전용, 새 문서 생성은 기존 create, 사용자가 명시한 원본 수정은 edit 경로로 유지한다. 실제 모델의 의도 구분 정확도는 아직 측정하지 않았다.

후속 [앱별 양식 목록](TEMPLATE-CATALOG-2026-09-23.md)에서 보호 스냅샷 등록/재사용을 연결했다. 이 문서의 당시 미구현 표기는 해당 후속 소스 상태를 함께 참고한다. 실제 Office/회사 검증은 여전히 미실행이다.

## Office별 저장 경로

- Word: [SaveAs2](https://learn.microsoft.com/en-us/office/vba/api/word.saveas2)로 새 경로에 먼저 저장한다. 열린 문서가 사본으로 전환되며 원본 파일 경로로 저장하지 않는다. 복사 전의 저장되지 않은 변경도 사본에 포함된다. 승인 화면에서 이 동작을 설명한다. 기존 파일 형식과 호환 모드를 유지하고, 이전 경로에 묶인 참조는 변경 후 거절한다. 원본을 별도 창으로 자동 재열기하지 않는다.
- PowerPoint: [SaveCopyAs](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.savecopyas) 후 [Presentations.Open](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentations.open)으로 사본을 별도로 연다. [AutomationSecurity](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.application.automationsecurity)는 열기 직전에 매크로 실행 차단으로 설정하고 finally에서 기존 값을 복원한다. 저장/열기는 Office 자체 경로다.
- 현재 지원 형식: 저장 경로가 있는 docx/docm/pptx/pptm. 다른 형식이나 한 번도 저장하지 않은 원본은 명확한 오류로 중단한다. 기존 목적지 파일은 덮어쓰지 않는다. 원본 파일을 자동 저장하거나 파일 시스템/ZIP 편집기로 복제하지 않는다.
- 최종 저장은 승인 후 같은 사본의 native Save를 사용한다. 저장 전후 관찰 가능한 항목과 실제 저장 경로/상태를 확인한다. 다시 다른 사본을 생성하지 않는다.

## 범위, 보존과 오류

사본에 새로운 scope/document ID, 원본 scope ID와 fingerprint를 부여한다. 원본에서 캡처한 선택 범위만 복사한다. 사본의 `created`는 false이므로 빈 초안 전용 append/add 권한으로 확대되지 않는다. Word의 제한된 입력칸/문단, PPT의 선택된 슬라이드/단순 텍스트 지원 범위는 유지한다.

native에서 전체 관찰 목록과 선택 집합을 비교한다. worker는 필수 검사 세 항목과 원본 버전/대상/개수/사본 권한을 다시 검사한다. 불일치를 LLM의 완료 선언으로 무시할 수 없으며 사본에 입력하지 않는다. 페이지/분석 캐시를 새 사본으로 초기화하고 사용자 답변과 실행 ID는 유지한다.

복사 요청은 일반 재시도 대상이 아니다. COM 변경 전에 operation ID의 uncertain 영수증을 기록한다. 응답이 유실되면 같은 영수증만 조회하며, 결과가 불확실하면 멈춘다. 원본 변경, 복사/최종 저장 취소, 검증 실패 후 원본 수정으로 자동 대체하지 않는다. 초기 사본은 화면에 ‘최종 저장 전’ 또는 ‘보존 확인 필요’로 표시하며 최종 결과 artifact와 구분한다. 부분 생성된 파일/열린 문서를 오류 복구로 자동 삭제하거나 닫지 않는다.

관찰의 일치는 **읽어낸 내용/속성에 한정**된다. 누락/잘린 내용, Word의 외부 style part와 머리말/꼬리말, PPT의 모든 미지원 개체/애니메이션, 화면/인쇄 동일성과 NASCA 암호화를 증명하지 않는다. 이를 승인 화면에 안내한다. Word/PPT는 양식 분석 명세의 보호 저장/재사용 기능이 아직 없다.

## BP와 오픈소스 선택

| 후보/근거 | 적용 및 판단 |
|---|---|
| [Anthropic effective agents](https://www.anthropic.com/engineering/building-effective-agents) | 결정적인 보호 절차는 명시적 워크플로에 두고, 내용 작성/검토는 모델이 담당하는 패턴 적용. 복사 단계와 승인/검사를 모델의 자발적 도구 선택에 맡기지 않음 |
| Pi agent core 0.86.1 / MIT | 기존 실행기에 template 계획/연속성을 직접 연결. 새로운 에이전트 런타임 설치 없음 |
| p-retry 8.0.1 / MIT | 기존 읽기/모델 복구를 유지. 복사/저장/쓰기는 대상에서 제외하고 영수증 경로 재사용 |
| Open XML SDK 3.3.0 / MIT | 기존 in-memory Word XML 검증을 유지. 패키지 Clone/ZIP 경로를 NASCA 원본에 도입하지 않음 |
| [Open-Xml-PowerTools](https://github.com/OpenXmlDev/Open-Xml-PowerTools) / MIT | 양식과 데이터 분리/문서 비교 기능 후보 검토. 이 변경에서는 런타임 미채택: Office 밖 패키지 재작성은 현재 암호화·원본 보존 계약에 맞지 않음 |
| [pptx-automizer](https://github.com/singerla/pptx-automizer) / MIT | 기존 양식의 도형 ID와 디자인을 재사용하는 방식 참고. ZIP 조립/수정 엔진은 도입하지 않고 Office 사본/고정 ID 비교 적용 |

새 의존성보다 현재 설치 구조, 원본 보존, 실패 시 동작을 기준으로 선택했다. 특정 라이브러리의 존재를 실제 Office 품질 검증으로 취급하지 않는다.

## 검증 및 다음 단계

`tests/content-agent.test.mjs`는 실제 Pi 실행기에 scripted model/native 응답을 연결해 Word/PPT 사본→입력→최종 저장, 같은 실행의 답변 유지, 복사/최종 저장 응답 유실, 취소, 원본 변경, 잘못된 사본 근거, 최종 경로 불일치를 검사한다. `tests/content-ui.test.mjs`는 승인 버튼/취소/앱별 오류를 검사한다. 이 검사는 COM 구현을 실행하지 않는다.

검증 기록: [template-copy-review.json](../verification/template-copy-review.json). native 컴파일은 최종 빌드 요청 때 수행한다. 이후 실제 Windows에서 Word SaveAs2의 문서 전환, PPT 다중 창/작업창 수명, 매크로 형식, 원본 파일 불변성, NASCA 사본 저장/재열기, 서식/페이지/인쇄 보존, Qwen의 의도 구분/작성 품질을 검증해야 한다. 그 전에는 배포/정확도 검증 완료로 표시하지 않는다.

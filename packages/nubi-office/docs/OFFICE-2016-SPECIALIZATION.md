# Office 2016 앱별 특화와 단일 선택형 설치

2026-09-23. **소스 구현 단계. 새 설치 파일과 Windows COM 실행은 아직 검증하지 않았다.** 기존 설치본에 Word/PowerPoint가 추가된 것은 아니다. 사용자가 최종 빌드를 요청할 때만 빌드한다.

## 제품 구조

Excel, Word, PowerPoint의 VSTO 진입점은 분리하고 누비 UI, 모델 연결, Pi 실행, HITL, 오류 복구는 공유한다. 네이티브 진입점이 worker의 앱 종류를 고정한다. 프롬프트나 UI payload가 다른 앱의 실행기로 바꿀 수 없다. Microsoft 365 Copilot의 모델 교체가 아니라 Office 2016 안에 설치하는 누비 추가 기능이다.

하나의 EXE에 공통 실행 엔진과 세 앱의 진입점을 함께 포함한다. 사용자는 Excel, Word, PowerPoint를 원하는 조합으로 선택한다. Word만, PPT만, Excel+Word+PPT 모두 가능하다. 실행 중 별도 Node/Python/라우터/브라우저 확장 설치를 요구하지 않는다. Office 자체와 기존 .NET Framework 4.7.2 전제는 그대로이며 VSTO/WebView2는 설치 과정에서 준비한다. 선택 변경 시 제외한 앱의 등록과 진입 파일을 제거하고 공통 구성요소는 유지한다.

## 앱별 구현과 경계

| 앱 | 실제 소스에 연결한 기능 | 앱별 검증 | 미지원 또는 미검증 |
|---|---|---|---|
| Excel | 기존 다중 시트 읽기, 값/수식/서식 수정, 새 통합문서, 양식 사본 | 기존 수식 호환성, 선택 범위, 계산/readback 경로 유지 | 기존 정확도/실환경 경계 유지 |
| Word | 문단과 기본 스타일/제목 수준 읽기, 새 문서에 제목/문단/표 추가, 선택한 단순 문단 교체, 제목/태그로 식별한 일반 텍스트 입력칸 채우기, Office 저장 창으로 새 사본 저장 | 문단 내용, 기본 제목 수준, 표의 전체 셀 내용, 선택 밖 문단 속성 보존, 새 문서의 Office 2016 XML 요소 구조 | 선택한 일반 텍스트 Content Control의 기본 입력만 추가됨. XML 매핑/공용 등록, 머리말/꼬리말, 자동 목차, 이미지, 변경 추적 편집, 복잡한 rich text 수정은 미구현 |
| PowerPoint | 슬라이드/도형/노트와 서식 run 읽기, 제목/본문/발표자 노트로 새 슬라이드 작성, 생성한 슬라이드 내용 보완, 선택 슬라이드 복제, 선택한 단순 도형 텍스트 교체, 새 사본 저장 | SlideID/Shape.ID, 원본 도형 배치/내용, 텍스트 실제 측정값 기반 넘침, 작성 내용/노트 readback | 차트/이미지/SmartArt/애니메이션 생성, 임의 디자인 생성, 혼합 서식 교체는 미구현 |

문단 전체나 도형을 명확히 선택하지 않은 기존 문서는 읽기만 가능하다. 필드, 표 내부의 일반 문단, 책갈피, 그림, 혼합 텍스트 등은 일반 교체에서 제외한다. 별도 fill_field는 선택한 inline 일반 텍스트 콘텐츠 컨트롤만 채우며 잠금/매핑/임시/중첩/다중 행은 제외한다. PPT도 단일 서식의 단순 텍스트 도형만 교체한다. 복잡한 회사 양식을 전부 처리한다고 표시하지 않는다. 원본 전체 재직렬화를 피하고 Office의 native duplicate/append/replace를 제한적으로 사용한다.

현재 Word는 본문 문단 2,000개, PPT는 슬라이드 200개/관찰 항목 2,000개 이내에서 읽기를 40개씩 나눈다. 이 수치는 처리 경계이지 해당 최대 분량의 모델 품질을 검증한 수치가 아니다. 모델 문맥 한도도 별도로 적용된다. 문단의 그림/스타일/필드와 슬라이드의 숨겨진 속성 전부를 모델로 전송하지 않는다. 해당 제약을 전체 보존 증거로 과장하지 않는다.

## 적용한 방법론

1. **앱별 도구 계약**: Excel의 주소/수식 계약을 Word/PPT에 억지로 매핑하지 않는다. Word는 문단과 기본 스타일, PPT는 슬라이드와 도형 ID를 사용한다. 새 앱의 읽기/쓰기 RPC는 `office_*`이며 Excel 도구를 호출할 수 없다.
2. **계획 → 작은 동작 → 결과 → 검토**: 요구사항을 먼저 고정하고 계획을 표시한다. Pi는 한 번에 한 도구만 실행하며 다음 결정에 receipt를 포함한다. 수정 제안 검토, 단계 결과 검토, 원래 요구사항 전체 검토를 분리한다. 검토 실패 시 작성 단계로 돌아가고 기존 초안은 유지한다.
3. **승인과 보존**: 기존 문서 수정과 최종 저장은 HITL을 기다린다. 질문은 같은 실행 안에서 답변을 보존하며 exact receipt ACK 후 사라진다. 문서 내용은 명령이 아니라 비신뢰 자료로 취급한다. 모델의 완료 선언으로 native 검사 실패를 무시하지 않는다.
4. **재시도 소유권**: p-retry는 모델/명시된 읽기에만 사용한다. 생성/쓰기/저장은 작업 ID와 native 실행 기록으로 조정한다. 응답 유실 시 `office_receipt`를 읽고 미확정 쓰기는 재전송하지 않는다. 진전 없는 세 번의 복구는 사용자 재시도/중지 확인에서 멈춘다.
5. **STA와 문서 바인딩**: COM 호출은 task pane UI/STA에서 직렬 처리한다. 실행 중 ActiveDocument를 다시 찾아 다른 문서를 수정하지 않는다. 창에서 얻은 문서 참조와 opaque scope, 적용 직전 fingerprint를 확인한다. 다중 에이전트가 Office에 병렬 쓰기 하지 않는다.
6. **NASCA 경로**: Word/PPT 생성/저장은 Office COM으로만 실행한다. 회사 파일을 ZIP으로 열거나 외부에서 복호화하지 않는다. Word XML 검증은 메모리의 XML 요소에 수행하며 OPC 패키지/IsolatedStorage 또는 평문 임시 파일을 만들지 않는다. 실제 NASCA 암호화 성공은 회사 환경에서 확인해야 한다.

근거: [Microsoft의 VSTO task pane](https://learn.microsoft.com/en-us/visualstudio/vsto/custom-task-panes?view=vs-2022), [Office STA/threading](https://learn.microsoft.com/en-us/visualstudio/vsto/threading-support-in-office?view=visualstudio), [Anthropic의 routing와 evaluator-optimizer](https://www.anthropic.com/engineering/building-effective-agents), [에이전트 평가 방법](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

## 오픈소스 비교와 채택

| 후보 | 이번 결정 | 근거 |
|---|---|---|
| [Office AI Agent](https://github.com/it235/office-ai-agent) / Apache-2.0 | 실제 재사용 | 기존 고정 revision의 Word/PPT VSTO designer를 분리한 최소 진입점에 재사용. 기존 중국어 UI나 임의 코드 실행 도구는 가져오지 않음 |
| [Pi](https://github.com/earendil-works/pi) / MIT | 실제 재사용 | 기존 0.86.1 누비 실행기, 선택 모델, 도구 검증, 한 도구씩 실행하는 계약 유지. Claude 전용 모델/계정 의존성 없음 |
| [Open XML SDK](https://github.com/dotnet/Open-XML-SDK) / MIT | **실제 native 소스 의존성 추가** | `DocumentFormat.OpenXml` 3.3.0 고정, `OpenXmlValidator(FileFormatVersions.Office2016)`로 Word가 제공한 본문 XML 요소를 메모리에서 검사. .NET Framework 호환, 라이선스/NOTICE 동봉. native restore/compile/실행은 최종 빌드까지 미검증. 요소 검증은 OPC 관계/패키지/시각 검증을 대신하지 않음 |
| p-retry / MIT | 실제 공통 실행 경로 재사용 | 일시적 모델/읽기 실패와 backoff/HITL 정책. mutation 재시도에는 사용하지 않음 |
| [docx](https://github.com/dolanmiu/docx) / MIT | 검토, 미도입 | 새 DOCX 선언형 생성은 유용하나 기존 회사 파일을 다시 구성할 이유가 없고 Office 내 스타일/문서 상태/보안 저장이 우선 |
| [docxtemplater](https://github.com/open-xml-templating/docxtemplater) | 검토, 미도입 | 태그 기반 양식 채우기는 참고. 임의 기업 양식에는 태그 등록/분석 과정이 선행되어야 하고 ZIP 직접 수정은 현재 NASCA 경로와 불일치. 본체/추가 상용 모듈의 라이선스 범위를 구분해야 함 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) / MIT | 검토, 미도입 | 새 슬라이드/마스터 생성 API는 유용하지만 기존 Office 문서와 형상을 native로 유지하는 이번 쓰기 경로에는 중복 엔진. 새 파일 생성 전용 경로를 채택할 때 별도 검증 |
| [pptx-automizer](https://github.com/singerla/pptx-automizer) | 설계 참고, 미도입 | 템플릿 슬라이드/도형의 안정적 선택과 다층 검증 참고. 프로젝트가 명시하는 애니메이션 ID/일부 미디어/복잡한 layout 제한, ZIP 재구성 경로 때문에 보존 실행기로 채택하지 않음 |
| [ShapeCrawler](https://github.com/ShapeCrawler/ShapeCrawler) | 검토, 미도입 | PPTX 조작용 .NET API 후보지만 native Office 측정/보안 저장을 대신하지 못해 중복 OOXML 편집 계층을 추가하지 않음 |
| LangGraph / Claude Agent SDK | 방법론 참고, 미도입 | durable 실행과 interrupt 패턴은 유용하지만 현재 메모리 상태를 그대로 재시작 복구로 포장할 수 없음. 기존 Pi와 별도 하네스를 중첩하지 않음 |

최신 패키지라는 이유만으로 추가하지 않았다. Open XML SDK 3.3.0은 호환 API와 고정 소스로 선택한 버전이며 최신 버전이라는 주장이 아니다. 각 도구의 현재 README와 Microsoft 공식 문서를 확인했다. [Open XML SDK 버전/대상 프레임워크](https://www.nuget.org/packages/DocumentFormat.OpenXml/3.3.0), [OpenXmlValidator](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.validation.openxmlvalidator), [PowerPoint native 복제](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.slide.duplicate), [Inno Setup 선택 구성요소](https://jrsoftware.org/ishelp/topic_componentssection.htm).

## 검증과 다음 릴리스 조건

이번 검사는 실제 Pi와 제어된 provider/native 응답으로 host 격리, 순차 실행, 저장 전 HITL과 미완료 저장 단계 표시, 답변 ACK, 원본 충돌, 유실 응답 조정, 미확정 쓰기 금지, 재시도 일시 중지, 보존 실패 시 미완료 처리를 확인한다. React 소스 검사에서는 각 앱의 소개/입력/선택 도구/승인 명칭과 공통 UI 재사용을 확인한다. **이 검사는 Word/PPT 실행이나 Qwen의 문서 품질 평가가 아니다.**

[소스 검사 기록](../verification/office-host-source-review.json)에 테스트 범위와 소스 해시를 남긴다. 네이티브 API 검토에서 PowerPoint `HasVBProject`는 MsoTriState가 아닌 Boolean임을 확인해 매크로 형식 선택을 수정했다. [Microsoft API 계약](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentation.hasvbproject).

최종 빌드 이후 Windows에서 반드시 확인할 항목:

- 각 VSTO project/native host 컴파일, 세 manifest의 배포 무결성, x86/x64 로딩.
- Word만 → PPT만 → 모두 선택하는 설치 변경, 제외 앱 등록 제거, 재설치/제거. 기존 Windows 검사 스크립트를 확장했지만 이번에는 실행하지 않음.
- 앱별 다중 창/문서 전환, 닫힌 문서, 보호/읽기 전용/변경 추적, mixed runs/표/그림이 있는 선택 영역에서 오염 방지.
- 실제 Word 제목/표/저장 후 재열기, PPT 테마/레이아웃/도형 크기/글꼴 대체/노트/넘침. 화면과 출력물을 검토자가 비교.
- 회사 NASCA 열기/저장/다시 열기, 실제 회사 모델 연결, Qwen 3.8 27B의 대표 업무 정확도·반복 성공률·시간·비용.

기본 입력칸 지원 이후의 후속 우선순위는 **Word Content Control 유형 확장과 보호된 양식 등록**, **PPT rich-text run/표 단위의 보존 편집**, **이미지/차트와 렌더링 검증**, **보호된 durable checkpoint**다. 기능 이름을 도구 목록에 먼저 노출하지 않고 실제 native 동작과 회귀 증거가 생겼을 때 활성화한다.

현재 세부 반영 상태와 후속 작업은 [개선 상태 반영표](IMPROVEMENT-STATUS.md)를 기준으로 확인한다.

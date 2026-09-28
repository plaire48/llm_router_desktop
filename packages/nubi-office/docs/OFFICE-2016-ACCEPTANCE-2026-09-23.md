# Office 2016 추가 기능 수용 기준

사용자의 기준은 실제 Office 2016 추가 기능에서 요구한 문서를 작성하고 검증할 수 있는가다. 등록된 스킬 수, 도구 호출 수, 소스 테스트 성공은 이 기준의 대체 지표가 아니다.

## 이번 점검과 반영

Word와 PowerPoint가 같은 apply_operation 설명에서 서로 다른 앱의 JSON 예시를 함께 제공했다. 현재 모델에 제공하는 도구 설명을 앱별로 분리하고 contentOperation 검증과 같은 작업 목록을 사용한다. Word에서 add_slide, PowerPoint에서 append_table을 허용하지 않는다.

추가 기능은 runStart에서 실제 COM Application.Version과 프로세스 비트 수, 관찰 시각을 읽어 worker에 전달한다. 클라이언트가 보낸 환경값을 그대로 믿지 않는다. `office_capabilities`는 구현 범위, 미구현 기능과 이 native 관찰을 제공한다. 16.0은 여러 Office 제품의 공통 버전이므로 이를 Office 2016 SKU나 모든 기능의 호환성 증명으로 사용하지 않는다. native 값이 없으면 미확인이다. 이 관찰은 실행 시작 시점의 상태이며 도구별 실제 문서 결과 검증은 별도다.

등록 스킬은 실제 도구 경로와 연결한다. 목록 탐색 → SKILL.md 활성화 → 참고 자료 읽기/호환 계산 코드 실행 → 앱별 쓰기 → 독립 readback으로 검증한다. 스킬이 요구하는 기능이 제공 도구에 없다면 우회 실행/가짜 성공 대신 사용자에게 지원 가능한 대안을 확인한다.

## 기능 범위

| 앱 | 현재 구현 범위 | 주요 미구현 |
|---|---|---|
| Excel | 선택 범위 값/수식/서식, 다중 시트 읽기/분석, 확인된 양식 입력, 새 다중 시트 문서 | 기존 문서의 차트/피벗/표 생성, 정렬/필터 변경, 기존 시트 추가/삭제, 조건부 서식 변경 |
| Word | 새 문서 문단/제목/표, 관찰된 편집 가능 문단/일반 입력칸, 양식 사본 | 머리말/꼬리말, 목차 생성, 이미지 생성, 변경 추적 편집 |
| PowerPoint | 새 슬라이드 제목/본문/노트, 기존 슬라이드 복제/허용 텍스트 수정 | 차트/이미지 생성, SmartArt, 애니메이션, 임의 레이아웃 편집 |

각 범위에도 원본 바인딩, 생성 문서 소유권, editable 표시, 양식 보존 및 HITL 조건이 있다. 사용자 업로드 스킬은 이 범위를 늘리지 않는다.

## 실제 Windows에서 통과해야 할 게이트

| 게이트 | 확인할 실제 결과 | 이번 상태 |
|---|---|---|
| 설치와 로드 | Excel/Word/PPT 선택 설치, Office 프로세스 안의 추가 기능 로드, WebView2/worker 통신, x86/x64 | 새 소스의 빌드/실설치 미실행 |
| 등록과 재진입 | 실제 ZIP/폴더 선택, 중첩 파일 바이트/해시, 취소/중복 요청, DPAPI 보호 저장 후 Office 재시작 | native 소스 반영, Windows 미검증 |
| 스킬/도구 선택 | 같은 Qwen 모델이 적합 스킬 선택, 실제 SKILL.md/참고 자료 읽기, 필요한 질문, 해당 앱 도구 선택 | 합성 provider + 실제 Pi 도구 경로 검사. 실모델 미측정 |
| 작업 결과 | 실제 COM 변경과 독립 정답/비대상 속성 비교, 저장 후 재열기 | 이번 Windows Office 2016 검증 미실행 |
| 실패 복구 | busy/인증/취소/응답 유실, 미확정 쓰기 영수증 조회, 중복 변경 방지 | 기존 소스 검사 유지. 실제 조합 검증 필요 |
| 기업 환경 | NASCA 열기/저장/캡처 정책, 사내 SSO/모델, 회사 템플릿 보존 | 미검증 |

기존 `eval/`의 Excel COM 독립 채점과 저장/재열기 경로, Promptfoo custom-provider 연결을 재사용한다. Word/PPT까지 같은 수준의 실제 추가 기능 수용 시나리오를 자동화한 것은 아니다. 다음 최종 빌드 시 native 컴파일부터 확인해야 하며, Office 2016 실행 환경 없이 이 표를 통과로 변경하지 않는다.

[Anthropic의 agent eval 방법론](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)을 참고해 실행 trace와 실제 환경의 최종 상태를 구분한다. [OpenAI agent 평가](https://developers.openai.com/api/docs/guides/agent-evals)의 도구 선택 평가도 별도로 둔다. 새 평가 프레임워크를 붙여 기존 하네스와 채점기를 중복시키지 않는다. [Microsoft VSTO runtime 문서](https://learn.microsoft.com/en-us/visualstudio/vsto/visual-studio-tools-for-office-runtime?view=visualstudio)에 따른 추가 기능 실행 기반과 실제 문서 기능 검증은 별도 게이트다.

최종 소스 검증: 배포 소스 체크아웃의 `npm test`에서 490개 통과, 실패/취소/건너뛰기 0개. 새 Windows native 컴파일, 설치 파일 빌드, 실모델 호출은 실행하지 않았다.

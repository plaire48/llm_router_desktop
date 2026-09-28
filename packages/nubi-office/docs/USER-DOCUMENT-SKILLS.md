# 사용자 등록 Agent Skills

2026-09-25: [최소 입력 실행 방식](SKILL-AUTONOMY-2026-09-25.md)을 적용했다. 기존 규칙형 편집기의 질문/입력 방식 설정과 실행 전 고정 설문을 제거했다. 에이전트가 요청과 문서를 확인하고 필요한 정보만 같은 실행에서 질문한다. 기존 확인 항목, 작성 규칙과 실제 답변은 보존하며 모델 판단을 사용자 답변으로 저장하지 않는다.

2026-09-23 후속 수정. 사용자는 보고서 프리셋 대신 **자신의 스킬 ZIP 또는 폴더**를 등록한다. 기존에 저장한 작성 규칙/질문은 호환을 위해 유지하되, 신규 등록의 기본 경로는 패키지다.

## 사용 흐름

1. 채팅 `+` → 작성 스킬 → **ZIP 등록** 또는 **폴더 등록**을 누른다. Windows 기본 선택 창에서 파일/폴더 하나를 선택한다. 별도 이름·질문 폼은 없다. 등록 결과를 목록에서 다시 확인한 뒤 현재 채팅의 다음 요청에 자동 연결하고, 사용자는 연결 칩에서 해제할 수 있다.
2. 스킬의 `SKILL.md`, `scripts`, `references`, `assets`와 그 아래 파일을 상대 경로와 바이트 그대로 읽어 등록한다. ZIP을 평문 파일로 풀지 않는다. 파일 목록에서 하위 경로를 확인할 수 있다.
3. 기존 스킬을 직접 선택하거나, 선택하지 않고 문서 작성 요청을 보낸다. 직접 선택한 패키지는 계획 전에 실제 SKILL.md를 로드한다. 선택하지 않은 경우 에이전트가 등록 목록을 보고 요청에 필요한 스킬을 도구로 활성화한다.
4. 부족한 사실은 기존 `ask_user` 객관식/주관식 폼으로 확인한다. 이후 문서별 계획 → 작은 도구 호출 → 결과 확인 → 다음 단계 흐름을 따른다.

한 패키지에는 루트 `SKILL.md` 하나가 필요하다. ZIP에 스킬을 감싼 상위 폴더가 있으면 그 폴더를 루트로 사용한다. 그 밖의 파일이 섞인 ZIP이나 여러 SKILL.md를 가진 저장소 전체는 받지 않는다. 앱별 카탈로그는 50개까지다. 스킬 하나당 파일 256개, 총 8MiB, 파일당 2MiB, SKILL.md 60,000바이트, 상대 경로 160자/16단계까지다. 이는 파일 보관·전송 상한이며 LLM 문맥 상한과 다르다. 빈 디렉터리 자체는 저장하지 않지만 모든 등록 파일의 하위 경로를 보존한다. 심볼릭 링크/Windows junction, 상위 경로 탈출, 중복/대소문자 충돌, 예약 장치 이름은 거부한다.

## 스킬 활용과 도구 선택

- 기존 Pi SDK의 `parseFrontmatter`로 Agent Skills YAML 메타데이터를 읽는다. 필수 name/description과 본문을 검증한다. 파일명/설명만으로 등록 성공을 표시하지 않고 보호 저장 및 재읽기 후 목록에 나타낸다.
- 준비 단계는 이름/설명만 조회한다. `list_document_skills(query?, offset?, limit?)`는 기존 MiniSearch로 관련 항목을 먼저 정렬한다. 첫 응답은 최대 10개이며 `total`과 `nextOffset`으로 나머지 전체 50개까지 조회한다. 실행 문맥에는 관련도 상위 5개의 설명만 미리 싣고 나머지는 검색·페이지 조회한다. 단어가 일치한다는 이유로 자동 실행하지 않는다.
- `use_document_skill(id, revision)`은 저장 버전과 전체 파일 명세 해시를 확인하고 실제 SKILL.md 전체를 로드한다. 서로 다른 패키지의 같은 이름은 고유 ID 경로로 격리한다. 한 작업에서 최대 3개 스킬, 활성 SKILL.md 합계 60,000바이트다.
- `read/find`는 Pi의 기존 도구를 사용한다. 활성화한 패키지의 하위 자료를 필요할 때 48KB native 페이지로 읽고 크기/순서/개별 파일 SHA-256을 확인한다. 텍스트는 기존 원문 페이지 읽기와 연결한다. 긴 참고 자료를 모두 모델에 넣지 않는다.
- `run_script`는 등록한 하위 경로의 호환 JS/Python 코드를 기존 실행기에 넘긴다. 원본 패키지는 읽기 전용이다. 수정이 필요하면 `draft/`로 옮겨 기존 read/edit/write와 문법 검사/실행 검증을 사용한다. `prepare_python`은 기존 uv/Python 3.12와 정확한 의존성/실행 HITL을 유지한다.
- `office_capabilities`는 해당 앱에서 구현한 작업과 미구현 기능, native가 보고한 버전/비트 수를 구분한다. 스킬 지침은 없는 COM 기능이나 승인 권한을 만들 수 없다. Word/PPT의 apply_operation 설명도 앱별로 분리했다.
- 활성 스킬 원문과 버전/해시는 계획, 후속 문맥, 최종 검토에 유지한다. 스킬 로드 자체를 문서 작성 성공으로 집계하지 않는다. 같은 스킬 반복 호출은 기존 진전 없는 호출 검사와 복구 정책을 따른다.

## 저장과 호환 범위

Windows DPAPI CurrentUser 카탈로그에 메타데이터와 파일 바이트를 보호 저장한다. 사용자 입력 답변은 패키지에 저장하지 않는다. 목록/대화에는 리소스 바이트를 넣지 않고 native와 worker 사이에서 필요한 파일만 읽는다. 등록 요청의 응답 유실은 기존 영수증 조회로 조정하며 자동 재등록하지 않는다. 파일/폴더 선택 취소는 아무 스킬도 저장하지 않는다.

**모든 외부 스킬을 그대로 실행한다는 의미는 아니다.** JS는 동기 `transform(input)`과 JSON 입출력, Python은 `def transform(input)`과 기존 승인/제한을 사용한다. 임의 shell/CLI, Python 다중 모듈의 상대 import, 임의 Office 파일 열기, unsupported COM API는 자동 허용하지 않는다. 에이전트는 지원 가능한 코드를 메모리 초안으로 조정할 수 있으며 미지원 요구사항은 설명하고 질문해야 한다. 바이너리 자산은 바이트/해시/경로를 보존하고 조회 시 자산 정보만 반환한다. 업로드한 `.xlsx/.docx/.pptx`를 곧바로 편집 양식으로 여는 기능은 이번 범위가 아니며 기존 Office 양식 등록/복사 경로를 사용한다. NASCA 문서는 Office 열기/저장 경로를 유지한다.

## BP와 실제 오픈소스 재사용

- [Agent Skills 명세](https://agentskills.io/specification)와 [클라이언트 구현 가이드](https://agentskills.io/client-implementation/adding-skills-support): 목록 메타데이터 → 활성 SKILL.md → 필요한 리소스, 명시적/모델 선택, 중복 활성화 방지와 압축 후 지침 유지 방식 적용. 스킬의 allowed-tools는 호스트 권한을 바꾸지 않는다.
- [OpenCode의 스킬 도구 소스](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/opencode/src/tool/skill.ts), [Claude의 스킬 로딩](https://code.claude.com/docs/en/skills), [Codex 스킬 작성 소스](https://github.com/openai/codex/blob/d7b07d45517a793acfba4cbf8de697d723cceb46/codex-rs/skills/src/assets/samples/skill-creator/SKILL.md): 여러 스킬은 먼저 메타데이터로 찾고 선택한 지침과 참고 파일만 필요할 때 읽는 공통 방식을 확인했다. 등록 후 자동 연결과 목록 페이지 조회에 이 방식을 반영했다. 새 스킬 프레임워크는 도입하지 않았다.
- 다중 하위 분석은 독립적인 읽기 전용 문서 범위에 사용한다. 여러 워커가 스킬 파일 보관 상한이나 한 작업의 활성 지침 예산을 늘려 주지는 않는다. 원래 요청·스킬 지침·현재 답변을 부모가 유지하고, 스킬의 `context: fork`나 `allowed-tools`를 그대로 권한/실행 설정으로 해석하지 않는다. [Claude 하위 에이전트 동작](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent)과 [Anthropic 스킬 보안 지침](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#security-considerations)을 참고했다.
- 실제 재사용은 **Pi Coding Agent SDK 0.86.1**의 YAML frontmatter/parser/스킬 프롬프트/파일 도구, **MiniSearch 7.2.0**, 기존 QuickJS/uv Python 실행기다. ZIP은 .NET Framework의 **System.IO.Compression.ZipArchive**를 사용한다. 신규 npm 프레임워크나 별도 Python 스킬 호스트를 추가하지 않았다.
- [Anthropic tool engineering](https://www.anthropic.com/engineering/writing-tools-for-agents): 기능 경계를 명확히 한 설명과 실제 호출 순서 평가를 적용한다. 여러 앱의 작업 형식을 한 도구 설명에 섞지 않는다.
- [OpenAI의 agent 평가](https://developers.openai.com/api/docs/guides/agent-evals): 도구 선택과 최종 결과 평가를 분리하는 방법 참고. OpenAI 평가 서비스나 모델 API를 새로 도입한 것은 아니다. 기존 독립 native readback/저장 후 재열기 평가를 유지한다.

## 검증 경계

소스 검사는 실제 Pi 도구에서 등록 스킬 검색/활성화, 중첩 참고 자료의 원문 읽기, JS의 QuickJS 실제 계산, 긴 UTF-8 파일 페이지 연결, 바이너리 해시 보존, 변경/손상/취소 차단, 부분 로드 복구, 기존 Excel actor의 native action 왕복, React ZIP/폴더 버튼/취소/재진입/선택을 검사한다. native 파일 선택/ZIP 열기/DPAPI 저장은 테스트 대역으로 대체한 부분이며 실제 Windows 성공으로 집계하지 않는다.

native 및 설치 파일 빌드는 이번 수정 중 실행하지 않았다. 실제 Windows에서 ZIP/폴더 등록과 재실행, Excel/Word/PowerPoint 2016, Qwen의 적절한 스킬 선택과 문서 품질, NASCA는 검증 전이다. [Office 2016 수용 기준](OFFICE-2016-ACCEPTANCE-2026-09-23.md)에 따라 설치 환경에서 후속 검증한다.

최종 소스 검증: 배포 소스 체크아웃의 `npm test`에서 490개 통과, 실패/취소/건너뛰기 0개. 새 Windows native 컴파일, 설치 파일 빌드, 실모델 호출은 실행하지 않았다.

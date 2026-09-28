# Git 기반 프로젝트 지식과 누비 간 연계 조사

2026-09-23. 범위: Desktop에서 분석·수정·실행·비교하고, OpenWiki와 웹/Office 누비가 같은 프로젝트의 요구사항·근거를 활용하는 구조. **이번 반영은 설계·예제·CLI 검증이며 제품 통신 구현이나 런타임 의존성 추가가 아니다.**

## 권고

Theia 기반 IDE 후보에 **Git + OpenSpec 방식의 요구사항/변경 제안 + 기존 OpenWiki + 누비 호스트별 실행기**를 연결한다. 소스는 현재 구현, 명세는 합의한 동작, Wiki는 구현에 대한 설명과 근거다. 셋의 불일치를 숨기지 않고 변경 작업으로 연결한다. 하나의 변경 ID가 요구사항·코드 diff·Wiki diff·화면 검증·Office 결과를 묶는다.

새 도구를 모두 설치하기보다 기존 OpenWiki와 Git을 우선 재사용한다. OpenSpec은 변경 산출물 형식을 우선 적용하고 CLI adapter를 작은 단계로 검증한다. 앱 사용자가 CLI나 Git 문법을 알아야 하는 UI로 만들지 않는다.

## 현재 코드에서 확인한 재사용 지점

| 구현 | 실제 확인 | 아직 없는 통합 |
|---|---|---|
| OpenWiki `src/generation/repository-run.ts` | Claims preflight, source fingerprint, 엄격한 no-op, 페이지별 작업, 실행 중 소스 변경 감지 | Desktop의 문서 제안/병합 UI와 전체 변경 묶음 |
| `src/generation/run-state.ts` | `openwiki/.run.json`에 페이지 큐 저장·재개 | Office/웹 작업까지 복구하는 공통 실행 DB |
| `src/integrations/mcp/server.ts` | begin → plan → next page → submit page → finish, 호스트가 Markdown을 작성하고 Claims는 OpenWiki가 관리 | 누비 Pi 호스트 연결과 dirty editor buffer 계약 |
| `examples/openwiki-update.yml` | Git 전체 이력 checkout, 업데이트 PR, 실패 시 완료된 페이지 보존 | 회사 GHES runner/제공자 연결 확인과 제품 기본 정책 |
| 웹 누비 `project-tools.js`, `project-connection.js` | loopback pairing, Wiki/source 읽기, 경로·줄·해시 근거 | 수정/실행 권한이나 Office 작업 전달 |
| Office `worker/main.mjs` | 전용 worker, requestId 충돌 검사, runLookup, 취소, 현재 프로세스의 작업 상태 | Desktop 수신함, 프로세스 재시작을 넘는 작업 복구 |

OpenWiki는 로컬 `openwiki-sds` 0.6.0이며 upstream 고정 기준은 0.5.2 / `715109a8ab1cda6d47680fcc8170e203c751bf61`이다. 생성된 quickstart의 0.5.2 표시는 현재 배포 버전의 근거로 쓰지 않았다. 웹 읽기 API와 문서 생성 MCP는 권한과 용도가 다르다.

기존 CI 예제는 그대로 복사하지 않는다. upstream 패키지의 전역 설치, Linux runner, 예시 모델/추적 설정, AGENTS/CLAUDE/workflow까지 포함하는 경로를 사용한다. 누비에는 고정한 SDS 배포물, 실제 허용된 제공자, 명시적 문서 경로, 회사 runner를 사용하고 실패한 갱신을 성공으로 병합하지 않는 adapter가 필요하다.

## 방법론을 적용하는 위치

| 방법 | 누비에 적용할 동작 | 선택 이유 |
|---|---|---|
| Docs as Code | 소스와 문서의 Git diff·리뷰·버전·검사를 같은 작업에서 제공 | 문서 원본을 사용자가 소유하고 수정할 수 있음 |
| Spec-driven change | 요청을 proposal/spec/design/tasks로 남기고 AC를 실제 검증에 연결 | 대화 요약만으로 원래 요구가 사라지는 문제를 줄임 |
| ADR | 중요한 선택에 이유·대안·영향을 짧게 저장 | 자동 코드 설명에서 복원하기 어려운 사람의 의도 보존 |
| 점진적 재검증 | 바뀐 소스에 의존하는 Claim/문서를 먼저 갱신하고 누락 가능성은 별도 검사 | 모든 저장마다 전체 LLM 재생성을 피함 |
| 낙관적 동시성 + 3-way merge | 생성 기준/현재 사용자 편집/AI 제안을 비교, 충돌은 보존 | 마지막 저장으로 덮어쓰는 데이터 손실 방지 |
| 근거 기반 완료 | 정적 관계와 실제 실행 결과, 후보와 반영 상태를 구분 | 문서 생성이나 모델 선언을 기능 성공으로 오해하지 않음 |

[Write the Docs](https://www.writethedocs.org/guide/docs-as-code/)의 Git·리뷰·검사 방식과 [Backstage TechDocs](https://backstage.io/docs/features/techdocs/)의 코드 옆 Markdown/프로젝트별 문서 접근을 참고했다. Backstage 전체는 조직 포털이 필요한 단계의 후보로 두며 첫 Desktop에 추가하지 않는다.

## 오픈소스 비교와 반영 결정

아래 버전은 조사한 소스의 package 값이며 설치·출시 검증을 의미하지 않는다. 비용에는 모델 호출, 인덱스 저장, 배포/유지보수 비용이 별도로 남는다.

| 후보 | 라이선스와 확인한 소스 | 결정 |
|---|---|---|
| 기존 OpenWiki | MIT, 로컬 generation/Claims/MCP | **기존 구현 재사용 설계**. 새 RAG/위키 엔진을 중복 도입하지 않음 |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) | MIT, 1.13.1, schema.yaml와 spec parser | **변경 산출물 형식을 예제에 적용**. CLI는 pin 후 Windows/Qwen 연결 검증. beta Stores는 P0 제외 |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | MIT, 현재 README의 SDD/bug/assessment와 Python 3.11+/uv 요건 | 요구 분석·일관성 검토 참고. OpenSpec과 동시 표준화하지 않음. 이미 Spec Kit을 쓰는 프로젝트는 그 원본을 유지 |
| Git / Theia SCM | Git GPL-2.0, IDE 기반 선택은 별도 문서 | **기존 Git CLI와 SCM 재사용**. 자체 Git 엔진보다 현재 저장소/인증/워크트리 동작을 유지. 배포 시 Git 및 번들 의존성 고지 확인 |
| [Chokidar](https://github.com/paulmillr/chokidar) | MIT, 5.0.0, Node >=20.19 | **조건부**. Theia 파일 이벤트가 충분하면 미도입. standalone watcher가 필요한 경우만 사용 |
| [Milkdown](https://github.com/Milkdown/milkdown) | MIT, Crepe와 Markdown serializer 소스 | **편집 UX 후보**. 처음에는 IDE Markdown+preview. frontmatter/Claims 링크/Mermaid의 왕복 보존 검사 후 문서형 편집 추가 |
| 기존 MiniSearch / Ajv / YAML | 로컬 의존성 재사용 | 어휘 검색과 계약 검사. 처음부터 vector DB/graph DB/별도 schema framework를 추가하지 않음 |
| [A2A JS SDK](https://github.com/a2aproject/a2a-js) | Apache-2.0, 1.2.0, server/client/store 경계 | **상태·artifact 개념 참고**, 외부 Agent와 상호운용이 필요할 때 adapter 검증. 로컬 통합에 전체 서버를 먼저 추가하지 않음 |

[OpenSpec의 실제 schema](https://github.com/Fission-AI/OpenSpec/blob/f179ed4e40567cdb56501ee3f4d09efbcb1557b8/schemas/spec-driven/schema.yaml)는 동작 명세와 구현 설계를 구분하고 변경 종류별 delta를 유지한다. 이를 요구사항 UI의 저장 형식에 활용한다. 기존 저장소에 강제로 `openspec init`을 실행하거나 AGENTS/skills를 덮어쓰지 않는다. 자동 평가 통과를 보장하는 제품으로 해석하지 않는다.

[A2A 명세](https://a2a-protocol.org/latest/specification/#331-idempotency)에서도 메시지 전송의 멱등성은 선택 사항이다. SDK 채택만으로 Excel 쓰기나 브라우저 제출이 한 번만 실행된다고 보장할 수 없다. 누비 호스트의 operation ID·수신 영수증·실제 상태 재조회가 계속 필요하다. MCP는 도구/지식 제공, ACP는 IDE/Agent 연결, A2A는 독립 Agent 간 작업 전달에 대응한다.

실시간 공동 편집 요구가 없으므로 CRDT/Yjs를 첫 버전에 넣지 않는다. Git 병합은 텍스트 충돌을 찾는 수단이며 의미 일치 검증은 별도로 한다. NASCA Office 문서를 Git 텍스트 병합이나 Markdown 편집기로 변환하지 않는다.

## 추적 가능한 소스 기준

2026-09-23에 GitHub API의 HEAD·license와 raw 소스를 확인했다. 새 의존성 도입 시 안정 release artifact와 lockfile을 별도로 고정해야 한다.

| 저장소 | 조사 commit | 주요 파일 |
|---|---|---|
| Fission-AI/OpenSpec | `f179ed4e40567cdb56501ee3f4d09efbcb1557b8` | `schemas/spec-driven/schema.yaml`, `src/core/parsers/spec-structure.ts`, `LICENSE` |
| github/spec-kit | `3a96599d778f7cb138c78f33cbb221cca9a0690a` | `README.md`, 저장소 license metadata |
| Milkdown/milkdown | `920cded3fc9fe956de87339e30507650a916cf56` | `packages/crepe/src/core/crepe.ts`, `packages/core/src/internal-plugin/serializer.ts`, `LICENSE` |
| paulmillr/chokidar | `0bc7bed37d6b018e5b11afcce329bbf797d6441f` | `package.json`, `LICENSE` |
| a2aproject/a2a-js | `27659a2f5f762ab04a18919ebff0b01f8ba6e52c` | `package.json`, `src/server/store.ts`, `LICENSE` |
| langchain-ai/openwiki | `64164ce58f4fe15773f92b551ec055a68f28babc` | upstream HEAD/metadata 확인만. 로컬 코드를 이 버전으로 교체하지 않음 |

## 이번 적용과 다음 검증

[프로젝트 지식·작업 전달 명세](../superpowers/specs/2026-09-23-nubi-project-hub.md)에 Git 저장 경계, 사용자 편집 보존, 갱신 상태, 세 호스트의 책임을 반영했다. [설계 예제](../design/nubi-project-hub/README.md)는 OpenSpec 형태의 변경 문서, 전달 schema, 합성 전달 요청을 포함한다. 실제 수정/연결/자동 스케줄/PR 생성은 하지 않았다.

검증 우선순위는 사람 편집 보존 → Wiki drift/no-op → 프로젝트 범위와 재전달 → 실제 Windows 웹/Office 실행이다. Qwen 품질, GHES/회사 인증, 설치형 Desktop은 별도 실환경 검증 대상으로 남긴다.

실제 소규모 검증: npm registry의 고정 OpenSpec 1.13.1을 `npm exec`로 실행해 예제 change의 strict validation을 통과했다. telemetry를 끄고 `init`/skill 설치/자동화는 실행하지 않았다. Git `merge-file -p`는 독립 수정 병합·겹친 수정 충돌·무변경 보존 3개 fixture를 통과했고 원본 입력 파일을 변경하지 않았다. 기존 Ajv 8.20.0으로 요청 schema의 정상 2개/거부 8개를 검사했다. [전체 기록](../design/nubi-project-hub/verification.json). 이는 macOS의 형식·텍스트 병합 검사이며 의미 정확도와 실제 Windows 전달 성능은 미측정이다. [Git 공식 동작](https://git-scm.com/docs/git-merge-file)을 기준으로 결과를 해석했다.

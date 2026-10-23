# OpenCode 원본 코딩 실행기 도입과 검증

2026-10-23. 사용자는 기존 Pi를 고정하지 말고 OpenCode와 Desktop을 직접 내려받아 분석하고 좋은 코드를 실제 반영하도록 요청했다. 프로젝트 코딩의 주 실행기를 **공식 OpenCode 1.19.4 원본 실행 파일**로 바꿨다. 이름이나 모델 연결만 바꾼 것이 아니다. 원본 세션 processor, 모델/도구 반복, MCP 클라이언트와 자동 압축을 실행한다. 누비의 모델 인증, 파일 관찰, 변경 제안, 승인, 명령 영수증과 독립 검토는 기존 호스트로 연결했다.

이 도입은 OpenCode, Claude Code, Codex의 모든 기능이나 모든 업무의 품질이 같다는 증명이 아니다. 현재 구현과 검증 범위를 아래에 나눈다. 이전 [반영 범위 감사](2026-10-23-opencode-inheritance-audit.md)는 변경 전 후보의 기록이며 현재 경로 설명으로 사용하지 않는다.

## 원본과 적용 근거

| 항목 | 확인한 내용 |
|---|---|
| 공식 기준 | [OpenCode v1.19.4](https://github.com/anomalyco/opencode/releases/tag/v1.19.4), commit `148842ef7cb1bc34192b3fff57d0f9721ab9c801` |
| 소스 | 전체 checkout `/tmp/nubi-opencode-analysis-2026-10-23/upstream`. session/processor, prompt, llm, compaction, edit, MCP와 Desktop server/sidecar를 분석 |
| CLI 내려받기 | 공식 macOS arm64 archive SHA-256 `c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689`. 추출 실행 파일은 `417af53923f3d529759ab85ce3e8dd09116f742efcd332de591d2da6ebae696b` |
| Desktop 내려받기 | 공식 macOS arm64 archive SHA-256 `641e00f7d6f86dc9b70f9487415fb24bdb28507499536bdd3addd0a131d03661`. ASAR의 `@opencode-ai/desktop` 1.19.4, main/sidecar와 7,410개 항목을 확인. 원본 Desktop GUI를 실행한 비교는 아님 |
| 라이선스 | MIT 원문, matcher가 인용한 Cline/Gemini 원문과 출처/변환 기록을 보존. Desktop UI를 복제하거나 재배포하지 않음 |
| Codex 참고 | 공식 [agent loop 설명](https://openai.com/index/unrolling-the-codex-agent-loop/)의 역할이 있는 대화, 도구 결과, 문맥 압축과 실행기 책임을 대조 |
| Claude Code 참고 | 공식 [best practices](https://code.claude.com/docs/en/best-practices)의 탐색, 검증 가능한 완료 조건, 실제 검사와 문맥 관리 방식을 대조 |

다운로드와 Desktop 식별 근거: [upstream.json](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/upstream.json). Windows x64도 공식 archive를 직접 내려받아 digest, 압축 해제와 PE AMD64 형식을 확인했다. 실행 파일 SHA-256은 `41c848c0986720c02d39b015bd2672e454a221052f6947854bc508d8765d9711`이다. [Windows 정적 확인](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/windows-artifact.json). 실제 엔진 실행은 macOS arm64에서만 확인했다. 다른 고정 플랫폼 digest를 다운로드/실행 확인으로 확대하지 않는다.

Linux x64의 별도 tar 경로도 공식 archive digest와 압축 해제, ELF x86-64 형식을 확인했다. [Linux 정적 확인](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/linux-artifact.json). macOS에서 한 정적 확인이며 Linux 실행/CI 통과가 아니다. macOS x64는 공식 archive digest 고정까지만 확인했다.

## 실제 반영표

| 품질 요소 | 현재 구현과 차이 |
|---|---|
| 주 코딩 루프 | `runWorkspaceAgent`가 프로젝트 코딩을 `runOpenCodeAgent`로 보낸다. 공식 실행 파일의 `run --pure --format json`을 사용한다. 엔진이 없거나 해시가 다르면 명시적으로 실패하며 Pi로 조용히 바꾸지 않는다 |
| 모델과 도구 | 현재 선택한 호스트 모델을 일회용 인증값이 있는 loopback provider로 연결한다. MCP에는 이번 실행에서 허용된 호스트 도구만 제공한다. 원본의 임의 shell/쓰기 도구로 기존 승인 경계를 우회하지 않는다 |
| 대화와 문맥 | 과거 대화를 실제 system/user/assistant/tool 역할로 모델에 전달한다. 원본 자동 압축과 호스트 요약 port를 연결하고 압축 후에도 원래 요청, 최신 요청, 정책을 보존한다. 원본 압축도 기존 관찰 무효화에 연결해 사라진 읽기를 수정 근거로 인정하지 않고 남아 있는 원문만 다시 인정한다. 과거 도구 결과는 system 지침으로 승격하지 않는다 |
| 검색과 소스 이해 | 기존 ripgrep, 현재 hash가 있는 소스 읽기, outline과 제한된 TypeScript 의미 조회를 연결한다. 전체 프로젝트 LSP 서버를 그대로 이식한 것은 아니다 |
| 편집 | [원본 edit matcher](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/edit.ts)의 pure 함수 코드를 출처와 함께 가져왔다. exact 외에 유일한 줄 끝/공통 들여쓰기 차이만 허용한다. 의미상 비슷한 블록 추측과 인용문 내부 공백 정규화는 사용하지 않는다 |
| 원본 보존 | 현재 관찰 범위와 해시, 중복/겹침 거부, 승인 전 무변경을 유지한다. 모델이 만든 전체 파일의 BOM/CRLF를 기본 보존하고 반영 후 독립적으로 다시 읽는다 |
| 오류 수정과 완료 | 실제 파서 오류를 모델에 반환해 제안을 고치고, 프로젝트 테스트/타입 검사/명령 출력과 기존 결과 검토를 연결한다. 문법 통과를 기능 완료로 취급하지 않는다 |
| 병렬성과 승인 | 독립 읽기는 최대 두 개, 계획/도구 선택은 실행보다 먼저 완료한다. 질문은 같은 묶음의 추측 동작보다 우선한다. 미확정 실행은 재전송하지 않는다. 모델이 다음 응답에서 호출 ID를 재사용해도 이전 실행 결과가 새 요청을 대신하지 않는다 |
| 새 입력과 중지 | 모델 응답 뒤와 실제 도구 발행 전에 새 입력을 확인한다. 취소하면 원본 프로세스를 종료한다. 영수증이 있는 완료 동작을 전체 재실행으로 복구하지 않는다 |
| 위키/문서/브라우저 | 기존 위키/문서 위임 계약과 근거 바인딩을 재사용한다. 브라우저 PNG는 지원 모델에 이미지 part로 전달한다. 명시한 비코딩 업무는 기존 경로를 유지한다 |
| Desktop | 원본 Desktop의 렌더러/실행 프로세스 분리 구조를 대조하고 기존 누비 IPC/worker와 실시간 공개 진행을 연결했다. 기존 누비 디자인을 유지한다 |
| 빌드 | 공식 archive 크기/해시와 플랫폼을 확인하고 실행 파일/manifest/license를 묶는다. ASAR 밖의 실제 실행 경로를 사용한다. 사용자에게 확장 설치나 엔진 설치 절차를 추가하지 않는다 |
| 아직 다른 기능 | 원본의 일반 Task 하위 에이전트, 전체 프로젝트 LSP, snapshot undo와 Desktop UI 전체를 복제하지 않았다. 누비의 기존 독립 분석/프로세스/승인/보존 계약을 사용한다. 이 차이를 원본 기능 전체 도입으로 표시하지 않는다 |

주 구현: [실행기](../../packages/nubi-desktop/runtime/opencode-coding-engine.mjs), [라우팅](../../packages/nubi-desktop/runtime/coding-engine-routing.mjs), [관찰된 편집](../../packages/nubi-desktop/runtime/source-edits.mjs), [고정 다운로드](../../packages/nubi-desktop/scripts/prepare-opencode-engine.mjs), [라이선스/출처](../../packages/nubi-desktop/runtime/vendor/opencode/provenance.json).

## 같은 실제 모델 비교

현재 호스트에 연결된 Claude Code CLI의 `claude-sonnet-5-5`를 양쪽의 동일한 모델 port로 사용했다. 세 개의 새 임시 저장소와 같은 요청/호스트 승인 정책을 적용했다. JS는 0 수량/검증/세금 보존, Python은 입력 보존/헤더 정규화, TS는 반환형/호출자/누락 값과 CRLF 보존을 요구했다. 독립 oracle, 저장소 테스트, 해당 과제의 실제 타입 검사, 비대상 파일 보존과 호스트 검증을 따로 채점했다. 허용한 변경과 명령에 대한 사용자 승인은 시험 도구가 대신했다.

| 과제 | Pi 호출/시간 | 원본 OpenCode 호출/시간 | 결과 |
|---|---:|---:|---|
| JS 수량 경계 | 11 / 84.182초 | 12 / 93.538초 | 양쪽 결과 코드와 검사 통과 |
| Python 헤더 계약 | 16 / 120.735초 | 14 / 112.217초 | 양쪽 결과 코드와 검사 통과. Pi의 첫 unittest 명령 실패와 수정 이력 유지 |
| TS 호출자와 CRLF | 17 / 118.344초 | 16 / 128.631초 | 양쪽 결과 코드와 검사 통과. Pi는 추가 shell 확인이 시험 승인 범위를 벗어나 사용자 인계. OpenCode는 인계 없이 종료 |

결과 코드 검사는 **양쪽 3/3**, 승인 인계 없이 끝난 흐름은 **OpenCode 3/3, Pi 2/3와 사용자 인계 1건**이다. Pi의 추가 확인은 잘못된 코드라는 뜻이 아니며, 거부된 명령을 임의로 허용해 완료로 바꾸지 않았다. 표본이 작고 한 번씩 실행해 우월성이나 속도 개선을 입증하지 않는다. 공개 코딩 벤치마크 점수와도 다르다.

처음 Python/TS oracle의 문자열 escape 오류로 평가 프로그램이 실패했다. 원래 보고서를 보존하고 저장된 정확한 patch를 같은 입력 파일에 적용해 독립 검사만 다시 채점했다. 모델을 다시 실행한 결과처럼 표시하지 않았다. [원래 결과](../../packages/nubi-desktop/verification/opencode-coding-comparison-2026-10-23/results.json), [정정 채점](../../packages/nubi-desktop/verification/opencode-coding-comparison-2026-10-23/results-regraded.json), [재채점 도구](../../packages/nubi-desktop/eval/regrade-opencode-comparison.mjs).

후속 원본 엔진 실모델 실행은 JS **10호출/92.844초**, Python **12호출/96.945초**, TS **16호출/143.701초**로 각각 독립 검사와 실제 명령 검사를 통과했다. TS 후속 최초 시도는 평가 도구가 아직 없는 background promise를 반복 await해 이벤트 루프를 막았다. 해당 시도의 파일/patch/중단 원인을 보존하고 기존 `settleCommand`를 재사용해 수정한 뒤 별도로 재실행했다. 중단한 시도는 통과에 넣지 않았다. [JS/Python 후속](../../packages/nubi-desktop/verification/opencode-coding-comparison-current-2026-10-23/results.json), [중단 기록](../../packages/nubi-desktop/verification/opencode-coding-comparison-current-2026-10-23/interrupted-typescript/interruption.json), [TS 재실행](../../packages/nubi-desktop/verification/opencode-coding-comparison-current-typescript-2026-10-23/results.json).

마지막 별도 실모델 profile도 같은 세 과제에서 **JS 13호출/115.340초, Python 15호출/133.999초, TS 15호출/122.626초**로 모두 통과했다. [마지막 profile 결과](../../packages/nubi-desktop/verification/opencode-coding-comparison-final-2026-10-23/results.json). 이 프로세스가 읽은 [후보 해시](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/final-profile-model-candidate.json)는 원본 압축 후 호스트 관찰 무효화와 잘못된 인증 헤더 처리의 마지막 보완 전이다. 그 보완은 원본 프로세스 계약/호스트 검사와 마지막 빌드/앱 검사로 별도 확인하며 앞선 모델 실행에 소급하지 않는다.

위 비교는 **Pi 대 원본 OpenCode 루프** 비교다. Claude Code CLI는 양쪽의 모델 연결로 사용했으며 Claude Code 자체의 전체 에이전트와 경쟁한 시험이 아니다. Codex CLI 전체 에이전트 비교도 실행하지 않았다. 초기 비교와 후속 실행 사이 소스 변경도 [후보 해시](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/current-model-candidate.json)로 구분한다. 압축/신규 MCP 스키마/외부 스킬 격리 보완을 앞선 모든 실모델 실행에 소급 적용해 통과한 것으로 표시하지 않는다.

## 회귀와 실제 앱 확인

| 구분 | 결과와 범위 |
|---|---|
| 엔진과 호스트 집중 회귀 | 마지막 실행 **52 통과/0 실패**. 원본 프로세스의 모델/도구 왕복, 실패 수정, 질문, 입력 변경, 취소, 메타데이터 순서, 호출 ID 재사용, 미확정 재실행 방지, 이미지, 위키, 원본 자동 압축과 역할/환경/배열/새 JSON Schema draft를 확인. 기존 호스트의 문맥/위키/도구 크기 검사와 잘못된 인증 헤더 거부도 포함. 52개 전부가 원본 프로세스 시험인 것은 아님 |
| 전체 단위 회귀 | 마지막 실행 **2,664개 중 2,463 통과/0 실패/201 건너뜀**, 종료 코드 0. 기능 플래그와 OS 조건을 포함한 건너뜀을 통과에 넣지 않는다. [전체 로그](../../packages/nubi-desktop/verification/opencode-adoption-final-regression-2026-10-23.log) |
| 첫 전체 회귀 | 2,656개 중 2,448 통과/7 실패/201 건너뜀. stale footer mock, Pi 고정 압축 프로필, 기존 build 명령을 보존한 additive pretest 검사, 도구 schema 6,000 token 한도를 수정하고 관련 집중 검사를 통과. 첫 실패 로그는 보존 |
| 중간 회귀와 재검사 | 다음 전체 실행은 2,661개 중 2,459 통과/1 실패/201 건너뜀. 줄인 위키 도구 설명에서 synthesis/how-why 기준이 빠진 것을 복원하고 관련 15개가 통과했다. 원본 압축/호스트 연결의 추가 red 검사를 만들던 실행은 중단하고 소스를 고정한 뒤 전체 회귀를 다시 시작했다. 중간 실패/중단 로그도 보존 |
| 실제 빌드 | `npm run build:electron` 종료 코드 0. 기존 Windows bash helper의 CJS/import.meta 경고는 남음 |
| 기존 Python 라우터 | 현재 소스 경로를 명시한 `python3 -m pytest -q` **239 통과/0 실패**. Desktop 실행기를 Python 게이트웨이와 혼동하지 않으며 실제 제공자/Windows 품질 시험은 아님 |
| 실제 Electron | 빌드된 렌더러 → IPC → worker → 묶은 원본 실행기 → 인증된 모델 fixture/MCP → 소스 읽기/계획/제안 → 실제 반영 버튼 → CRLF 파일 쓰기와 폼 제거를 통과. 1,280px/440px 화면과 입력 반응 확인. 실제 모델 GUI 시험과 Windows 증명은 아님 |
| 기존 안전 계약 | 관련 46개 검사 통과. 이어지는 Git HEAD delta 검사에서는 `safety_manifest_invalid`로 명령 전체 실패. 현재 작업 폴더의 manifest는 유효하지만 해당 파일과 Desktop 소스가 Git HEAD에 없어 이 명령의 후보에 들어가지 않는다. Git index를 바꾸거나 이 실패를 성공으로 치환하지 않음 |
| 현재 소스 직접 검사 | 현재 작업 파일의 명시한 도입 범위 39개를 기존 안전 scanner로 직접 읽어 0건. 이 범위의 `.mjs` 24개 문법과 공백 검사도 통과. [소스 직접 검사](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/source-safety.json). Git HEAD 검사나 전체 저장소/설치판 검사 대신으로 표시하지 않음 |

52개 집중 회귀와 안전 계약 46개는 전체 단위 회귀와 겹치므로 합산하지 않는다. 현재 도입 파일의 해시와 범위는 [최종 파일 원장](../../packages/nubi-desktop/verification/opencode-coding-adoption-2026-10-23/final-candidate.json)에 남겼다. 이 원장은 기존 내용이 있는 파일 전체의 변경을 이번 작업의 저작으로 주장하지 않는다.

실제 앱 연결 중 사용하지 않는 MCP 도구의 draft-2020 스키마 때문에 eager AJV compile이 실행기 시작을 막는 문제를 발견했다. 기존 호스트 Typebox 검사기를 재사용하도록 고쳤고 실제 앱 흐름을 다시 통과했다. 원본 압축 후 literal 요청 누락, JSON 배열 shape 변경, 미확정 결과 뒤 재선택, 호출 ID 재사용과 인용문 공백 매칭 문제도 먼저 실패를 확인하고 수정했다. 원본 자동 압축은 호스트의 관찰 초기화 callback에도 연결해, 요약으로 사라진 소스로 변경 계획을 기록하면 `source_read_required`로 막는 것을 확인했다. UTF-8 byte 길이가 다른 잘못된 인증 헤더도 예외를 던지지 않고 거부한다.

화면과 결과: [Electron report](../../packages/nubi-desktop/verification/opencode-coding-shell-2026-10-23/report.json), [넓은 승인 화면](../../packages/nubi-desktop/verification/opencode-coding-shell-2026-10-23/proposal-1280.png), [좁은 승인 화면](../../packages/nubi-desktop/verification/opencode-coding-shell-2026-10-23/proposal-440.png), [반영 후](../../packages/nubi-desktop/verification/opencode-coding-shell-2026-10-23/applied-440.png).

## 검증의 한계

이번 변경은 현재 소스와 로컬 빌드에 반영했다. Windows 설치/업데이트/재실행, 사용자 삼성브라우저/사내 SSO, 실제 Office/NASCA 성공으로 표시하지 않는다. Windows release는 기존 Windows 빌드 호스트에서 해당 플랫폼 엔진을 준비하고 설치판을 별도로 확인해야 한다. 현재 Git HEAD delta 안전 검사는 통과 상태가 아니므로 배포 완료나 release-ready로 보고하지 않는다.

원본 실행 파일을 묶는 비용도 있다. 이번 macOS 실행 파일은 약 172 MiB, Windows 실행 파일은 211,699,592 byte다. Windows 공식 압축 archive는 81,744,896 byte이며 실제 누비 설치판의 증가량/설치 시간은 측정하지 않았다. 실행기를 사용자가 별도로 설치하게 하는 흐름은 추가하지 않았다.

동일 엔진을 사용해도 모델, 프롬프트, 도구, 승인 정책과 프로젝트 환경이 달라 결과 품질은 달라진다. 장기 대규모 저장소, 여러 모델, 프로젝트 LSP와 native Task 기능을 포함한 공식 비교는 추가 근거가 필요하다. 현재의 확실한 결과는 원본 엔진을 실제 제품 경로로 연결했고 좁은 실제 코딩 과제와 명시한 회귀/앱 흐름에서 검증했다는 것이다.

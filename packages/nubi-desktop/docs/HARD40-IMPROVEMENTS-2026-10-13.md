# 고난도 40문항 평가와 개선 기록

## 이번 후보에 먼저 반영한 개선

이전 hard-10 실제 평가에서 확인한 문제를 수정한 후, 사용자 요청에 따라 영역별 hard-40으로 평가를 확장했다. 따라서 hard-10의 7/10과 hard-40 결과를 직접적인 개선율로 비교하지 않는다.

1. **승인 이후 실행 조건 유지:** 성공 명령의 계획을 이어받으면 이전 run ID 조건 때문에 `previousIntent.constraints`가 호스트 문맥에서 빠지던 경로를 수정했다. 명령별 승인과 순서 조건을 계획에 남기고, 요청한 개별 명령을 임의로 합치지 않도록 지침을 보강했다. 복합 shell 명령 자체를 일반 금지하거나 사용자 승인 범위를 확대하지 않았다.
2. **스킬 지침 재사용:** 같은 작업/명령/계획 바인딩의 성공한 명령 뒤에만 완독한 짧은 main 지침을 연결한다. 메모리 전용이며 현재 스킬 경로/해시를 다시 검사하고 본문을 호스트 문맥에 제공한다. 모델의 중복 `use_skill` 호출은 줄일 수 있지만 파일 자체의 재검증은 유지한다. 긴 페이지형 스킬, 변경된 파일, 다른 요청/프로젝트/규칙/모델 해석 범위, 취소/실패/미확정 실행, 앱 재시작과 압축 뒤에는 재사용하지 않는다. 소스 편집 관찰과 명령 승인은 복원하지 않는다.
3. **실행 준비 오류의 정확한 복구:** `source_read_required`와 `source_stale`에 문제 상대 경로 및 `not_read_in_this_run` / `hash_mismatch` / `file_changed` 이유를 넣었다. 실행 준비에서 편집할 줄을 읽으라는 부정확한 안내를 제거했다. 오류 전 명령 실행이나 승인 카드 생성은 없다.
4. **결론에 영향을 준 정정 근거:** 입력 값/정정 자료와 계산에 적용한 정책의 출처를 함께 연결하도록 지침을 보강했다. 단순히 읽은 자료를 전부 인용하도록 강제하지 않는다. 실제 모델에서 근거가 개선됐는지는 별도로 판정한다.

## 평가 계약

- `eval/hard-40/CASEBOOK.md`: Bash, 메일, 스킬, OpenWiki 각 10문항.
- 10개 복합 업무군의 경로별 대응 과제이며 40개의 독립 업무군이 아니다. 외부 벤치마크 난이도 또는 일반 제품의 100점 품질 점수로 표시하지 않는다.
- 최초 영역별 회차는 `verification/eval-live/hard40-v1-trial1-20261013/`. 후보와 문제, 채점기 해시를 고정한다.
- 완료/정답/출처/실행/개인정보/보존을 분리하고 자동 채점의 표현 오탐을 별도로 감사한다. 감사자는 이 작업의 Codex이며 외부 사람 평가로 표시하지 않는다.
- 결과를 보고 제품 후보를 수정하면 새 디렉터리에서 측정한다. 실패 문항만 재검사한 결과를 전체 40개 개선 성적으로 표시하지 않는다.

## 방법론과 도입 범위

기존 Pi, Ajv, 로컬 원문 조회와 승인 계약을 유지했다. [Anthropic의 평가 가이드](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)를 2026-10-13 다시 확인하여 고정 과제, 실제 결과와 실행 기록, 결정적 검사 및 원문 대조 감사를 결합했다. 새 에이전트 프레임워크 도입은 검증 비용 대비 필요가 없어 하지 않았다. 도구 호출 감소만으로 정답/권한/원본 검증을 생략하지 않는다.

검사 결과와 실제 모델 성적은 최종 평가 보고서에 기록한다. Windows/실회사 계정/메일/설치판 검증은 이 Mac 합성 입력 평가와 별도다.

## hard-40 기준선 이후 후보 2

- 공통 모델 전송 경로가 주 에이전트와 위임 호출 모두에 한 응답당 최대 8개 도구 호출을 알린다. 실제 ChatGPT 어댑터를 합성 SSE로 검사하여 8개 허용/9개 거절을 재현했다. 거절된 응답은 도구가 실행되기 전임을 알리고 더 작은 유효 응답으로 수정 요청한다. 성공하거나 미확정인 실행은 반복하지 않으며 기존 재시도 상한을 늘리지 않았다. 위키 생성의 기존 제한 안내는 중복하지 않는다.
- 성공한 명령을 같은 바인딩으로 이어갈 때 작은 승인 참조 파일을 현재 디스크에서 다시 읽고 해시를 검사한다. 최대 10개, 파일당 8,000자, 총 16,000자다. 변경/누락/비공개/큰 파일은 제외한다. `environment`의 setup 참조로만 기록하고 `SourceObservations.files`에는 넣지 않는다. 다음 명령은 새 승인을 받으며 제안/승인 시 파일 변경 검사도 유지한다.
- 반복되는 설명 지침을 줄이고 결과, 열 수가 적은 표, 중요한 불확실성과 다음 행동 순서로 정리한다. 빈칸이 많은 표, 표 아래의 결론 반복, 통상적인 실행 내역 나열을 줄이도록 했다. 요구사항이나 승인 범위는 생략하지 않는다.
- 중복 지침을 줄이면서 작은 컨텍스트에서 불필요한 압축이 발생하던 회귀도 해결했다. 한도나 검사를 완화하지 않았다.

집중 검사 16건 통과: 주/위임 호출 복구, 현재 파일 재검증, 편집 관찰 미부여, 변경/누락/큰 파일/취소 제외, 두 개별 승인 명령의 연속 실행, 기존 압축 회귀. 전체 검사에서 새 system 메시지가 구조화된 계획 payload의 위치를 바꾸는 회귀를 발견해, 기존 system 본문에 안내를 붙이도록 수정했다. 메시지 위치와 원본 입력 불변 검사를 추가했다. 영향 경로 31건 재통과 후 최종 전체 검사 **1,015건 중 817 통과, 0 실패, 198 건너뜀**. 비활성 A2A/앱 조작 검사는 통과로 세지 않았다. Electron 빌드와 최종 빌드의 실제 Electron 승인/실행/복구/HITL 검사 10건도 통과했다. 실모델 재측정은 진행 중이다.

## Release candidate source integrity

The completed second candidate delivered 40/40 and passed source audit on 33/40 (raw automatic 32/40). Candidate wiki-06 invented a citation identity, while the previous finalizer only marked it unresolved. The release candidate routes this defect through the existing bounded review before delivery. The reviewer receives the actual observed citation registry, and asks for missing decisive inputs and rules together. Failed repair remains an unresolved review, never successful evidence. The UI warning remains as the final boundary.

Completed process receipts now include real start/finish timestamps. Revalidated command prerequisites and skill instructions reach the review as well as the actor; neither grants new execution or editing authority. These changes address false requests to repeat known reads or to prove command order with absent timestamps. No new framework or dependency was added.

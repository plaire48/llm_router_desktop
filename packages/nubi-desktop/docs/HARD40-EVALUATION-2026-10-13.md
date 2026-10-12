# 고난도 40문항 실모델 평가

상태: 기준선 40문항 완료, 개선판 재측정 준비.

## 기준선 결과

| 영역 | 자동 통과 | 원문 대조 후 엄격 통과 | 응답 전달 |
|---|---:|---:|---:|
| Bash | 8/10 | 9/10 | 10/10 |
| 메일 | 0/10 | 0/10 | 1/10 |
| 스킬 | 9/10 | 10/10 | 10/10 |
| OpenWiki | 1/10 | 1/10 | 1/10 |
| 합계 | 18/40 | 20/40 | 22/40 |

메시지 전달만으로 성공을 인정하지 않았다. 메일 1건은 정답이지만 중요한 원장 출처가 빠져 실패했다. 자동 채점 오탐 3건을 감사 통과로, 자동 통과한 SLA 근거 오류 1건을 감사 실패로 분리했다. 상세 근거는 아래와 원시 폴더의 `source-audit.json`에 있다.

전체 주 모델 호출 515회, 위임 호출 64회. `response_invalid` 92회, setup의 `source_read_required` 51회가 기록됐다. 실제 성공 명령의 중복 실행은 없었다. 실패 응답을 짧은 시간에 중단한 것을 빠른 성공으로 해석하지 않는다.

고정 후보: `bd62969ceea728fa86f5fd89578871b56d1818d9bde618f9a6bb67d9694ad3c4`, 474파일. 평가 중 후보 변경 없음. 고정 문제/실행기/채점기: `525fc2fc149a670b7c2cea221c3b524b66c7727bdd665ef026b83d7a9dd49162`.

## 평가 범위

Bash, 메일, 스킬, OpenWiki 각 10문항. 10개의 복합 업무 시나리오를 네 경로에서 풀게 하는 대응 평가다. 총 40문항이지만 독립 업무 시나리오는 10개이며 외부 난이도 인증이나 일반 제품 품질 점수가 아니다.

실제 연결된 GPT-5.6 Sol, medium, 카탈로그 컨텍스트 272,000으로 실행했다. macOS, 합성 업무 자료, 회차당 문항별 1회, 동시성 3이다. 실제 제품 Agent와 Bash 및 메일/위키/스킬 경로를 사용한다. 실회사 POP3/SSO, Windows 설치판 성공으로 해석하지 않는다.

업무 규칙과 다단계 흐름은 복잡하지만 코퍼스 규모는 작다. 스킬 선택 후보는 관련 스킬 2개와 폐기/무관 스킬 2개이며, 메일/위키 핵심 자료는 각 9개다. 대규모 스킬 카탈로그, 수만 건의 메일, 대형 저장소 검색 정확도를 입증하는 시험은 아니다. 문제 생성과 제품 수정, 원문 감사는 이 Codex 작업이 수행했으므로 외부 블라인드 감사나 반복 신뢰도 측정으로 해석하지 않는다.

## 원문 대조 감사

자동 판정과 별도로 Codex가 정답 원장 및 최종 답변을 대조한다. 외부 사람의 평가나 별도 모델 심사로 표시하지 않는다. 자동 점수는 사후 수정하지 않고 오탐과 추가 결함을 별도로 남긴다.

- 기준선 bash-01~04, bash-06, skill-01~06: 요청된 주요 계산과 판정은 원장과 일치한다.
- 기준선 mail-01: 주요 판정은 맞지만 후보 SHA와 prod 환경을 제공한 원장 출처가 빠졌다. 다른 인용에 이 원장을 대신할 완전한 후보/환경 정보는 없다. 출처 실패 판정을 유지한다.
- 기준선 bash-04: 최종 P1 판정은 맞지만 근거에서 `비계획 장애 13분 초과`라고 썼다. 정책은 **10분 초과**이고 실제 장애는 **13분**이다. 수치와 임계값을 혼동한 부정확한 근거이며 자동 검사에 잡히지 않았다. 핵심 근거의 정확성도 요구했으므로 엄격한 감사 판정에서는 실패로 분리한다.
- 완료된 답변 일부가 결론을 표 아래에서 반복하고, 요청하지 않은 CLI 조회 내역을 길게 덧붙인다. 숫자는 맞더라도 가독성은 개선이 필요하다.
- 기준선 bash-05: 실행 기록에는 각 명령의 결과 이후 다음 제안이 있으나, 최종 답변은 이 순서를 입증하지 못한다고 덧붙인다. 내부 작업 전환에서 이전 관찰의 맥락이 흐려지는 문제다. 불필요한 보수 표현도 품질 결함으로 남긴다.
- 기준선 bash-08: 자동 검사 `bound_rows`는 G-B의 **40.0점**을 정답 **40점**과 다르게 처리했다. 실제 답변은 공개 여부, 유효 표본수, 평균과 비공개 정보 보호 모두 맞았다. 이는 채점기의 표현 오탐으로, 감사 결과에서만 통과로 분리하고 고정 자동 점수는 유지한다.
- 기준선 skill-09와 bash-09: `업무 정상성 미확정`과 `업무 거래 검사 not_run`을 정확히 표시했으나, 정답 표현 목록에 `미확정`이 없어 행 검사가 실패했다. B1→I1, 13:55, RPO 17분, 목표 미충족, 실제 복원 미실행은 모두 맞다. 감사 통과로 분리한다.

## 확인된 개선 대상

1. 여러 자료를 읽는 도구 응답이 거절된 뒤 같은 요청을 반복한다. ChatGPT 어댑터는 한 응답의 8개 호출을 허용하고 9개를 거절한다. 실제 거절 기록은 원인을 세분화하지 않으므로 모든 `response_invalid`를 9개 호출 때문이라고 단정하지 않는다. 공통 전송 경로의 제한 안내와 형식 복구 부족은 재현 검사로 확인했다.
2. 성공한 명령 뒤 새 실행에서 파일 관찰이 초기화되어, 이전 해시를 인용한 다음 명령이 거절되고 재읽기한다. 승인 대상이 된 작은 파일을 현재 디스크에서 재검증하여 setup 참조에만 사용하고, 편집 권한은 부여하지 않는 개선을 준비했다.
3. 주요 결론, 표, 미확정 사항 순서로 응답을 줄인다. 검토 완료 상태를 결과 성공으로 간주하지 않으며 실제 원문과 계산을 확인한다.

문제: [CASEBOOK](../eval/hard-40/CASEBOOK.md). 독립 정답: [ORACLE](../eval/hard-40/ORACLE.md). 방법과 한계: [평가 계약](../eval/hard-40/README.md).

## 개선판에서 추가로 확인 중인 한계

- 메일/위키에서 답변까지 도달하더라도 결정에 사용한 입력·정책의 인용이 일부 빠진다. 모든 읽은 파일을 나열하는 방식으로 해결하지 않고 주장과 결정적 근거 사이를 검사해야 한다.
- 위키 답변이 원본 읽기까지 수행하면서도 위임 검색을 반복하는 사례가 있다. wiki-02는 위임 모델 34회, search_wiki 16회, read_wiki 12회였다. 위임 횟수 증가를 품질 향상으로 간주하지 않는다.
- 최종 검토가 완료 시각이 생략된 프로세스 영수증을 보고 실행 순서를 미검증으로 판단한 사례가 있다. 실제 호출 기록에는 이전 명령 결과 이후 다음 제안이 확인되는데도 불필요한 수정과 설명을 유발한다. 검토 자료의 관찰 순서와 실제 시각 보존이 필요하다.
- 간결한 작성 지침만으로 출력이 일관되게 정리되지 않는다. wiki-04는 정답/출처는 맞지만 빈칸이 많은 7열 표와 불필요한 누락 목록이 남는다. 가독성 개선은 완료로 표시하지 않는다.

## Completed matched comparison

Both candidates completed all 40 tasks with the same frozen benchmark `525fc2fc149a670b7c2cea221c3b524b66c7727bdd665ef026b83d7a9dd49162`, ChatGPT GPT-5.6 Sol medium and catalog context 272000. Both candidate hashes remained unchanged during their run. One trial per task, synthetic business fixtures on macOS.

| Channel | Baseline delivered | Candidate delivered | Baseline source-audited pass | Candidate source-audited pass |
|---|---:|---:|---:|---:|
| Bash | 10 | 10 | 9 | 10 |
| Mail | 1 | 10 | 0 | 7 |
| Skill | 10 | 10 | 10 | 10 |
| OpenWiki | 1 | 10 | 1 | 6 |
| Total | 22/40 | 40/40 | 20/40 | 33/40 |

Raw deterministic passes were 18/40 and 32/40. Source audit separately corrects accepted synonym/number-format gaps and rejects the baseline Bash SLA threshold misstatement. Candidate wiki-09 says business health is "확인되지 않음" and `not_run`, a valid answer missing from the frozen grader's row synonyms. Raw outcomes are retained. Candidate wiki-07 regressed from pass to missing policy citation and unjustified qualification. No claim of perfect quality or repeat reliability follows.

Bash median elapsed time decreased from 227.5 to 132.5 seconds and product calls from 289 to 158. Overall elapsed medians are not a speed comparison because the baseline abandoned 18 tasks. Candidate delivery had no task-ending errors; recovered transport errors still occurred.

Seven remaining source-audit failures: mail-02/03/06 and wiki-01/02/06/07. Most have correct computed figures but incomplete decisive source links; wiki-07 also adds unsupported uncertainty. Long tables, repeated conclusions and irrelevant missing-field caveats remain readability findings. `verification/eval-live/hard40-v2-trial1-20261013/comparison.json` and both source-audit files preserve the detailed local evidence.

## Release candidate follow-up

1.1.3 adds observed-source identities to the independent review, deterministic rejection of unknown citation identities through the existing bounded review loop, and actual process start/finish times plus revalidated prerequisites to its host receipts. It never guesses citation replacements or restores approval/edit authority. A focused retest of failed cases is separate from the completed 40-task candidate score.

### Source repair targeted retest

The third candidate tested 10 selected cases: all seven previous failures plus Bash command continuation, a skill control and the restore-synonym case. Candidate remained unchanged. Nine passed, including the invented Wiki citation and GPU correction; mail-06 still omitted the paid-ledger and version-selection policy links despite correct totals. This is a 9/10 targeted result, not a replacement 40-task score. Extra unrelated caveats and repeated prose still occur.

The next candidate gives material source coverage an explicit independent review requirement, instead of burying it inside a general request check. This follows the observed mail-06 omission. Windows Claude discovery and unrelated-scroll menu fixes are included separately and require their own host/UI tests.

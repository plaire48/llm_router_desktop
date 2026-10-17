# 문서 읽기, 압축과 하이브리드 브라우저 적용

2026-10-16. 기존 Pi, 현재 선택 모델, SQLite 원문, 승인과 BrowserSession에 연결했다. 새 모델 루프나 브라우저 안의 요청창을 만들지 않았다. 제품 원천과 Electron 빌드에 적용하며 Windows 설치판 배포는 별도다.

## 큰 문서 읽기

모델의 `read_attached_document`는 본문을 한 번만 반환한다. 페이지/시트/슬라이드는 같은 본문의 절대 문자 범위를 가리키는 locator로 반환한다. 전체 직렬화 결과는 누비 추정 토큰 9,000과 해당 응답의 남은 읽기 예산 중 작은 값에 맞춘다. 인용 메타데이터를 붙일 여유는 별도로 둔다. 제공자 tokenizer의 확정 한도로 표시하지 않는다.

`offset`, `limit`와 `nextOffset`으로 빠짐없이 이어 읽으며 surrogate pair 중간을 자르지 않는다. 같은 응답의 여러 읽기는 공유 예산을 사용하고 예산이 없으면 실행하지 않았다고 반환한다. 원문 해시와 현재 대화의 첨부 접근 권한은 그대로 확인한다.

위치를 찾지 못한 segment의 본문을 모든 창에 추가하던 경로를 제거했다. `unlocatedSegments`, `segmentCount`로 미확인 상태를 알리며 `segmentIndex`를 지정하면 그 추출 조각을 별도 예산 안에서 읽을 수 있다. 이때 offset은 해당 segment 기준이고 원문 페이지 위치는 `locationVerified:false`다. 인용/다시 열기와 압축 후 locator에도 segmentIndex를 유지한다. 세그먼트 내용을 버려서 토큰을 줄이는 방식이 아니다.

호스트 미리보기의 `chatDocument`는 기존 preview 투영을 사용한다. 모델 제한을 적용하기 위해 원본 저장 내용이나 화면용 본문을 바꾸지 않는다.

같은 합성 한국어 문서의 원문 0~12,000자 비교에서 정상 위치의 추정 결과량은 기존 36,207에서 적용 후 합계 18,391로 줄었다. 원문 문자열은 정확히 같고 새 경로는 최대 9,000토큰씩 3회 읽었다. 호출 수 증가와 모델 요청 전체/출력 비용을 포함한 성능은 별도다. 위치 불명 fixture도 같은 본문 범위를 유지하고 별도 segment 읽기를 확인했다. [원천 재현](../../../docs/research/2026-10-16-large-document-context-benchmark.md)과 [적용 후 기록](../verification/compaction-hybrid-2026-10-16/document-after.json)을 구분한다.

## 압축 방법

실행 순서는 다음과 같다.

1. 현재 원문 버전과 결과가 완전히 같은 오래된 `read_source`/`read_attached_document` 결과를 작은 locator로 바꾼다. 최신 원문 한 벌은 그대로 둔다. 변경 해시, 다른 범위, 오류, 취소, 승인 대기와 미확정 결과는 합치지 않는다. 저장한 원문/대화/실행 기록은 수정하지 않는다.
2. 그래도 기존 임계값을 넘으면 공유 compactor가 이미 완료한 과거 span을 현재 모델로 구조화 요약한다. Desktop은 `contextSummaryReview:true`를 주입해 짧은 요약 목표를 없애고 원문 보존을 우선한다. 현재 출력 예약량 안에서 요약 출력은 최대 8,192토큰, 정규화된 JSON은 최대 16,000자다. 다른 호스트의 기본 단일 요약 정책은 유지한다. goal/constraints/decisions/completed/pending/references와 findings/failed/current를 보존한다. 최신 미열람 결과와 원래 요청/최신 정정, 현재 호스트 상태는 별도로 유지한다.
3. 첫 요약 뒤에 같은 원천 조각과 이전 기억을 다시 읽어 후보를 대조하고 전체 수정 요약을 반환한다. 요청과 정정, 부정 조건/승인 범위, 정확한 값/날짜/단위/출처, 결정 이유, 실패, 미확정 실행과 미열람 구간을 다시 확인한다. 리뷰 요청도 입력 예산에 맞추며 최종 검토가 유효해야 해당 span의 경계를 저장한다. 검토 시간 단축을 위해 근거를 빼지 않는다. 이 2단계의 같은 모델 검토는 완전한 의미 보존을 증명하는 독립 판정은 아니다.
4. 첨부 ID/원문 해시/읽은 범위/다음 offset/segment는 모델의 기억에만 의존하지 않고 continuity evidence로 보존한다. 이것은 과거 읽기 범위이며 현재 원문 보유, 의미 분석 완료나 실행 권한이 아니다.
5. 형식 오류/출력 잘림은 같은 원천의 요약만 제한 재시도한다. 실패, 저장 오류나 취소 뒤에는 durable 경계를 앞으로 이동하지 않는다. 원문에 없던 이메일 식별자와 URL 근거가 요약에 섞이는 것도 제한한다. 모든 사실의 의미 정확도를 자동 증명하는 검사로 확대하지 않는다.

요약을 생성할 때의 출력 허용량과, 현재 대화에서 사용자 원문을 유지할 때 사용하는 예약량은 별도다. 전자를 늘렸다는 이유로 원래 유지하던 사용자 대화를 밀어내지 않는다. 좁은 입력 한도에서는 원천과 검토 초안이 함께 들어가도록 생성 허용량을 줄이며 2단계 검토 자체를 생략하지 않는다. 최초의 불필요한 압축 1건과 작은 창의 예산 실패를 재현해 회귀 검사로 남겼다.

기본 75% 요약 정책, provider catalog의 최대 문맥과 출력 예약량은 유지했다. 90%로 늦추는 설정 하나로 큰 결과 유입 문제를 해결하지 않는다. OpenAI Responses의 encrypted compaction은 제공자별 API 기능이므로 다른 누비 제공자에 그대로 사용한다고 가정하지 않는다.

참고한 방법론은 [Claude Code의 오래된 도구 결과 정리 후 요약](https://code.claude.com/docs/en/how-claude-code-works), [Anthropic의 recall 우선 compaction과 structured notes](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents), [OpenAI의 compaction과 검토 가능한 외부 기록 분리](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction)다. Claude 내부 비공개 구현을 복제한 것은 아니다.

## 진행 표시

실제로 구분된 두 경로를 중앙 대화의 진행 기록에 표시한다. 이미 완료된 대화 이력을 요약하는 `history`는 `대화 내용 정리 중`, 실행 중 쌓인 도구/관찰 문맥의 `context`는 `컨텍스트 압축 중`이다. 둘 다 원문을 대조하는 호출에서는 각각 `대화 내용 정리 검토 중`, `컨텍스트 압축 검토 중`으로 바뀐다.

`phase:summarizing`, `operation`, `stage`는 호스트가 실제 호출 시 저장한다. 한 호출의 응답만으로 완료시키지 않고 최종 검토와 저장까지 유지한다. 실패/취소/유예는 성공 횟수에 더하지 않는다. 원본 메시지는 화면과 저장소에 유지되고 기존 중지 버튼을 사용할 수 있다. 백분율이나 남은 시간은 만들지 않는다. UI 37개 검사에서 네 가지 상태와 원문 표시/중지를 확인하고 Electron 제품 화면 22개 검사도 통과했다. 이는 Codex 내부 구현이 같다는 주장이 아니라 누비의 실제 두 경로에 맞춘 상태 표시다.

## 실제 모델 비교

공식 Claude CLI의 safe-mode와 빈 도구 목록을 사용해 누비 `createRunContext`의 요약 호출을 실제 실행했다. 선택된 실제 모델은 CLI가 보고한 `claude-fable-5-1`이었다. 새 인증 저장소를 읽거나 모델/계정 설정을 변경하지 않았다. 합성 문서의 동일 반복 읽기와 초안 전용/정정 금액/납기/미확정 저장/미열람 범위를 사용했고 기존과 중복 정리 적용을 각각 3회, 순서를 교차해 실행했다.

| 항목 | 기존 | 중복 정리 적용 |
| --- | ---: | ---: |
| 회당 제공자 입력 토큰, cache 포함 | 16,245 | 6,909 |
| 요약 호출 | 각 1 | 각 1 |
| 중앙값 전체 경과 | 16.247초 | 22.114초 |
| 중앙값 출력 토큰 | 1,145 | 1,309 |
| 정해 둔 6가지 보존 확인 | 3/3 | 3/3 |

입력량은 약 57.5% 줄었지만 이 표본의 시간은 늘었다. 속도 개선을 통과시킨 결과가 아니다. 최종 비교의 입력은 회당 2토큰 외에는 cache read로 보고됐으며 청구 비용 57.5% 절감으로 해석하지 않는다. CLI 시작과 제공자 변동도 wall time에 포함된다. 원문 요청/금액/납기/미확정 저장/미열람 구간/해시 locator 보존을 확인한 좁은 과제이며 전체 문서 의미 품질이나 두 CLI 제품 대결은 아니다.

초기 실제 요약에서 source 밖의 계정 식별자가 나타난 사례를 발견해 원천 일치 검사와 회귀 검사를 추가했다. 검증 산출물에는 그 식별자를 가렸다. 초기 실험, 최종 6회와 후속 segment/브라우저 검토 메타데이터 변경은 별도이며 이 6회를 모든 최종 기능의 모델 실행으로 소급하지 않는다. [상세 측정](../verification/compaction-hybrid-2026-10-16/live-compaction-summary.json).

### 품질 우선 2단계 압축 후속

사용자 후속 지시에 따라 위 단일 호출 비교와 별도로 원문 재검토 프로필을 실행했다. 합성 한국어 대화에 최초/정정 값, 세금 조건, 발송 금지, 저장 재시도 금지, 응답 유실, 미열람 offset, 파일/행/해시, 실패한 selector, 이전 기억의 업무 범위와 이유, SSO/Windows 미검증을 포함했다. 실제 공식 Claude CLI의 같은 계정을 사용한 3회 결과와 소스 해시는 `live-reviewed-results.json`에 기록한다. 최종 소스 3회는 회당 2호출, 83.389/53.245/67.923초이며 중앙값 67.923초다. 정해 둔 12가지 보존 항목은 매회 모두 통과해 36/36이다. [측정과 한계](../verification/compaction-hybrid-2026-10-16/live-reviewed-summary.json)에 기록했다. 이 후속의 시간/품질은 이전 단일 호출 비교와 섞지 않는다. 정해 둔 12항목의 보존 검사이며 임의 장문 전체의 품질 보장은 아니다.

## 하이브리드 브라우저

기존 탐색 MCP에 `browser_run_workflow`를 연결했다. 중앙 에이전트가 현재 snapshot에서 이미 관찰한 target과 정확한 입력값을 1~8개 입력/클릭 단계로 제안한다. 기존 중앙 MCP 승인 폼이 그 인자를 승인하고, 호스트가 기존 `runReplay`의 결정적 matcher로 단계를 이어간다. 각 행동은 기존 독립 BrowserSession의 정책/관찰 검증/issued와 confirmed 또는 unconfirmed 기록을 거친다.

대상 ref는 매 단계의 새 snapshot에서 role/name의 유일한 대상으로 다시 결합한다. 같은 이름의 모호한 대상, 누락/잘린 관찰, iframe이 있는 관찰은 중단한다. 원래 승인한 plan/binding과 현재 상태가 다르면 처음부터 다시 제안해야 한다. 임의 selector, JavaScript, 쿠키, 파일이나 API 실행 권한을 추가하지 않았다.

완료/중단한 workflow 결과는 SQLite에 보존하고 동일 호출은 결과만 돌려준다. 프로세스가 중단되어 running으로 남은 workflow나 미확정 action을 자동 재시작하지 않는다. 확인된 prefix는 다시 실행하지 않고 모델이 남은 요구를 새 관찰로 판단한다. `taskCompleted:false`와 `functionalVerified:false`를 유지하며 마지막 readback은 기존 독립 검토의 후보 근거로만 사용한다.

실제 Electron + 공식 Playwright MCP + 기존 Pi + BrowserSession 검사에서는 열기와 workflow 승인 2건, 한글 입력/클릭 2단계, 결과 DOM, 서버 1개와 탭 1개를 확인했다. 중간 두 동작 사이에는 모델 호출이 없었다. 모델 선택은 scripted fixture다. 단계를 개별 제안한 이전 flow보다 actor 단계가 5에서 4로 줄었지만 실제 모델 속도 우위나 임의 사이트 성공률로 표시하지 않는다.

이 첫 연결은 **현재 한 화면에서 관찰한 입력/클릭의 제한된 batch**다. 선택 모듈의 Page 기반 전체 구조 관찰, 위키 절차의 학습/qualification/자동 재사용, 보이지 않는 다음 화면의 동적 workflow와 시각 좌표 조작까지 제품 연결을 완료했다는 뜻은 아니다. 기존 MCP 탐색으로 돌아갈 수 있다. [상위 적용 명세](../../../docs/superpowers/specs/2026-10-16-workspace-hybrid-browser-runtime.md)의 나머지 단계는 별도 평가 대상이다.

## SAML과 지속 세션

제품의 일반 BrowserHost는 Electron이 소유한 `persist:nubi-browser-workspace`를 사용한다. 기존 회사/모델 인증 partition과 섞거나 외부 Chrome/Edge 쿠키를 복사하지 않는다. 독립 프로필로 Electron 프로세스를 닫고 다시 실행해 fixture session cookie의 지속을 확인했다.

SAML 주소/응답과 아직 왕복이 끝나지 않은 auth flow는 Playwright에서 차단한다. 기존 guest WebContents, POST/opener와 인증 탭 보호를 유지한다. 업무 화면 복귀는 새 관찰로 확인해야 하며 URL/200만으로 실제 로그인 성공을 선언하지 않는다. 최초/만료/회사 정책/실계정/Windows 호환은 실제 사내 환경에서 아직 검증하지 않았다.

## 검증 기록

최초 실패, 최종 단위/회귀/빌드/화면 로그와 소스 해시는 [검증 폴더](../verification/compaction-hybrid-2026-10-16/)에 보관한다. fixture, 실제 모델 요약, 실제 Electron와 회사 SSO/설치판의 근거를 구분한다. 최종 통계는 해당 폴더 `implementation-summary.json`을 따른다.

최종 소스 18개 해시가 검사 시작과 종료에 일치했다. 공통 1,734/1,734, Desktop 1,494 통과/196 건너뜀/실패 0, 집중 31/31과 빌드를 확인했다. 최초 두 회귀 실패와 작은 입력 예산 실패도 보관하며 최종 통과와 구분한다.

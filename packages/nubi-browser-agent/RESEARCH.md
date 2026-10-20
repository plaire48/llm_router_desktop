# 관찰한 링크의 상세 문서 비교

위키 재사용의 선택 연결:

```ts
import {withDocumentReadContinuation} from '@nubi/browser-agent/research';
import {compactBrowserContext} from '@nubi/browser-agent/context';

const memory = screenKnowledge.memory(
  withDocumentReadContinuation(hostVerifiedProcedureMemory, {required: true}),
);
const runner = createPiBrowserRunner({
  ...hostRunnerOptions, memory, prepareContext: compactBrowserContext,
});
```

`required: true`는 검색 후 읽기가 필요한 과제에서 제목 조건을 최초 제안의 필수 입력으로 만든다. 기본값은 false로 기존 호출과 호환된다.

제목 조건은 동작 설명을 붙인 전체 이름보다 짧은 주제 명사를 사용한다. 한 글자인 언어의 주제도 허용하며 빈 값은 거절한다. 길이가 짧아도 현재 관찰에서 정확히 하나의 링크에 맞아야 한다. 맞는 링크가 없거나 모호하면 모델이 일반 도구로 남은 조회를 판단해야 한다.

호스트가 실제 재검증한 절차만 일반 실행에 제공한다. 모델은 절차 선택 시 현재 입력값과 `readAfter.titles`의 짧은 제목 조건을 함께 제안할 수 있다. 절차가 안전하게 완료된 뒤 새 관찰의 링크마다 조건을 대조한다. 각 조건이 정확히 하나의 링크를 가리키고 서로 다른 링크일 때만 기존 읽기 도구를 호출한다. URL/selector를 추측하지 않으며, 누락/모호함/중복 대상이면 읽기를 시작하지 않는다. 쓰기는 기존 절차/정책/승인 경로만 사용하고 후속 API에는 read 효과 도구만 허용한다. 절차가 멈췄거나 사용자 대기/미확정 실행이 있으면 후속 읽기를 실행하지 않는다. 관찰 무효 예외 또는 확실한 not_started 읽기 결과이면 같은 주제와 원래 URL을 새 관찰에서 다시 대조해 읽기만 1회 복구한다. URL 변경/모호함/사용자 대기/미확정/확정 결과나 관찰 무효 이외의 예외는 이 경로로 재시도하지 않는다. 후속 읽기가 실패해도 완료한 절차와 영수증은 반환해 남은 읽기만 판단한다. 최종 완료는 기존 호스트의 전체 요청 검증으로 판단한다.

실제 조작이 반드시 필요한 새 요청에는 `runner.run({...input, initialToolChoice: 'required'})`를 선택할 수 있다. 호스트 모델 어댑터가 `ModelCallContext.toolChoice`를 기존 제공자 연결로 전달해야 효과가 있으며, 첫 호출만 required이고 이후는 auto다. 기본값은 auto다. 이 힌트는 실행이나 승인이 아니며 모든 제안은 기존 검증을 거친다.

호스트가 **원 요청에 맞는 재검증 절차 하나**를 찾아 제공했다면 `preferVerifiedProcedure: true`를 선택할 수 있다. 새 작업의 첫 모델 호출에만 절차 선택, 새 관찰과 사용자 질문 도구를 제공하고 다음 호출에는 전체 도구를 복구한다. 기본값은 false다. 여러 후보/후보 없음/기존 영수증/명시 재개/사용자 응답에서는 줄이지 않는다. 호스트는 단순히 비슷한 입력란이 있다는 이유로 다른 업무의 절차를 제공하면 안 된다. 맞지 않거나 중단된 절차를 강제 실행하지 않으며 기존 접근/정책/승인/영수증/독립 완료 검증을 유지한다. 올바른 일반 도구 경로도 완료로 인정한다.

`compactBrowserContext`는 추가 모델 없이 직접 노출한 도구의 중복 action catalog와 바이트가 같은 ARIA 문자열만 줄인다. 과거 관찰의 고유한 사실과 현재의 잘린 ARIA도 보존하고, 과거 대상의 실행용 ID만 제거한다. 원래 요청, 현재 observationId/binding/프레임/대상/링크, 읽은 출처, 영수증과 tool call 연결은 보존한다. 미확정 실행이나 사용자 대기가 문맥에 있으면 원문을 유지한다. 도구 목록이 단일 fallback 도구인 경우 필요한 catalog를 제거하지 않는다. 이 함수는 Pi의 선택 prepareContext hook이며 모델/인증/실행 루프를 만들지 않는다.

`./research`는 기존 BrowserPort에 읽기 전용 `browser_read_documents`를 합성한다. 호스트가 등록한 현재 화면의 linkId 1~3개만 받는다. URL/selector/스크립트를 모델에서 받아 실행하지 않는다. 기존 Pi, 정책, 실행 상태와 완료 검증을 그대로 사용한다.

```ts
import {createDocumentResearchPort} from '@nubi/browser-agent/research';
import {createPlaywrightDocumentReader} from '@nubi/browser-agent/research/playwright';

const documents = createPlaywrightDocumentReader({
  page: hostPageForTab,
  roots: hostAuthorizedReadRoots,
  access: hostMayReadPage,
  allowUrl: hostMayNavigateToUrl,
  open: hostOpenTemporaryReadPage,
  close: hostCloseOwnedReadPage,
  ready: hostWaitForActualContent,
  knowledge: hostAnalyzeOrReuseScreenWiki,
  focusHeadings: taskRequestedSectionNames,
});
const browser = createDocumentResearchPort({
  browser: existingBrowserPort,
  documents,
  concurrency: 3,
});
// Host attaches this BrowserPort through the existing addon and Pi contracts.
```

페이지의 할당/접근 판정/리다이렉트 차단/내용 준비/위키/해제는 모두 호스트가 제공한다. `open`은 별도 임시 read Page를 제공하고 실패한 open도 정리해야 한다. 자동 로그인이나 새 브라우저 엔진을 만들지 않는다. core는 Workspace/Node 파일 API/모델을 import하지 않는다. 사이트별 DOM/접근 profile과 정답은 호스트 또는 evaluation에 둔다.

관찰 시 링크를 실제 DOM handle과 원본/프레임 문서에 묶는다. 읽기 전, 각 물리 읽기 시작 전과 결과 반환 전에 원본 binding/링크/권한을 다시 확인한다. 같은 문서의 fragment 링크는 중복 읽지 않는다. 임의 URL, 관찰하지 않은 ID, 중복 ID와 오래된 관찰을 거절한다. 각 상세 읽기는 새로운 Page에서 실제 내용을 얻고 항상 닫는다. 읽지 못한 문서는 개별 오류로 남긴다. 부분 결과는 전체 과제 완료가 아니다.

기본 동시성은 1이다. 호스트가 허용한 경우 2~3개의 독립 읽기만 병렬화한다. 검색 입력/전송이나 상태 변경을 묶어 병렬 실행하지 않는다. 취소/해제는 물리 읽기가 정리될 때까지 소유권을 유지하며, 늦은 결과를 다음 작업에 재사용하지 않는다. 실행 후 링크 관찰만 실패했다면 확인된 실행 영수증을 보존하고 최대 두 번 읽기만 다시 시도한다. 쓰기 자체는 재전송하지 않는다.

본문은 허용된 root의 실제 표시 텍스트에서 읽는다. 입력/편집 값, 숨긴 요소와 navigation/script/style은 제외한다. `focusHeadings`는 호스트가 요청에 맞춰 정한 정확한 의미 제목이다. 현재 문서에서 해당 제목을 모두 찾으면 그 구역만 읽고 코드 예제 블록은 제외한다. 제목을 찾지 못하면 원래 범위로 돌아가며 `selection.missing`에 남긴다. 반환 데이터의 `selection`/`truncated`를 유지해 부분 읽기를 문서 전체 확인으로 표시하지 않는다.

출처에는 새 sourceId, 실제 URL/제목, 읽은 내용과 범위, 시각과 내용 hash를 반환한다. 화면 지식에는 이 본문이나 비교 답을 넣지 않는다. 다음 요청도 실제 내용은 다시 읽고 기존 화면 구조 안내만 재사용한다. 최종 비교 셀/출처와 원래 사용자 요구는 호스트가 독립적으로 검증해야 한다.

후속 공개 사이트 실측의 고정 계약은 `docs/research/2026-10-16-browser-naver-complex-plan.md`다. 로컬 Chrome 검사와 공개 사이트/실모델, Workspace/사내/Windows 검증을 구분한다.

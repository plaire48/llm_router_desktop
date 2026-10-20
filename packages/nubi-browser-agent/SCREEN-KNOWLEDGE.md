# 시스템별 화면 지식

후속 복합 조회는 [관찰한 링크의 상세 문서 비교](RESEARCH.md)와 `docs/research/2026-10-16-browser-naver-complex-results.md`를 따른다. 위키 재사용 후에도 비교할 실제 내용은 새로 읽는다.

v0.5.0 선택 기능이다. 호스트가 등록한 시스템/환경/화면을 분석해 OpenWiki Markdown으로 저장하고 다음 요청의 기존 Pi 문맥에 화면 안내를 제공한다. 실제 Workspace UI 등록, 시스템 자동 발견이나 모든 업무 절차의 자동 학습을 구현한 것은 아니다.

## 지원 범위

- `./knowledge`: 화면 종류 분류와 관찰한 제목/입력 항목/동작 선택, 저장/readback, 구조 재확인 후 조회, 기존 BrowserMemoryPort와 합성.
- `./knowledge/playwright`: 같은 호스트 Page의 지정 DOM 범위와 프레임에서 구조를 읽는다. 입력값을 읽지 않으며 모델 생성 selector/스크립트를 받지 않는다.
- `./knowledge/wiki`: 호스트가 제공한 원자적 문서 저장소에 시스템별 Markdown을 기록한다.
- `./knowledge/files`: 호스트가 명시한 기존 OpenWiki 프로젝트 폴더를 위한 선택 Node 어댑터. 호스트 권한 콜백이 필수다.
- `./stagehand`: 호스트가 초기화한 Stagehand 3.7.3의 읽기 전용 extract와 호스트 모델을 연결한다. 새 모델 루프/브라우저/인증 저장소를 만들지 않는다.

기존 addon API 1.3과 checkpoint schema 1은 유지한다. 기본 core import에는 Stagehand/Zod/Node 파일 API를 가져오지 않는다. 브라우저 SDK와 위키 파일 기능은 필요한 진입점만 선택한다.

## 호스트 연결 예시

아래 Page, 접근 판정, 화면 분류, 모델, 위키 저장소와 SDK 생명주기는 모두 호스트가 제공한다. `screenId`는 URL에서 자동 추측하지 않으며 호스트가 등록/판별한 ID다.

```ts
import {createScreenKnowledge, createModelScreenAnalyzer} from '@nubi/browser-agent/knowledge';
import {createPlaywrightScreenSource} from '@nubi/browser-agent/knowledge/playwright';
import {createWikiScreenStore} from '@nubi/browser-agent/knowledge/wiki';

const source = createPlaywrightScreenSource({
  page: hostPage,
  screenId: registeredScreenId,
  variantId: registeredVariantId,
  access: hostMayReadCurrentPage,
  roots: hostAuthorizedRoots,
});
const knowledge = createScreenKnowledge({
  scope: {projectId, systemId, environmentId, accessScopeId},
  source,
  store: createWikiScreenStore(hostWikiDocuments),
  analyzer: createModelScreenAnalyzer(hostModel),
});
await knowledge.analyzeAndSave(taskSignal);

// The existing runner still owns model/action turns and host completion verification.
const memory = knowledge.memory(existingProcedureMemory);
const runner = createPiBrowserRunner({...existingRunnerOptions, memory});
await runner.run(nextRequest);
```

`hostWikiDocuments`는 범위별 read와 compareAndSet을 제공한다. 기존 위키 저장소를 그대로 사용할 수 있다. 파일 기반 호스트에서는 다음 선택 어댑터를 사용할 수 있다.

```ts
import {createFileWikiDocuments} from '@nubi/browser-agent/knowledge/files';
const hostWikiDocuments = createFileWikiDocuments({
  root: explicitlySelectedProjectRoot,
  authorize: hostAuthorizeWikiOperation,
});
```

root는 존재하는 절대 경로다. 쓰기 콜백은 기존 승인/공유/보존 정책을 적용하고 완료된 내구성 있는 저장을 반환해야 한다. 파일 어댑터는 정해진 OpenWiki 경로만 쓰며 symlink 우회와 다른 범위의 문서 반환을 거절한다. 협력하는 writer 간 lock/CAS와 임시 파일 rename, fsync를 사용한다. 비정상 프로세스 종료로 남은 lock의 복구는 호스트가 확인하고 처리한다. Windows 파일 동작은 아직 실측하지 않았다.

## 실제 Stagehand 연결

Stagehand 3.7.3과 Zod 4.4.3을 선택 peer로 고정했다. 호스트가 기존 브라우저의 허용된 CDP 연결과 SDK 초기화를 제공해야 한다. 모듈 자체에서는 SDK init/close/act/agent를 호출하지 않는다.

```ts
import {Stagehand} from '@browserbasehq/stagehand';
import {createStagehandModelBridge, createStagehandScreenAnalyzer}
  from '@nubi/browser-agent/stagehand';

// Host setup: attach to its already-owned Chrome; no credential copying.
const bridge = createStagehandModelBridge(hostModel);
const sdk = new Stagehand({
  env: 'LOCAL',
  localBrowserLaunchOptions: {cdpUrl: authorizedBrowserWebSocketUrl},
  llmClient: bridge.client,
  disableAPI: true,
  disablePino: true,
  verbose: 0,
  logger: () => {},
  logInferenceToFile: false,
  serverCache: false,
});
await sdk.init();
const analyzer = createStagehandScreenAnalyzer({
  stagehand: sdk,
  modelBridge: bridge,
  page: hostPage,
  validate: source.validate,
  // Optional host-authorized extraction container; never model-selected CSS.
  selector: hostExtractionSelector,
});
```

SDK 추출 전후와 각 모델 호출 전에 현재 화면/접근을 재검사한다. 모델 브리지는 실행 단위 signal과 접근 판정을 묶으며 같은 SDK 브리지의 동시 실행을 거절한다. 취소 후 늦은 SDK 응답이 다음 작업의 signal을 빌리지 않는다. host detach 시 작업 signal을 중단하고 진행 중인 읽기가 정리된 뒤 호스트 소유 SDK/Page를 해제한다.

기본 표준 extract는 구조화 추출과 완료 메타데이터 때문에 모델을 두 번 호출한다. 기본 분석 경로는 한 번이다. SDK 결과도 알려진 근거 ID와 종류만 받아 저장하며 임의 설명/실행 스크립트나 절차를 받지 않는다. 현재 어댑터는 DOM 기반이며 Stagehand 시각 추출은 켜지 않는다. 실제 업무 데이터의 저장 권한과 SDK에 제공하는 Page/범위 및 로깅 정책은 호스트가 관리한다.

## 저장과 재사용의 의미

경로는 `openwiki/systems/<systemId>/screens/<scope-screen-hash>.md`다. scope에는 프로젝트, 시스템, 환경과 접근 범위가 포함된다. 같은 시스템이라도 다른 환경/접근 범위의 기록은 섞지 않는다.

Markdown의 한 문서에 작은 분류 frontmatter, 사람이 읽는 화면 안내와 해당 안내의 구조화 기록을 함께 둔다. 원본 레코드와 화면 안내가 어긋나면 읽기/덮어쓰기를 거절한다. 이 형식의 문서는 기존 OpenWiki 검색으로 찾을 수 있다. OpenWiki의 claims 검증이나 화면에서 실제 저장/전송이 성공했다는 뜻은 아니다.

재사용은 현재 화면의 구조 fingerprint와 실제 구조 근거/범위를 모두 대조한다. 입력값 변경과 같은 화면의 새 문서 로드는 템플릿 재사용이 가능하지만 진행 중 분석의 문서 교체는 거절한다. 레이블 변경은 stale로 반환하고 Pi에 오래된 안내를 전달하지 않는다. `analyzeAndSave`를 다시 호출하면 현재 근거로 새 초안을 분석/기록한다.

`memory()`는 현재 화면에 맞는 짧은 안내만 기존 Pi lookup에 합성한다. 새 요청의 입력/실행 targetId는 매번 새 관찰에서 가져온다. 기존 절차의 run/capture/learn/resume 소유권은 바꾸지 않는다. 화면 안내는 과거 참고 지식이며 승인이나 실행 가능한 macro가 아니다.

첫 구현은 현재 등록된 화면의 안내 재사용이다. 다른 화면을 찾아 이동하는 사이트 지도, 시스템 간 자료의 자동 관계 생성, 사용자 검토 UI, 시각/OCR 추출, 임의 사이트의 자동 등록과 실제 사내 SSO는 후속 범위다. 제목/레이블에도 업무 정보가 들어갈 수 있으므로 입력값을 제외하는 검사만으로 모든 개인정보 제거를 보장하지 않는다.

## 검증과 의존성

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm test
npm run test:browser
node scripts/screen-knowledge-live.mjs /absolute/report.json
node scripts/screen-knowledge-live.mjs /absolute/public-report.json public
node scripts/screen-knowledge-reuse-live.mjs /absolute/reuse-report.json /absolute/report.json
```

legacy peer 옵션은 기존 호스트 Playwright alpha와 Stagehand의 선택 peer semver 차이를 위한 개발 설치 옵션이다. 별도 브라우저 엔진을 설치하지 않는다. Stagehand 모델 SDK의 취약한 전이 의존성은 `@ai-sdk/provider-utils → undici`를 6.28.1로 고정해 실제 SDK/회귀 검사로 확인한다. 제공자 transport를 바꾸거나 인증을 우회하지 않는다.

실모델 비교와 실패 이력은 `docs/research/2026-10-16-browser-screen-knowledge-implementation.md`에 기록한다. 합성 모델을 사용한 실제 SDK 연결 검사, 실모델 개발 화면, 실제 공개 사이트와 Workspace/사내/Windows 성적은 별도다.

## 학습 중 사용자 질문

선택 `./knowledge/learning`은 화면 용도, 항목이나 버튼의 의미, 업무 규칙이 불확실할 때 기존 Pi 실행의 `WAITING_FOR_USER`와 호스트 질문 UI를 사용한다. 한 화면 구조당 질문은 최대 2개다. 모델은 관찰한 근거 ID와 질문 주제만 고르고 실제 질문 문장은 모듈의 고정 문구로 만든다. 기본 분석은 바뀌지 않으며 `{learning:true}`를 명시한 경우에만 같은 모델 호출 한 번에 불확실성도 분석한다.

```ts
import {createModelScreenAnalyzer} from '@nubi/browser-agent/knowledge';
import {createScreenLearning} from '@nubi/browser-agent/knowledge/learning';

const {knowledge, port: learning} = createScreenLearning({
  scope, source, store: createWikiScreenStore(hostWikiDocuments),
  analyzer: createModelScreenAnalyzer(hostModel, {learning: true}),
  // This source must belong to this exact Pi observation, owned tab and document.
  validateContext: hostMatchesCurrentPageAndAccess,
  // Reject credentials, private form values or explanations the host may not retain.
  allowAnswer: hostMayStoreBusinessExplanation,
});
const runner = createPiBrowserRunner({
  ...existingRunnerOptions, learning,
  memory: knowledge.memory(existingProcedureMemory),
});
const result = await runner.run(request);
// result.checkpoint.pending is presented through existing host.human.present.
// Return the exact requestId/instanceId/generation, plus the explicit user answer.
await runner.run({...request, response: {
  taskId: request.task.taskId,
  requestId: result.checkpoint.pending!.requestId,
  instanceId: result.checkpoint.pending!.instanceId,
  generation: result.checkpoint.pending!.generation,
  answer: userAnswer,
}});
```

호스트는 이 선택 기능을 연결하기 전에 `human.present`에서 `question`, `choices`, `inputMode`(text/long_text), `inputPlaceholder`, `context.title/element`를 표시해야 한다. 선택지가 있어도 직접 입력을 함께 제공한다. 화면 용도에는 조회와 검색 / 작성과 수정 / 승인과 결재 / 잘 모르겠어요를 제안한다. 기능 의미와 규칙에는 자유 입력과 잘 모르겠어요를 제공한다. 설명 입력은 최대 1,000자이며 비밀번호나 현재 폼 입력값은 요구하지 않는다. 실제 제품 UI는 호스트 책임이며 이 패키지에서 Workspace 화면을 수정하지 않았다.

응답은 기존 화면 레코드의 선택 `clarifications`에 사용자 출처, 응답 시각, 해당 질문 ID와 답변/보류 상태로 저장한다. 관찰한 `evidence`나 모델 분류를 사용자 답으로 바꾸지 않는다. 렌더링 시 별도의 사용자 설명으로 표시하며 실제 동작으로 검증된 사실, 지시나 승인으로 사용하지 않는다. 기존 필수 정책과 host verify를 그대로 적용한다. 이 학습 응답은 Pi에 새 사용자 실행 명령으로 전달하지 않고 출처가 구분된 위키 참고 문맥으로만 전달한다.

저장 전 호스트의 `allowAnswer`가 필수로 호출된다. 이 콜백은 저장 가능 여부를 판단하며 실행 승인이 아니다. 저장소는 원래의 CAS와 실제 readback을 유지한다. 민감정보의 완전한 자동 탐지는 제공하지 않으며 호스트가 보존 정책을 적용해야 한다. 위키와 체크포인트의 기존 schema 1은 유지하고 선택 필드만 추가했다. 새 질문 레코드를 읽는 호스트는 갱신한 이 모듈의 parser를 사용해야 한다. 질문 필드가 없는 예전 위키는 학습 기능을 처음 켰을 때 한 번 다시 분석한다.

같은 구조에서 답했거나 보류한 질문은 재질문하지 않는다. 새로운 모듈 인스턴스도 같은 저장소에서 설명을 읽는다. 재분석 때 같은 구조와 정확히 같은 질문 정의에 해당하는 답변만 보존한다. 화면 구조, 시스템/환경/접근 범위, 질문 정의나 위키 버전이 달라지면 과거 질문의 답을 새 화면에 붙이지 않는다. 화면이 바뀐 뒤 도착한 답은 `stale`로 폐기하고 현재 화면을 새로 분석한다. 재연결 후에는 기존 규칙대로 명시 재개와 새 질문 요청 ID가 필요하다.

현재 질문 시점은 **Pi 실행 시작이나 사용자 응답 후 현재 등록된 화면**이다. 탐색 중 모든 화면을 자동 등록해 학습하는 사이트 크롤러는 아니다. 다른 화면의 지식은 호스트가 그 화면의 source/scope를 제공해 연결한다. 미확정 실행이 있으면 학습을 진행하지 않고 먼저 기존 reconciliation 흐름으로 돌아간다. 답변 저장 거부/충돌/실패는 작업을 멈추고 오류를 반환한다. 명시 재개 시 아직 저장되지 않은 질문을 다시 제시할 수 있다.

실모델 개발 검증은 [학습 질문 결과](../../docs/research/2026-10-16-browser-screen-learning-questions.md)를 따른다. 객관식/장문 계약 검사, 실제 Chrome 표시/구조 검사와 실제 모델 질문 선택을 구분한다.

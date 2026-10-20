# Nubi Browser Agent

선택 `./knowledge/learning`은 모호한 화면의 용도와 기능을 사용자에게 질문하고, 출처가 구분된 설명을 기존 위키에 저장해 재사용한다. 객관식과 자유 입력은 기존 호스트 질문 UI로 전달한다. 연결과 실제 검증 범위는 [시스템별 화면 지식](SCREEN-KNOWLEDGE.md#학습-중-사용자-질문)을 따른다.

위키 재사용 시 선택 `./context`와 검증한 하위 절차의 후속 읽기로 모델 왕복을 줄일 수 있다. 연결과 호스트 책임은 [RESEARCH.md](RESEARCH.md)를 따른다.

호스트가 현재 요청에 맞는 재검증 절차 하나를 제공한 경우 선택 `preferVerifiedProcedure`로 첫 도구 목록만 줄일 수 있다. 이후에는 전체 도구를 복구하며 기본 동작과 승인/복구 계약은 유지한다. 새 요청 전이 비교는 개발용 `scripts/naver-transfer-live.mjs`와 `scripts/score-transfer.mjs`를 사용한다. 실제 두 제품 실행기나 공식 벤치마크 점수와 구분한다.

상세 문서 비교용 선택 읽기 합성은 [RESEARCH.md](RESEARCH.md)를 따른다. 현재 관찰한 링크만 읽고 기존 호스트/Pi/정책을 유지한다.

누비 Workspace에 나중에 연결할 독립 브라우저 작업 모듈이다. 호스트 계약/작업 수명주기, 선택 Playwright MCP 어댑터와 기존 Pi 실행기/모델을 주입하는 연결 계층을 구현했다. Workspace 제품 화면 연결은 후속이다.

v0.5.0에는 시스템별 화면 지식을 분석해 OpenWiki Markdown으로 저장하고 다음 Pi 요청에 재사용하는 선택 `./knowledge`를 추가했다. 실제 Stagehand SDK를 호스트 모델/브라우저에 연결하는 `./stagehand`도 제공한다. 연결 방법과 지원 범위는 [시스템별 화면 지식](SCREEN-KNOWLEDGE.md)을 따른다. 기본 core의 필수 런타임 의존성과 addon API/checkpoint 계약은 유지한다.

범용 모듈이며 JSM/그룹웨어 특화 실행기가 아니다. `evaluation/`의 업무별 화면과 정답은 개발용 시험 사례로만 사용하고 core나 패키지 공개 진입점에서 참조하지 않는다.

## 구현한 범위

- 부작용 없는 등록, API 버전과 capability 검사, 중복 attach 방지
- 호스트가 제공하는 탭 lease, 관찰과 대상 revision 검증, 도구 catalog 세대
- 로그인 개입과 정확한 실행에 대한 승인 요청, 오래된 응답 차단
- CAS 작업 저장과 발행 전 기록, 미확정 쓰기의 자동 재전송 차단
- 사용자 취소, 신규 접수 중단, 저장/flush 후 detach, 실패한 정리의 재시도
- 호스트의 별도 완료 조건 검사. 도구 성공만으로 업무 완료를 선언하지 않음

원래 요청, 완료 조건과 실행 영수증은 체크포인트에 유지한다. 승인 대기 중 입력 인자는 메모리에만 두고 저장된 기록에는 fingerprint를 남긴다. 비밀번호, MFA, 쿠키를 받는 API는 없다.

## 사용과 검증

Node 22.19 이상을 사용한다.

```sh
npm ci --ignore-scripts
npm test
npm run test:browser
npm run benchmark:overhead -- /absolute/path/overhead.json
npm run benchmark:legacy -- /absolute/path/legacy.json
```

```ts
import {createBrowserAddon} from '@nubi/browser-agent';
import type {Host} from '@nubi/browser-agent';

// Host의 browser/store/policy/human/events 포트는 사용하는 앱이 제공한다.
async function attach(host: Host) {
  const addon = createBrowserAddon();
  const session = await addon.attach(host, {projectId: 'project-1'});
  return {addon, session};
}
```

패키지는 private이며 아직 배포하지 않는다. core의 필수 런타임 의존성은 없다. TypeScript와 실제 브라우저 검사에 쓰는 MCP/SDK/Playwright는 개발 의존성으로 고정했다. 선택 `./playwright` 진입점의 호스트는 검증한 Playwright 버전을 제공한다. core는 Electron, Desktop, 제공자 인증 저장소를 직접 import하지 않는다.

브라우저 검사는 별도 임시 프로필의 Chrome을 사용한다. `NUBI_TEST_BROWSER_CHANNEL`로 설치된 테스트 채널을 지정할 수 있으며 회사 계정/프로필은 사용하지 않는다. 일반 `npm test`는 브라우저 실행을 요구하지 않는다.

## 선택 Pi 연결

`@nubi/browser-agent/pi`는 기존 `runAgent`와 모델의 `complete`를 호스트에서 주입받는다. 별도 모델 실행 루프나 제공자 로그인을 만들지 않는다. 호스트는 `answerSettlementVersion:1`을 제공해야 하며 Pi가 완료 후보를 독립 host verify에 전달하고, 부족한 결과는 같은 Pi 후속 호출로 보완한다. 미검증 답변은 반환하지 않는다.

```ts
import {createPiBrowserRunner} from '@nubi/browser-agent/pi';

const runner = createPiBrowserRunner({
  session,
  pi: {answerSettlementVersion: 1, runAgent: hostRunAgent},
  model: {id: selectedModelId, complete: hostComplete},
  tabs: () => hostAuthorizedTabLabels,
  onMetric: event => hostRecordMetadata(event),
});
const result = await runner.run({task, tabId: selectedTabId, signal});
```

`hostComplete(messages, tools, context)`는 기존 OpenAI 형식 응답과 도구 제안을 반환한다. `context`에는 고정 modelId, 취소 signal, callId와 공개 응답 도착 알림이 있다. 실제 도구 동작이 필수인 요청에는 `run({..., initialToolChoice: 'required'})`를 선택하고 호스트 어댑터가 `context.toolChoice`를 제공자에 전달한다. 첫 호출만 required이며 기본값과 이후 호출은 auto다. 이 설정은 실행 승인이 아니다. 모델/탭 목록의 교체는 호스트가 관리하며 한 session은 실행기 하나만 소유한다. 단순 읽기는 최초 실제 관찰을 바로 모델에 넘겨 별도 계획 호출을 추가하지 않는다. 매 동작은 현재 observationId와 host catalog에 묶으며, 변경 중 실패한 읽기만 최대 세 번 새로 관찰한다. 쓰기는 이 경로로 재시도하지 않는다.

`Tool.parameters/description`은 선택 호스트 메타데이터다. 모든 도구에 object 입력 스키마가 있으면 `browser_type`처럼 직접 도구로 노출하고 actionId/observationId를 추가한다. Pi는 제공된 타입을 검증한다. 스키마가 없는 기존 호스트는 `browser_action.input`을 사용한다. 중첩 객체를 문자열에서 자동 변환하지 않으며 입력은 core의 `Action.arguments`로 전달한다. 바인딩/승인/세대는 호스트 값만 사용한다. 모델에 임의 selector/스크립트를 노출하지 않는다.

사용자 질문은 `requestInput`의 체크포인트에 저장한다. 재개는 같은 `task`와 현재 pending의 `requestId/instanceId/generation`, 질문의 명시적 `answer`를 전달한다. 승인 응답은 호스트의 정확한 권한 검사를 별도로 통과해야 한다. 일시중지 복원은 `resume:true`가 필요하고 사용자 취소는 자동 재개하지 않는다. 전체 Pi 대화 이력은 이 모듈이 영속화하지 않으며 재개 시 원래 요청/조건/영수증과 새 관찰을 사용한다. `prepareContext`는 기존 호스트 문맥 계층을 연결하는 선택 포트다.

진행 중인 실행에서 host가 확정한 `not_started`만 새 판단을 위한 재관찰로 이어간다. 같은 실패가 세 번 반복되면 사용자에게 넘긴다. `unconfirmed`는 새 쓰기를 차단하고 reconcile 결과도 미확정이면 즉시 사용자 대기로 바꾼다. 사용자 답변만으로 미확정 영수증을 성공으로 바꾸지 않는다.

`BrowserMetric`은 run/invocation/call/parent ID, 모델/도구 시간, 실제 제공된 토큰 수와 오류 코드만 기록한다. 프롬프트/페이지/입력값은 포함하지 않으며 telemetry 실패는 실행을 막지 않는다. `firstEvidenceMs`는 첫 브라우저 관찰 시간이고 사용자에게 전달된 첫 유용한 결과 시간이 아니다. `firstEventMs`는 호스트가 공개 content 도착을 알렸을 때만 존재한다.

실모델 개발 검사는 아래 명령을 사용한다. 평가 스크립트만 기존 공식 Claude Code 어댑터를 참조하며 배포 진입점에는 포함되지 않는다. typedToolArguments 옵션으로 도구별 JSON 스키마와 객체 형식의 전용 전송 프롬프트를 함께 사용한다. 기존 Desktop 호출의 기본 전송 계약은 유지한다.

```sh
npm run build
node scripts/pi-live.mjs /absolute/path/report.json legacy,google,naver
```

공개 포털 검사는 읽기만 허용한다. 로그인/메일은 계정과 조회 범위를 정한 별도 사용자 개입 시험으로 진행하며 비밀번호/MFA를 모델에 주지 않는다. 개발 결과와 실패 이력은 [Pi 연결 실측 기록](../../docs/research/2026-10-15-browser-agent-pi-live.md)에 구분한다.

## 선택 Playwright MCP 어댑터

`@nubi/browser-agent/playwright`의 `createPlaywrightMcpPort`는 호스트가 제공한 Page와 해당 탭 전용 MCP client를 재사용한다. 브라우저/계정/탭을 자체 생성하지 않는다. client를 다른 탭 선택이나 다른 실행기와 공유하면 안 된다. 호스트의 `access`는 DOM 관찰 전에 로그인/보호 화면을 분류해야 한다.

기본 관찰은 공식 MCP snapshot이다. `session.observe(taskId,tabId,{mode:'structure',frameId?})`로 필요한 경우에만 구조 관찰을 요청한다. 프레임 ID/문서 세대, 이름 없는 요소의 행 문맥과 opaque targetId를 반환한다. frameId는 직전 관찰에서 선택하고 새 관찰의 targetId로 행동한다. 모델이 임의 selector나 스크립트를 전달할 수 없다.

선택 `scope(tab)`은 호스트가 허용한 `{frame,root:Locator}` 목록을 반환한다. 이 경우 같은 Page의 범위 내 native 접근성 관찰과 opaque 대상만 제공하며 MCP 전체 화면 snapshot은 쓰지 않는다. 범위 밖 DOM 변경은 무시하지만 root/대상 교체, 관련 링크/폼 속성과 문서/프레임 바인딩 변경은 차단한다. 기본 전체 화면 관찰의 엄격한 변경 검사는 유지한다. 사이트별 범위는 호스트가 제공하며 core에 사이트 분기를 넣지 않는다.

기본 ref의 클릭/입력/선택은 MCP를 사용한다. 구조 관찰의 대상은 동일 Page에서 관찰한 ElementHandle의 고정 click/fill/select/press만 허용한다. 이는 별도 엔진이 아니라 같은 Playwright의 제한된 보강 경로다. 전역 키 입력 대신 관찰한 대상에만 키를 전달한다. MCP의 실제 tool schema를 읽어 `ref` 또는 `target` 인자를 협상하며 selector 문자열로 확장하지 않는다.

동작은 observationId와 탭/문서/프레임 트리 상태에 묶인다. DOM 교체/사용자 입력/하위 문서 이동 뒤 기존 관찰은 무효다. 동작 후 준비된 관찰이 있으면 결과에 함께 반환해 다음 호출에 재사용한다. 반환이 없으면 다시 관찰한다. `confirmed`는 해당 동작 응답이며 저장/전송의 업무 완료는 host verify/readback이 판단한다.

구조 관찰은 프레임당 보이는 대상 48개까지 제공하고 잘림을 표시한다. 프레임이 32개보다 많으면 명시 오류로 멈춘다. 닫힌 Shadow DOM/이미지 전용 요소, 시각 좌표 조작과 사이트마다 다른 이벤트 계약은 아직 별도 지원/검증 대상이다. 동적 화면은 관찰이 바뀌면 재관찰이 필요하다.

취소 후에도 이미 발행한 MCP 호출은 실제 응답까지 추적한다. 해제는 남은 호출이 정리된 뒤 observer/handle을 해제하며 사용자의 Page/client 자체는 닫지 않는다. 호스트는 MCP action/navigation/request timeout과 실제 연결 종료 책임을 유지한다. 미확정 외부 쓰기는 서버 readback 없이 다시 보내지 않는다.

## 선택 절차 기억

v0.4.0의 `@nubi/browser-agent/memory`는 Pi에 선택 `memory` 포트를 제공한다. `lookup`으로 필요한 역사 자료/절차 요약을 최대 3개 받아 첫 모델 호출에 제공하고, 모델은 저장된 ID/version과 이번 입력값만 선택한다. `run`은 호스트가 주입한 기존 재실행기를 사용하며 모든 실제 동작은 같은 session의 관찰/정책/승인/영수증을 거친다. 절차 완료 뒤 현재 읽기 관찰을 반환하며 전체 과제 완료는 host verify가 따로 확인한다.

`createReplayMemory`는 기존 `runReplay`/`recordTarget`과 호스트 `view/store`를 주입받는 연결 계층이다. 현재 어댑터는 단일 필드 fill_form, 관찰한 대상 click_element와 허용된 고정 키의 press_key를 지원한다. 매 단계 카드 내용/버전과 wiki/scope를 재검사하며 현재 대상의 메타데이터를 정확히 비교한다. 옛 ref, ordinal, selector/스크립트를 저장한 절차는 자동 실행 대상이 아니다. 읽기가 잘렸거나 대상이 모호하면 Pi가 남은 작업을 판단한다.

선택 `resume`는 대상 불일치로 멈춘 뒤 **미발행 나머지 단계만** 이어간다. 같은 Pi 모델이 새 관찰의 targetId와 단계 번호를 명시하고, 일회용 실행 토큰/관찰/프로젝트/탭/작업/카드 버전과 대상 종류/프레임을 재검사한다. 입력 슬롯과 확정 단계는 바꾸지 않는다. 같은 `runReplay(startAt)`를 사용하며 변경된 카드를 저장하거나 자동 승격하지 않는다. 승인 대기/미확정 쓰기/새 실행에는 토큰을 재사용하지 않는다. Playwright 어댑터는 기본 폼 제출과 실제 프레임 이동을 기다리며 preventDefault된 제출은 기다리지 않는다.

상태는 `draft → reviewed → revalidated`다. 일반 자동 선택은 `revalidated`만 허용한다. `qualification:true`는 사용자가 지정한 통제 시험에서 `reviewed`를 새 입력값으로 확인하기 위한 옵션이다. 시험 통과/검토/승격은 호스트가 관리하며 모듈은 스스로 승격하지 않는다. 실행 중 승인 대기 뒤에는 전체 절차를 재시작하지 않고, 확정한 영수증과 새 관찰에서 Pi가 남은 요구를 처리한다.

독립 완료 검증 이후의 `learn`은 호스트 학습 작업 접수 포트다. `capture`의 관찰 메타데이터와 이번 입력값은 실행 중에만 전달한다. 호스트는 자격 증명/사적 추론을 제외하고 DOM을 추가로 읽는 경우 현재 접근/바인딩을 먼저 확인해야 한다. 후보 생성/개인정보 검토/위키 본문 발행은 호스트 책임이다. 현재 입력값이 후보에 그대로 남으면 어댑터가 거절한다. 이 검사만으로 개인정보가 완전히 제거됐다고 보장하지 않는다. 학습 접수 실패/취소는 검증한 완료 답변을 지우지 않는다.

core는 위키 저장 위치, 검색 엔진, OpenWiki/Workspace 내부 구현을 import하지 않는다. 평가 호스트는 기존 기록 함수를 재사용해 값 없는 JSON 초안을 만들며 실제 OpenWiki 저장은 아직 연결하지 않았다. 절차 저장소는 실행 체크포인트와 별개다. 더 긴 절차 조합, 조건 분기, 팝업/파일 선택의 자동 학습과 실제 사내 화면은 후속 범위다.

```sh
npm run build
node scripts/memory-live.mjs /absolute/path/paired.json
node scripts/memory-live.mjs /absolute/path/reuse-gate.json reuse-only
node scripts/memory-live.mjs /absolute/path/recovery-gate.json recovery-gate
```

재열기/변경 후 복구의 계약과 별도 3회 측정은 [복구 실측](../../docs/research/2026-10-16-browser-agent-reopen-recovery.md)을 따른다.

실제 익명 네이버에서는 기억 사용/미사용 모두 2/3 완료했으며 속도 개선은 확인하지 못했다. 단순 절차 반복과 유사 업무에 도움이 되는 사이트 지식의 재사용을 구분한다. 실측, DevTools 실제 사용, Stagehand/browser-use 검토와 OpenWiki 지식 학습 방향은 [공개 사이트 실측과 지식 재사용](../../docs/research/2026-10-16-browser-agent-naver-public.md)을 따른다. 실제 OpenWiki 저장은 아직 연결하지 않았다.

측정/실패 이력과 Codex/AWM/BrowserBC 적용 근거는 [절차 기억 실측](../../docs/research/2026-10-16-browser-agent-procedure-memory.md)을 따른다. 모델/도구 시간에 지식 포트 구간을 추가했다. 절차 구간은 하위 도구 시간을 포함하므로 모든 span 시간을 단순 합산하지 않는다.

## 호스트 계약

- `browser.acquire/release`: 소유권 격리와 해제된 lease의 실제 브라우저 실행 차단. 사용자의 탭 자체를 닫지 않는다.
- `observe/validate/execute`: 탭과 문서의 현재 revision, 모든 도구의 정책 검증, 실제 결과와 근거 참조. 웹사이트 변경을 module의 취소만으로 되돌릴 수 있다고 가정하지 않는다.
- `policy.decide/human`: 현재 사용자 권한과 정확한 대상/인자의 승인 검증. 입력 폼의 표시 완료는 승인 또는 실행 완료가 아니다.
- `store`: compare-and-set의 성공 반환은 scope별 원자적이며 내구성 있는 저장 완료를 뜻한다. 발행 전 기록을 단순 메모리 큐에 넣고 성공을 반환하면 안 된다. flush는 해제 전 남은 저장 작업을 마친다. 원래 요청에 포함된 업무 데이터의 저장 권한도 호스트가 관리한다.
- `reconcile/verify`: 실제 사이트의 상태를 읽어 미확정 실행과 원래 요구사항을 독립 확인한다.

같은 lease의 행동은 순차 실행한다. 독립 탭의 병렬 읽기는 이후 어댑터에서 격리와 성능을 확인한 뒤 확장한다. 기록 실패 시 detach가 실패하며 소유권을 유지한다. 진행 중 acquire/tools는 현재 중단 API가 없으므로 호스트가 연결 timeout을 제공해야 한다. 취소를 무시하는 외부 작업의 실제 종료는 호스트의 release/fencing 계약이 담당한다.

## 확인 범위

core/fixture/Pi 자동 검사와 실제 Chrome+공식 MCP 검사 10개를 실행한다. Pi 검사는 실제 기존 Pi 실행기와 주입한 모의 모델을 사용하며 실모델 성적과 구분한다. 브라우저 검사에는 중첩/다른 출처 frame, label 없는 input, 지연 contenteditable, 팝업 열기, 오래된 대상 차단, 취소 중 해제와 서버 저장/재열기 확인이 포함된다. 임의 사내 사이트의 범용 성공률은 미측정이다.

`benchmark:overhead`는 메모리 계약 비용이고 `benchmark:legacy`는 로컬 합성 서버+실제 브라우저의 개발용 도구 처리 시간이다. 둘 모두 모델과 사내망/실제 SSO/Windows를 포함하지 않는다. 별도 `pi-live`와 `memory-live`는 실제 Claude Code 제공자와 Chrome의 개발 실측이다. Workspace 제품 속도, Codex/Claude Code 실행기 대비 우위와 사내 서비스 성공은 아직 미측정이다. v0.4.0의 addon API는 1.3이며 체크포인트는 schema 1을 유지한다. 새 프레임/관찰 정보는 임시 상태이며 복원 시 재관찰한다.

설계와 후속 평가: [모듈 명세](../../docs/superpowers/specs/2026-10-15-nubi-browser-agent-module.md), [Codex와 Claude Code 비교 및 속도 기준](../../docs/research/2026-10-15-nubi-browser-agent-dual-harness-benchmark.md).

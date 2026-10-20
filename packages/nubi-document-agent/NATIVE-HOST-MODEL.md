# 기존 호스트 모델의 native 쓰기 도구

`createNativeOfficeSkill`은 기존 호스트 실행기에 붙일 수 있는 GenOffice `AgentSkill`이다. Word/Excel/PPT의 같은 계약을 사용하고 모델/인증/Office 접근/승인/저장을 소유하지 않는다. 실제 Office 연결은 호스트가 바인딩한 `NativeOfficeWriteConnection`으로 주입한다.

```ts
import {createNativeOfficeSkill,runNativeOfficeTask} from '@nubi/document-agent';
import {createHostModelTransport} from '@nubi/document-agent/host-model';

// Already bound to one Office document; host serializes each call on UI/STA.
const connection = host.boundNativeConnection;
const result = await runNativeOfficeTask({
  request: userRequest,
  context: host.authorizedNativeMemberGuide
}, connection, createHostModelTransport(host.existingSelectedModel), signal);
host.presentNativeOutcome(result);
// The host still owns lease release, recovery and final save approval.
```

`existingSelectedModel`은 기존 `HostModelPort.complete`다. 인증/모델 선택을 새로 만들지 않는다. 편의 함수 `runNativeOfficeTask`는 다른 작성 모듈과 같은 GenOffice `AgentLoop`를 사용한다. 이미 호스트 실행기가 있다면 두 번째 실행기를 시작하지 않고 아래처럼 skill만 합성한다.

```ts
const native = createNativeOfficeSkill(connection, {
  context: host.authorizedNativeMemberGuide
});
try {
  await host.runExistingLoop({skill:native.skill,request:userRequest,signal});
  host.presentNativeOutcome(native.outcome());
} finally { native.dispose(); }
```

호스트는 매 턴 `skill.tools`를 다시 조회하고 도구를 순서대로 실행해야 한다. Office COM 도구를 병렬 실행하지 않는다. 호스트 UI/승인/저장소를 이 모듈 내부에 결합하지 않는다.

## 호출 흐름

1. `inspect_native_office({steps})`: getter만 실행한다. 실제 값과 객체 reference, 새 `observationId`를 반환한다. 모델은 `id`로 받은 COM 객체 핸들을 사용한다. `document`는 target이며 member에 `document.`를 붙이지 않는다.
2. `write_native_office({observationId,summary,steps,checks,...})`: 가장 최근 관찰에만 변경을 제안한다. 모델에 쓰기 도구는 관찰 뒤에만 노출한다. 기존 속성은 같은 target/member/args를 읽은 뒤에만 set할 수 있다. 기존 컬렉션의 변경 call에는 Count/CountLarge 관찰이 필요하다. 쓰기 중 생성할 객체는 새 ID를 사용한다.
3. 모든 set에는 같은 target/member/args와 **새 값**을 대조하는 check가 필요하다. Excel은 관찰한 `calculateTarget`과 계산 후 `afterChecks`도 필요하다. 원래 변경 검사를 계산 검사로 대체하지 않는다.
4. 모델 관찰과 쓰기 직전 실제 관찰의 값이 달라지면 변경을 발행하지 않고 새 관찰을 요구한다. 일치하면 기존 native의 `execute_office_operations`로 기존 승인/실행을 요청한다. Excel 계산과 독립 readback은 기존 `createNativeOfficeWritePort`를 사용한다.
5. 검증된 영수증의 실제 `receiptId`로 `finish_native_office`를 호출해야 완료한다. 완료 문장이나 모델이 넣은 success/saved 값은 완료 근거가 아니다.

JSON step은 `{target,action,member,id?,args?,value?}`다. `checks`/`afterChecks`는 `{read: getterStep,equals: value}`다. getter만으로 관찰하며 속성 set의 값은 생략할 수 없다. 현재 체크는 null 이외의 정확한 JSON 값 비교다. native의 모든 compare/delta/geometry 옵션을 노출한 계약은 아니다. 기존 native의 멤버/인자 정책과 실제 preflight도 통과해야 한다.

읽기 오류나 발행 전 검사 실패는 새 관찰과 수정 제안으로 복구할 수 있다. 연속 세 오류, 바인딩 변경과 취소는 멈춘다. 쓰기 뒤 거절/미확정/재읽기 실패/계산 대기는 도구 목록을 닫고 기존 호스트 복구로 넘긴다. 같은 쓰기를 자동 재전송하지 않는다. `dispose()`는 진행 중인 모듈 호출만 취소하고 외부 signal이나 Office 앱을 종료하지 않는다.

## 결과 경계

`verified_unsaved`는 native 영수증과 독립 재읽기 뒤 모델의 명시적 확인까지 끝났다는 뜻이다. 저장은 실행하지 않는다. 모델 오류, 취소 또는 턴 제한 뒤에도 이미 발행한 변경의 영수증/미확정 상태를 반환한다. 확인된 쓰기 없이 모델이 완료를 주장하면 `needs_review`다. 사용자는 호스트가 표시하는 구조화된 결과와 검토 근거를 기준으로 판단한다.

결과는 항상 `savedToOffice:false`, `office2016Verified:false`, `nascaVerified:false`를 유지한다. 호스트가 실제 Windows 연결인지 fixture인지 `environment`로 구분한다. 파일 렌더나 모델 호출 성공으로 Windows/Office 2016/NASCA 실행을 증명하지 않는다.

기존 Windows 빈 문서 smoke 도구는 [native 쓰기 안내](WINDOWS-OFFICE-WRITE.md)를 따른다. 그 PowerShell 도구는 고정 검사 recipe이며 이 자연어 모델 흐름을 실행하는 제품 호스트가 아니다. 실제 모델 흐름은 기존 호스트의 bound native caller에 skill/편의 함수를 연결한다. Workspace 등록과 실제 Windows 세 앱 실행, NASCA, 저장과 재열기 검증은 후속이다.

실제 호스트 모델과 가상 native 경계를 구분한 [실행 기록](../../docs/research/2026-10-16-document-agent-native-host-model.md)을 따른다.

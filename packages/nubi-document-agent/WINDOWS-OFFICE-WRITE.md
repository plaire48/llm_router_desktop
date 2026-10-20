# 기존 native에 연결한 Office 쓰기

2026-10-16. **Windows 환경이 없어 실제 Office 실행은 아직 하지 않았다.** 로컬 검사는 Node 계약과 자식 프로세스의 증거다. Windows PowerShell 파서, DLL 로드, COM 실행이나 저장 성공으로 표시하지 않는다.

후속으로 모델의 관찰/쓰기/명시적 완료를 연결한 `createNativeOfficeSkill`과 `runNativeOfficeTask`를 추가했다. [기존 호스트 모델 호출](NATIVE-HOST-MODEL.md)을 따른다. 이 페이지의 PowerShell 도구는 계속 고정된 빈 문서 검사 recipe다.

## 호스트 연결

```ts
import {createNativeOfficeWritePort} from '@nubi/document-agent';

const writer = createNativeOfficeWritePort({
  environment: 'windows-office', app: boundOffice.app,
  scope, documentId: boundOffice.documentId,
  officeSessionId: boundOffice.sessionId,
  call: (name, input, signal) => boundOffice.existingNativeTool(name,input,signal)
});
try {
  const receipt = await writer.write({
    summary: '관찰한 문서의 승인된 변경',
    observe: observedNativeGetterSteps,
    steps: proposedNativeSteps,
    checks: expectedNativeChecks,
    // Excel: observed worksheet/range handle, not Application-wide calculation.
    ...(boundOffice.app === 'excel' ? {
      calculateTarget: observedSheetHandle,
      afterChecks: independentlyExpectedCalculatedValues
    } : {})
  }, signal);
  // Present receipt; host owns final save and recovery.
} finally { writer.close(); }
```

이 연결은 기존 native의 `inspect_office` → `execute_office_operations` → Excel의 `calculate_office` → 독립 `inspect_office`를 순서대로 호출한다. `OfficePane`의 기존 경로는 `OfficeAutomationSession.Prepare`, checkpoint, 기존 승인 UI, `ApplyAsync`와 readback을 사용한다. 모델/인증/승인 UI/Office 세션을 새로 만들지 않는다. 호스트는 같은 문서/창에 바인딩하고 각 호출을 UI/STA 스레드에서 직렬 실행해야 한다. 기존 NASCA 파일은 사용자가 Office에서 연 객체를 통해서만 처리한다.

`observe`는 getter만, `checks`는 `{read: getter, equals: expected}`다. 기대값은 null 이외의 JSON 값이며 이 첫 연결은 정확한 값 일치만 검사한다. 기하 오차 허용, delta 또는 locale별 수식 비교는 현재 계약에 포함하지 않는다. `afterChecks`는 원래 변경 검사에 **추가**되며 원래 검사를 대신할 수 없다. 실제 native가 자동으로 추가한 구조/개수 검사도 모두 통과해야 한다. Excel은 관찰한 계산 대상과 실제 계산 완료가 없으면 완료로 표시하지 않는다.

결과 `verified_unsaved`는 변경 영수증과 독립 재읽기가 통과했다는 뜻이다. `savedToOffice:false`, `office2016Verified:false`, `nascaVerified:false`가 남는다. 호스트가 `environment:'windows-office'`를 주입해도 제품/버전/NASCA 증명을 자동으로 만들지 않는다. 연결이 fixture이면 그대로 기록한다. 실제 저장은 기존 호스트 `save_document`의 승인과 검증 계약을 별도로 사용한다.

포트 하나는 한 번의 변경 시도만 처리한다. 이전 바인딩 변경, 취소 또는 close 뒤 응답을 적용하지 않는다. 쓰기 호출을 보낸 뒤 연결이 끊기면 `uncertain`과 `writeDispatched`/`writeResultUncertain`을 남긴다. 같은 쓰기를 재전송하지 않는다. `needs_review`, `uncertain`, 거절/충돌 뒤에는 새 관찰과 기존 호스트의 검토/복구 절차가 필요하다. 영구 checkpoint와 재시작 복구, Workspace 등록과 자동 모델 도구 노출은 이번 연결에 포함하지 않는다.

## Windows의 실제 검사

`scripts/Write-OfficeNative.ps1`은 기존 `OfficeX.Core.dll`/`OfficeX.ExcelHost.dll`/`Newtonsoft.Json.dll`을 재사용하는 개발 도구다. `OfficeAutomationPort.CheckSource`와 `OfficeAutomationSession.Inspect/Prepare/Apply`를 동일한 PowerShell STA 스레드에서 호출한다. COM 객체는 Node로 보내지 않는다. 이미 실행 중인 앱의 **빈 테스트 문서** 하나에 고정된 가상 내용을 작성한다. 기존 회사 문서에서 처음 검사하지 않는다.

필요한 것은 Windows PowerShell 5.1, 해당 앱, 기존 native DLL 폴더와 Node 22.19 이상, 이 패키지의 빌드 결과다. `Version 16.x`는 Office 2016과 Microsoft 365를 구분하지 못하므로 설치 제품을 별도 확인해야 한다. 실행 정책이나 보안 정책을 바꾸지 않는다.

```powershell
powershell.exe -NoProfile -STA -File .\scripts\Write-OfficeNative.ps1 `
  -App word -NativeDirectory 'C:\OfficeX\native' `
  -NodePath 'C:\OfficeX\runtime\node.exe' `
  -ExpectedDocumentName 'Document1' -ReportPath '.\word-write-01.json'
```

문서 이름은 예시이며 앱의 실제 `Name`과 정확히 맞아야 한다. Excel은 `-App excel`, PPT는 `-App powerpoint`로 따로 실행하고 새 보고서 경로를 사용한다. 앱/문서를 열거나 선택/활성화/종료하는 도구가 아니다.

| 앱 | 선행 조건 | 실제로 시도하는 내용 |
| --- | --- | --- |
| Word | 본문이 마지막 문단 기호 하나, 표/필드/인라인 개체/콘텐츠 컨트롤 없음, 읽기 전용 아님 | 가상 문장, 굵게, 문단 뒤 간격 6pt를 쓰고 각각 재읽기 |
| Excel | 시트 1개, 사용 영역 A1 한 셀, A1:C3 값/수식 없음, 읽기 전용/시트 보호 없음 | A1=1, A2=2, B1 수식 `=SUM(A1:A2)`, 굵게. 시트 계산 후 수식과 값 3 재읽기 |
| PPT | 슬라이드 0개인 새 빈 프레젠테이션 | 빈 슬라이드와 텍스트 상자, 가상 문장과 굵게. 슬라이드/도형 수와 글자 재읽기 |

빈 상태 사전 검사와 쓰기에 사용한 관찰 사이에 내용이 바뀌면 중단한다. `Prepare`가 변경 전 전체 관찰을 다시 검사하고 쓰기/검사 입력을 기존 정책으로 사전 검증한다. PowerShell 부모는 Node의 작업 이름/단계/입력을 고정한 recipe와 대조한다. 원래 문서를 직접 덮어쓰는 저장이나 자동 rollback을 하지 않는다. 시험 후 사용자에게 보이는 변경은 열린 테스트 문서에 남는다.

`-Save`를 추가하면 검증된 쓰기 뒤 기존 native의 저장 대화상자를 연다. 사용자가 경로를 선택해야 하며 취소하면 쓰기 성공과 저장 미완료를 분리한다. 저장 결과의 `saved`를 별도로 기록한다. 저장된 파일을 닫고 다시 여는 검증은 아직 없다.

보고서는 쓰기 전에 새 파일로 예약해 이전 근거를 덮어쓰지 않는다. 문서 본문/이름/경로나 저장 경로를 출력하지 않고 DLL/번들 해시, Office/Node 버전과 검증 요약만 남긴다. 실패 뒤 `mutationDispatched:true` 또는 `needs_review`이면 실제 문서부터 확인하고 같은 명령을 반복하지 않는다. 동기 COM 호출이 멈춘 경우 강제 취소를 보장하지 않으며 Office 프로세스를 종료하지 않는다.

현재 결과와 Excel 표시 보완은 [후속 기록](../../docs/research/2026-10-16-document-agent-native-write-preparation.md)을 따른다. 실제 Windows 세 앱의 쓰기/계산/저장 및 NASCA 증거는 이 도구를 그 환경에서 실행한 뒤 추가해야 한다.

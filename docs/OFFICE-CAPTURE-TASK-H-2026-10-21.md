# Task H 실행 통로 확인

**결과:** 구현 전 차단 사항을 발견했다. 계획의 Nubi.Office.Host(ContentPort/NubiPane)는 Office 추가 기능이고 Desktop은 Nubi.OfficeBridge.exe를 사용한다. 두 실행판은 연결되어 있지 않다. Desktop의 `documentForm register`는 `office_capture_template {path,outDir,maxAssets:200,renders:true}`를 보내지만 process 어댑터 허용 목록과 Bridge C# dispatch 모두 이 명령이 없다. 계획은 scopeId 입력을 요구한다.

**재현:** 실제 `openOfficeProcess`에 합성 ready 프레임을 주입하고 캡처를 호출했다. `native_office_method_invalid`, 발행 0회. 원본은 `packages/nubi-desktop/verification/form-cards/task-h-route-probe.json`. 네이티브 실행이나 Office 실측이 아니라 로컬 전송 어댑터 재현이다.

**결정 요청:** 워크플로우 설계 §8 질문34. 공유 C# 캡처를 추가 기능과 Desktop Bridge 양쪽에서 재사용하고 Desktop 명령 허용/dispatch/프로젝트 연결을 범위에 넣을지 확인한다. 이미 선택된 문서와 세션만 대상으로 하고 path는 일치 검사에만 쓴다. 승인/쓰기/저장 동작은 유지한다. 계약 v1, 자산 상대 경로, 원본 불변, Office 2016 채점 기준은 유지한다. 응답 상한에서 자르지 않고 실패한다.

**상태:** 설계 변경 시 질문 후 멈춤 지시에 따라 H 제품 코드와 C# 시험은 아직 작성하지 않았다. 설치판/업로드 없음. Office 2016과 Windows는 연결되어 있지 않으며 COM 실행/렌더/문서 불변/기능 채점은 전부 미검증. 후속 features.mjs를 포함한 실제 채점 전에는 완료로 표시하지 않는다. H 화면 변경이 없어 별도 1280/440 캡처는 해당 없음. Task F 등록/비교 캡처는 별도 보고서에 있다.

# Task F 문서 양식 화면 연결

**결과:** 38차 `10f9c5ac` 계약과 §8 답 33을 적용했다. 실제 FileWorkspace의 docx/xlsx/pptx에 양식 등록/작성 진입을 연결했다. Word의 등록 → 항목 확인 → 요청/자료 선택 → 묶음 질문 → 값과 출처 확인 → 사본 저장 → 필요 시 재승인 → 결과 흐름이다. Excel/PPT는 등록만 가능하며 목록과 결과에 “저장됨, 채우기 준비 중”, 작성 버튼 비활성, questions/plan 호출 차단을 적용했다. fidelity는 “파일만 읽음”/“Office로 확인함”, 없으면 미확인이다. file 엔진으로 자동 우회하지 않는다.

**비교:** `written.compare`를 기존 `NativeDocumentPreview`, `OfficeCompareButton`, `ChangedText`, `NativeChangeDetails`에 연결했다. 바뀐 글자 음영, 누르는 동안 원본, 삽입/삭제 내역을 제공한다. 삽입은 원본 없음과 실제 빈 값을 구분한다. 삭제는 변경 내역에 남긴다. 전체 렌더 그림은 보조이며 렌더/이미지 미확인은 그대로 표시한다. 공유 비교기의 `changes`는 선택적이며 없으면 기존 관찰 비교를 유지한다. Word 변경 부분 보기만 좁은 너비에 재배치해 글자가 작아지지 않게 했고 전체 페이지 보기와 PPT 좌표는 유지했다. Excel 비교기는 수정하지 않았다.

**검증:** 처음 추가한 UI 시험은 fidelity 표시 누락으로 실패했다. 구현 뒤 대비 실패도 고쳐 검사 통과. 집중 20/20(14.515초, 기존 호스트/LibreOffice 시험 포함), 신규 순수 Node 4/4(0.069초, 네이티브 없음). `test:forms-ui` 전체 통과 후 최종 삽입/삭제 보강 UI 재실행 16.239초. 1280/440에서 음영/원본/삽입/삭제, 등록 출처, Excel/PPT 차단, 질문/빈 답, 출처, 원본 덮어쓰기 차단, 재승인, 취소, 상태 조회, 재열기, 늦은 응답 차단과 접근성/디자인 검사 통과. 공유 비교기의 기존 Word/Excel/PPT UI 6장면 통과. design:check와 게이트 집합 통과. 전체 npm test/test:gates 및 Actions는 이번에 실행하지 않았다. 기존 로컬/CI 통과를 새 소스에 소급하지 않는다.

**캡처/원본:** `packages/nubi-desktop/verification/form-cards/`의 `shaded`, `register`, `register-xlsx`, `register-pptx`, `saved-excel`, `request`, `questions`, `ready`, `approval`, `comparison`, `unavailable` 각각 `-1280.png`와 `-440.png`. `result.json`, `task-f-extended-ui.log`, `task-f-extended-ui-final.log`, `task-f-extended-unit.log`, `task-f-new-node.log`, `task-f-native-preview.log`. 화면은 실제 FileWorkspace + 합성 호스트이고 그림도 합성이다. 실제 모델/Office/Windows/설치판 근거는 아니다. 1280/440 음영과 440 등록 결과를 직접 열어 검수했다.

**변경 파일과 SHA:** `.superpowers/sdd/2026-10-21-document-form-task-f-v2/file-list.md`, `upload-inputs.json`, `SHA256SUMS.txt`의 16파일. 공유 변경은 `ui/NativeDocumentPreview.jsx`, `electron-app/FileWorkspace.jsx`, package.json, gate-baseline, 계획/설계 문서다. 새 UI 5, 시험 2, 화면 검사 1, 보고 2 포함. package.json/gate-baseline은 10f9c5ac + Task F 검사 등록만인 업로드 사본이며, 작업 폴더의 M1/T8 등록은 보존했다. 다른 묶음과 함께 올리면 합쳐서 SHA를 갱신한다. 공유 문서도 Claude 최신본과 병합 후 해시 재산출. 업로드는 Claude, push/릴리스 없음.

**남은 위험:** Task H는 실제 Desktop 브리지 연결 범위가 계획과 달라 §8 질문34에서 중단했다. 이 때문에 실제 Office 양식 등록 성공은 미검증이다. 문서 탭 교체 후 계획 재발견 API는 아직 없으며 같은 화면 모달 재열기만 보존한다. Excel/PPT 채움과 트랙4 저작 카드의 1.3.1 이관은 아직 사용자 답 대기다.

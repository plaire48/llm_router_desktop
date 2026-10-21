# T8 호스트 UI 연결과 고정 대화 경합 수정

기준 main `7765864c` (§8 답32). **UI 연결과 로컬 회귀 통과.** 실제 확장/외부 브라우저 왕복은 Claude 후속 실측이며, 이번 결과는 합성 RPC 응답을 쓰는 실제 BrowserPane/SessionSidebar 렌더 검사다.

## 결과와 결정

- 내부 뷰와 외부 탭에 같은 녹화 시작/중지 표시를 둔다. tabs → record start/status/stop → 기존 질문/카드 → test → 캡처 검수 → save(draft) → approve(reviewed)를 `browserTeach`로 연결했다. 닫기는 discard다. 로그인 보호 거절은 안내하고 녹화를 시작한 것처럼 표시하지 않는다. 활성 탭이 하나면 그 탭, 불명확하면 기존 모달에서 사용자가 고른다.
- 호스트의 save/approve는 요약만 돌려주므로 카드 제목/단계는 기존 초안과 합친다. binding/draftKey/영수증/slug/단계 해시/version 검증은 유지한다. observation/capture가 null인 현재 호스트에서는 ‘화면에서 확인’을 비활성화한다. 구조 관찰과 새 실행 엔진/승인 우회는 구현하지 않았다.
- 고정 대화는 첫 paint부터 프로젝트별 기존 고정 목록을 사용하고 호스트 초기화 후 한 목록으로 전환한다. 같은 대화가 다른 그룹으로 이동할 때 list-motion이 삭제 행을 다시 붙이지 않게 했다. main 소스로 strict locator가 같은 summary 2개를 잡는 실패를 재현했고, 수정 뒤 최대1개다. **check-wave2-ui의 선택자와 기대값은 바꾸지 않았다.**
- 늦은 응답이 새 프로젝트 카드/상태를 덮지 않는다. 종료/전환 시 기존 프로젝트에 정리 요청만 한다. 호스트가 현재 프로젝트 불일치로 거절할 수 있으므로 이 경로의 실제 녹화 정리 완료는 보장했다고 표시하지 않는다. 보호 페이지/빈 녹화/탭 선택/프로젝트 변경과 이 거절 경계를 검사했다. 호스트 수명 경계의 실제 확인은 Claude 왕복 때 함께 필요하다.

## 검증과 비용

| 검사 | 결과 |
|---|---|
| 새 연결 검사 | 1280/440, 내부/외부4흐름 + 고정2 + 경계2, exit0, 6.678초 |
| 기존 T8 UI 검사 | 1280/440 질문/번호판/영수증/캡처/늦은 응답/미확정 재실행 차단 통과 |
| 원래 check-wave2-ui | exit0, strict 단언 유지 |
| 집중 Node | 메일/Store/루틴/T8 포함292/292, 46.950초; T8만의 개수로 표시하지 않음 |
| 디자인 / 제품 renderer 빌드 / 게이트 집합 | exit0 |

새 순수Node/네이티브 시험 추가0. 새 화면 검사만 fast ui에 등록했다(로컬 6.678초, 실제 CI 증분은 다음 Actions). 전체 test:gates와 Windows/SSO/실모델 성적은 이번 범위에서 주장하지 않는다. 기존 단위 job 두 분할도 준비돼 있고 워크플로/고정 시험은 같은 명세에 넣었다.

## 캡처와 인계

Desktop 아래 `verification/browser-teach-connection/`의 `internal-plan-{1280,440}.png`, `external-approved-{1280,440}.png`, `pins-{1280,440}.png`. 직접 검토한 440 계획/1280 승인 화면은 기존 deck-dialog/SettingsSection과 공통 토큰을 사용한다. 시작 녹화/계획/승인 네 조합은 같은 폴더에 전부 보존했다. 원본 result.json, main 중복 실패와 늦은 응답 최초 실패 로그는 명세 evidence 목록에 있다.

전체 변경 파일과 SHA: `.superpowers/sdd/2026-10-21-m1a-teach-handoff/upload-inputs.json` teach 그룹. 공유 package.json/gate-baseline의 새 검사 등록 때문에 mail 그룹과 **같이** 지정 업로드한다. 코어/브라우저 실행기/Office 양식 파일은 변경하지 않았다. Office Task F는 Task C 이후다. push/릴리스 없음.

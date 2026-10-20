# T8 카드 UI 로컬 보고

2026-10-21. **화면 조각 검증 완료, 제품 연결 미완료.** 업로드는 Claude. 사용자가 알린 main은82a7e117이고 로컬 `refs/desktop/main`은a4b9c7de다. 현재 작업 폴더에서 검사했으며 최신 후보 트리 통과나 업로드로 표시하지 않는다.

## 결과와 결정

- M1-a30파일과 unit 분할6파일의 기존 SHA 명세를 재대조해 차이0. M1의 동일30만 통 최종 수치는 첫50행711.09ms, 검색p95 406.49ms, RSS169.08MiB다. 기존 메일 회귀254개와 test:mail-ui 통과 자료는 그대로이며 이 턴에 재실행한 성적은 아니다. 두 명세는 `.superpowers/sdd/2026-10-21-{mail-list-m1a-final,ci-unit-split}/upload-inputs.json`이다.
- T4 `draftPlan/questionsFor/applyAnswers/annotationBoard`를 직접 import한다. 질문 알고리즘과 재실행 엔진을 복제하지 않는다. 번호판은 같은 observation/tab/document와 캡처 viewport에 해당하는 box만 비례 표시하고, 번호/targetId를 카드에 저장하지 않는다. 좌표 없는 후보는 목록에서만 표시한다.
- 기존 SettingsSection/SettingsField/CxSelect/DetailPanel(deck-dialog)/CaptureChips 사용. 공통 토큰, hairline, outline 아이콘, 주 동작1개를 사용한다. 메일/위키 출처는 항목명/페이지 참조, 고정값은 literal_pending만 저장하며 실제 값은 받지 않는다.
- 답 수정은 시험 결과를 무효화한다. 프로젝트/세션/리비전/카드 변경 뒤 늦은 응답은 버린다. 실행 응답 분실은 미확정으로 표시하고 재실행을 막는다. 캡처 검수와 영수증 없이는 승인 버튼이 활성화되지 않는다. 서버 승인 대체가 아닌 UI 방어다.

## 검증

| 검사 | 결과 / 비용 |
|---|---|
| 실패 시험 → 구현 | 새 투영 모듈 부재로 실패 후 구현 |
| 새 순수 Node 시험 | 3/3,109.22ms, 네이티브 실행 없음 |
| CI 분할 포함 집중 시험 | 9/9,160.35ms |
| `node scripts/check-browser-teach-ui.mjs` | 1280/440 흐름 통과,4.11초. 번호 좌표/편집 뒤 무효화/늦은 응답/미확정 재전송 금지/콜백 없을 때 차단 |
| 공통 검사 | sourceDesignIssues 색/레이아웃/모션0, captureDesign과 접근성(이름/대비/모달 양방향Tab) 통과, design:check와 gate-coverage 통과 |

최초 화면 검사에서 잘못된 아이콘 이름과 긴 카드의 스크롤 누락을 발견해 수정했다. 최종 대비 검사는 활성화 전환이 끝난 뒤 실행한다(일시 opacity0.5267을 예외로 면제하지 않음). 전체 test:gates와 실제 Electron/확장/회사 SSO/Windows는 이번 T8에서 실행하지 않았다. T8 화면 검사는 아직 fast 체인에 추가하지 않았다. 새 시험1파일은 기존 이름순 unit 분할에 자동 포함되며 CI 실소요는 미측정이다.

캡처3쌍과 결과: `packages/nubi-desktop/verification/browser-teach-ui/{plan,board,review}-{1280,440}.png`, `result.json`, `check.log`, `unit.log`, `design.log`. plan은 질문, board는 번호판 모달, review는 캡처 검수와 승인 카드다. 합성 브라우저 이미지/호스트 포트이며 실제 외부 브라우저 실행 영수증이 아니다.

## 연결 대기와 잠정 인터페이스

**§8 질문32 답 전 제품 연결을 멈춘다.** ProjectService에 T8 호출 경로가 없고 T6 browser.script는 승인된 저장 카드만 실행한다. 보호된 브라우저 모듈/저장기/어댑터를 수정하거나 reviewed를 임의 주입하지 않았다. Office TaskF와 저작 카드, Windows 따라붙이기는 시작하지 않았다.

UI 입력은 `{binding:{projectId,sessionId,revision},card,observation,capture}`다. 캡처는 `{observationId,tabId,documentId,viewport:{x,y,width,height},width,height,dataUrl}`로 현재 관찰의 좌표계를 명시한다. 호스트 제공 `onTest({binding,draftKey,card})`는 같은 binding/draftKey와 receiptId/success/captures를 반환한다. `onSave`는 draft script의slug/hash/version을, `onApprove`는 같은script의reviewed 결과를 반환한다. 승인 요청에는 receiptId와 검수captureIds가 있다. **이 포트 형식은 UI 검사용 잠정 계약이다.** 호스트는 클라이언트 값으로 권한을 판정하지 않고 현재 세션/카드/탭과 원본 영수증을 다시 검사해야 한다. 기존 T4의 guard 문구와 fill_form 첫필드 투영을 그대로 사용하며 모듈 동작을 UI에서 보정하지 않았다.

## 변경 파일과 SHA

명세 `.superpowers/sdd/2026-10-21-browser-teach-t8-ui/upload-inputs.json`, frozen 파일과 증거 명세 `evidence.json`. 다음10파일만 이번 T8 범위다. 공유 문서2개는 Claude의 최신 문서에 이 변경만 합친다.

1. `packages/nubi-desktop/ui/BrowserTeachPanel.jsx`
2. `packages/nubi-desktop/ui/BrowserScriptCard.jsx`
3. `packages/nubi-desktop/ui/browser-teach-view.mjs`
4. `packages/nubi-desktop/ui/browser-teach.css`
5. `packages/nubi-desktop/tests/browser-teach-view.test.mjs`
6. `packages/nubi-desktop/tests/browser-teach-ui-fixture.jsx`
7. `packages/nubi-desktop/scripts/check-browser-teach-ui.mjs`
8. `docs/BROWSER-TEACH-T8-UI-2026-10-21.md`
9. `docs/superpowers/plans/2026-10-21-nubi-browser-teach.md` (공유, T8 진행만)
10. `docs/superpowers/specs/2026-10-18-nubi-workflow-agent-design.md` (공유, §8 질문32만)

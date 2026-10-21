# Word 양식 질문과 기존 비교 화면 — 2026-10-21

## 결과와 결정

사용자 요청대로 기존 SettingsField와 공통 입력/버튼을 재사용했다. 양식 질문은 문서의 항목 묶음을 유지하며 한 화면 최대 네 개로 나눈다. 이전/다음 이동은 호스트를 호출하지 않으며 선택값과 직접 입력한 답을 보존한다. 여러 화면인 경우 마지막 답변 검토에서 한 번만 전송한다. 선택형은 options와 직접 입력 허용값을 따르고, 예/아니오는 초기 미선택 두 버튼, 그림은 Workspace 상대 PNG/JPEG 선택, 날짜는 날짜 입력이다. 보호 양식은 preview.notFillable 사유와 비활성 작성 버튼을 보인다.

질문 상태의 축약 DTO에 없는 options/freeText는 동일 hash의 questions 응답에서 slot으로 결합한다. 다른 원본의 옵션을 재사용하지 않는다. 호스트 계약과 Word 처리 코드는 바꾸지 않았다.

변경 위치는 기존 NativeDocumentPreview의 음영 비교, 머리글/바닥글, 원본 잠깐 보기를 그대로 쓴다. 기존 전후 렌더 이미지도 유지하고 회귀 검사했다. 현재 호스트는 written 뒤에만 렌더를 제공한다. 질문 중 실시간 문서 렌더나 저장 전 렌더를 구현했다고 표시하지 않는다. Excel/PPT 채우기 범위도 확대하지 않는다.

## 검사

| 검사 | 결과 |
|---|---|
| 실패 시험 먼저 | 기존 화면에서 선택형 combobox 부재로 실패. 메타/페이지 helper 미구현 실패도 기록 |
| Desktop 집중 회귀 | 16/16, 13.20초. 기존 문서 생성/검사/LibreOffice 렌더 포함 |
| 질문 view 단위 | 7/7, 75.74ms. 새 시험 3개는 순수 Node, 네이티브 실행 없음 |
| Office 양식 집중 | 45/45, 425.68ms |
| check-form-cards-ui | 1280/440 모두 통과. 4개 표시, 답 보존, 최종 1회 전송, 보호 이유, 기존 음영/렌더/머리글/바닥글/원본 보기 포함 |
| design:check / build:electron | 모두 exit 0. 빌드의 windows-bash-process CJS import.meta 경고는 남음 |

Office 전체의 수정 전 기준선은 1,318개 중 1,311 통과, 기존 7실패, 148.30초다. 실패 위치: connection-recovery:18, form-focus:82, live-findings:624, model-catalog-ui:10, tool-schema-recovery:51 및 :72, ui-parity:6 (모두 packages/nubi-office/tests/*.test.mjs). 이 실패들은 이번 화면 변경 전 재현했으며 수정하지 않았다. 전체 test:gates와 Windows Office 2016, 설치판, 실제 모델 검사는 이번 결과에 포함하지 않는다. 새 단위 시험의 CI 소요는 아직 미측정이며 unit 작업은 추가하지 않았다.

## 변경 파일과 인계

기준 f20a7edd. 제품/검사 9파일과 이 보고서만 인계한다.

- packages/nubi-desktop/ui/FormQuestionField.jsx (신규)
- packages/nubi-desktop/ui/FormFillCard.jsx
- packages/nubi-desktop/ui/DocumentFormControl.jsx
- packages/nubi-desktop/ui/FormRegisterCard.jsx
- packages/nubi-desktop/ui/form-cards-view.mjs
- packages/nubi-desktop/ui/form-cards.css
- packages/nubi-desktop/tests/form-cards-view.test.mjs
- packages/nubi-desktop/tests/form-cards-ui-fixture.jsx
- packages/nubi-desktop/scripts/check-form-cards-ui.mjs
- docs/WORD-FORM-UI-2026-10-21.md

명세: `.superpowers/sdd/2026-10-21-word-form-ui/SHA256SUMS.txt`, `files.json`. 같은 폴더 frozen/에 후보 바이트를 고정한다. package.json과 게이트 집합 변경은 없다. 업로드와 릴리스는 Claude 담당이다. 승인 대기 safety-public-reviews 3파일은 이번 작업에서 수정하지 않았다. 최종 대조에서 mjs와 시험은 시작 SHA와 같지만 JSON은 다른 작업으로 변경되어 있었다. 이 JSON을 되돌리거나 인계 묶음에 포함하지 않았다.

## 캡처와 남은 경계

캡처: `packages/nubi-desktop/verification/form-cards/typed-questions-{1280,440}.png`, `typed-date-{1280,440}.png`, `typed-review-{1280,440}.png`, `typed-register-{1280,440}.png`, `protected-{1280,440}.png`, `shaded-{1280,440}.png`, `comparison-{1280,440}.png`. 합성 호스트 화면이며 실제 Office 렌더 수용을 대신하지 않는다. 로그와 결과는 `verification/word-form-ui/`에 보존한다. 기존 source hash가 달라 옵션을 못 받으면 입력을 임의 추정하지 않고 재선택 안내한다.

# 녹화 UX 네 원칙 반영

사용자 지시 2026-10-21. 이전 T8 연결 위에 적용했다. 업로드는 Claude이며 이전 53파일 인계의 고정 사본은 덮어쓰지 않았다.

- 시작 전 요청한 안내 한 문단을 표시한다. 좁은 창에서는 자연스럽게 줄바꿈한다. 녹화 중에는 동작 수와 중지만 표시하고 목적/값 출처/이유를 묻지 않는다.
- 중지 후 목적 한 줄을 확인한다. 기존 T4 questionsFor의 네 가지 값 출처를 그대로 사용하고 기본값은 ‘실행 때 묻기’다. 조심할 단계의 이유 질문도 기존 모듈을 재사용한다.
- 이름 없는 입력 칸에 ‘입력값 N 이름’ 필드를 추가했다. 입력 슬롯/단계/선택자/시연 값은 불변이고 inputs[].label만 수정하며 표시 질문과 ask 라벨에 반영한다. 이미 이름이 있는 칸은 바꾸지 않는다. 라벨은 메타데이터이므로 UI draftKey의 실행 내용에는 포함하지 않아 **시험 뒤 라벨만 수정해도 기존 영수증으로 저장/승인**한다. 목적/값 출처/이유 변경의 기존 무효화와 미확정 실행 재시도 금지는 유지한다.
- 시험 확인 모달에 ‘녹화 때 입력한 값으로 한 번만 실행합니다’를 명시했다. 녹화 값의 보존/필터/재생 책임은 기존 호스트 그대로다. 브라우저 코어와 Office 런타임은 수정하지 않았다.

검증: 새 회귀2개가 수정 전 실패함을 확인했다. 최종 projection+기존 호스트 **8/8, 실패0, 1.925초**. 신규2개는 순수 Node **0.123초**, 새 네이티브 시험0. 호스트 검사 첫 시도는 병행 문서 서비스 import 파일 생성 전 MODULE_NOT_FOUND로 실패했고 파일 생성 후 같은 검사로 통과했다. 제품 임시 우회는 넣지 않았다. 두 화면 검사 모두 exit0(1280/440, 내부/외부), 안내/녹화 중 무질문/목적/기본값/라벨 편집/추가 재생 없는 저장/단계 불변/확인 문구를 검사했다. 디자인, renderer 빌드, 게이트 집합도 통과했다. 전체 gates/Windows/실제 외부 브라우저 왕복을 이번에 실행했다고 표시하지 않는다.

캡처와 원본: `packages/nubi-desktop/verification/browser-teach-ux/`. `connection-internal-intro-{1280,440}.png`, `connection-internal-confirm-{1280,440}.png`, `panel-plan-{1280,440}.png`, `panel-review-{1280,440}.png`. 440 안내/확인 화면을 직접 검토했다.

SHA 명세: `.superpowers/sdd/2026-10-21-browser-teach-ux/upload-inputs.json`(이 보고서 포함10파일). 이전 `.superpowers/sdd/2026-10-21-m1a-teach-handoff/upload-inputs.json`의 T8 연결을 선행으로 하고 겹치는 파일은 **이 명세가 최신**이다. 병행 중인 project-service/문서 양식 변경은 이번 명세에 넣지 않았다. 실제 main 후보 검사는 Claude 업로더에서 수행해야 한다.

## 변경 파일

- `packages/nubi-desktop/ui/BrowserTeachControl.jsx`
- `packages/nubi-desktop/ui/BrowserTeachPanel.jsx`
- `packages/nubi-desktop/ui/browser-teach-view.mjs`
- `packages/nubi-desktop/ui/browser-teach.css`
- `packages/nubi-desktop/tests/browser-teach-view.test.mjs`
- `packages/nubi-desktop/tests/browser-teach-host.test.mjs`
- `packages/nubi-desktop/tests/browser-teach-ui-fixture.jsx`
- `packages/nubi-desktop/scripts/check-browser-teach-ui.mjs`
- `packages/nubi-desktop/scripts/check-browser-teach-connection.mjs`
- `docs/BROWSER-TEACH-UX-2026-10-21.md`

# 머리글 비교와 POP3 대체 연결 화면

**결과:** 기존 NativeDocumentPreview에 `written.compare.before/after.headers/footers` 줄을 추가했다. 변경한 글자는 기존 음영 비교를 사용하고 원본 보기 동안 이전 글자를 표시한다. 머리글 칸 채우기 기능은 추가하지 않았다. Excel/PowerPoint는 기존 “저장됨, 채우기 준비 중”을 유지한다.

Claude의 MailLibrary 제품 구현은 바꾸지 않았다. `check-mail-ui`에 호스트가 fallback='pop3'를 보낸 경우의 카드, 전송 직후/대기/실패/재시도 성공/닫고 다시 열기의 비밀번호 비우기를 추가했다. 합성 계정만 사용했다.

검증: 양식 UI 1280/440 모두 통과, 기존 Office UI 6장면 통과, 메일 UI 13개 통과. 디자인 검사와 접근성 검사 통과. 처음 머리글 변경 음영의 글자 대비 4.49:1을 발견해 해당 줄의 글자를 기본 본문 토큰으로 바꿨다. 네 캡처를 직접 열어 확인했다. 실제 POP3 계정/Office/회사 PC 검증은 포함하지 않는다. 새 Node 시험 0, 기존 화면 검사에 장면 추가. 전체 gates는 실행하지 않았다.

캡처(접두 `packages/nubi-desktop/verification/`): `form-cards/comparison-1280.png`, `form-cards/comparison-440.png`, `mail/pop3-fallback-1280.png`, `mail/pop3-fallback-440.png`. 원본 보기와 문단/표 비교 검사를 유지했다. 새 머리글/바닥글은 본문과 구별해 제목과 가는 선으로 표시한다.

변경 파일: ui/NativeDocumentPreview.jsx, ui/native-document-preview.css, tests/form-cards-ui-fixture.jsx, scripts/check-form-cards-ui.mjs, tests/mail-fixture.jsx, scripts/check-mail-ui.mjs (모두 packages/nubi-desktop 아래)와 이 보고서. SHA와 frozen 사본은 `.superpowers/sdd/2026-10-21-office-mail-ui/upload-inputs.json`, `SHA256SUMS.txt`다. 업로드는 Claude 담당이다.

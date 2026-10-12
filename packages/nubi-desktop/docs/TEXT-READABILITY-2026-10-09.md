# Electron text readability

사용자 요청에 따라 글자만 먼저 개선했다. 레이아웃, 브랜드 배경, 아이콘, 모션과 실행/승인 흐름은 유지한다.

- 본문과 입력은 16px / 행간 1.75, UI는 15px / 1.6, 보조 글자는 14px / 1.5다. rem 토큰으로 글자 확대에 대응한다.
- 본문 400, 목록 500, 핵심 강조 600으로 굵기를 구분한다. 버튼과 설명의 압축 자간을 제거하고 한글 단어 단위 줄바꿈과 긴 문자열의 안전한 줄바꿈을 유지한다.
- 보조 글자는 `#596574`로 조정한다. 흰색, 옅은 배경과 선택 배경에서 계산 대비는 각각 5.93:1, 5.50:1, 5.21:1이다. 파랑 링크와 상태 색, 코드 고정폭 글꼴은 유지한다. Windows fallback에 Malgun Gothic을 포함한다.
- 기존 공통 Nubi/CX 컴포넌트를 재사용한다. 새 글꼴이나 패키지는 추가하지 않는다. 수치와 색은 중앙 identity 토큰에 두고 Electron의 마지막 typography 스타일에서 적용한다.

방법론은 [W3C 텍스트 간격](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)과 [최소 대비](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)를 참고했다. 간격 수치는 기본 디자인의 의무값이 아니라 사용자 간격 변경 시 내용과 기능 보존을 확인하는 기준이다. 기존 폰트/CX와 CSS 토큰으로 개선할 수 있어 추가 오픈소스 의존성은 도입하지 않았다.

검증은 `npm run build:electron`, `npm run design:check`와 별도 임시 실행기에서 수행했다. 로컬 macOS Electron의 실제 로그인, 설정과 메일 연결 모달을 확인했다. 대화/입력/모델 선택은 공통 Workbench와 Electron의 전체 CSS를 사용한 합성 상태로 확인했다. 1280/900/760px, 200% 루트 글자 확대와 본문의 사용자 간격 변경을 확인했고 입력 초안은 유지됐다. 캡처와 측정값은 `verification/typography/`에 있다.

전체 기능 게이트, 실제 모델 답변, Windows 설치판/Office/NASCA는 이번 검증 범위가 아니다. 큰 글자 설정의 실제 연결은 기존 화면에서 `data-large-text=false`로 고정돼 있으므로 루트 글자 확대 검사와 구분한다. 큰 글자용 토큰은 기존 계약에 맞춰 갱신했다.

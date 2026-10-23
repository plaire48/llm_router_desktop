# 시작 컷신 브랜드와 Windows 창 버튼

2026-10-23 사용자 요청: 바뀐 로고와 새를 컷신에도 적용하고 `1.3.0`을 로고 아래에 표시한다. Windows에서 컷신 동안 최소화, 최대화와 닫기 버튼을 보이지 않게 한다.

## 반영

- `ui/WorkspaceBrand.jsx`에 컷신 변형을 추가했다. 도구 줄과 같은 원본 새 이미지, 다섯 표정과 워드마크 마스크를 사용한다. 기존 비행 장면과 종료 시점은 유지한다. 컷신 버전은 20~24px/600으로 강조하고 높이 10px 막대와 준비 상태를 표시한다. 준비 중은 불확정 상태이며 실제 ready 후에만 100%를 표시한다.
- `ui/CinematicIntro.jsx`는 공통 브랜드와 빌드의 `__NUBI_VERSION__`을 표시한다. 패키지, Electron 패키지와 잠금 파일의 현재 버전은 이미 `1.3.0`이며 문자열로 버전을 복제하지 않았다. `ui/app-version.mjs`를 컷신, 도구 줄과 진단 문구가 공유한다. 도구 줄과 보조 호스트 로고의 Beta를 숫자 버전으로 바꾸고, 설정의 제품명에서 Beta를 제거했다. 창 제목과 빌드한 HTML 제목은 실제 패키지 버전을 따른다. 좁은 창에서도 14px 숫자 배지는 보인다.
- 공통 광학 크기와 마스크는 `design/workspace-icons.css`, 컷신 크기는 `design/workspace-identity.css`에서 관리한다. 흰 타이틀 바탕과 기존 글꼴을 유지하고 320px 창에서도 제품명과 버전을 표시한다.
- `electron-app/opening-caption.cjs`와 main의 기존 신뢰된 IPC를 연결했다. Windows는 생성 시점부터 투명한 WCO를 사용하고 컷신 중 최소화/최대화/닫기 기능을 비활성화한다. 최소화와 최대화는 숨겨지고 남은 닫기 버튼은 비활성 상태에서 투명하게 그려져 hover로 되살아나지 않게 한다. 테마 변경은 캐시하고 완료 시 최신 색과 기본 창 기능을 복원한다. 별도 전체 화면이나 컷신 창은 만들지 않는다.
- 새로고침 때 다시 적용하며 렌더러 종료, 주 문서 로딩 실패, 응답 없음과 앱 종료 시 복원한다. macOS와 Linux 창 동작은 유지한다.

## 검증

- `npm run design:check` 통과.
- `npm run build:electron` 통과. 기존 Windows Bash CJS `import.meta` 경고가 남고 macOS에서 PowerShell 검사는 건너뛰었다.
- `node --test tests/opening-caption.test.mjs tests/opening-scene.test.mjs tests/titlebar-colors.test.mjs tests/mail-connection-errors.test.mjs`: 20/20 통과. Windows 생성 옵션, 컷신 중 색 변경 격리, 완료와 재진입 복원, 잘못된 입력, 파괴된 창과 타 플랫폼 경계를 확인했다. 네이티브 창 호출은 모의 객체로 확인했다. 버전 표기를 공유한 메일 진단의 기존 경계도 확인했다.
- `node verification/cinematic-brand-1.3.0/check.mjs`: 실제 빌드한 macOS Electron에서 9개 검사와 준비 대기를 제어한 컴포넌트 fixture 1개 검사 통과. 별도 임시 저장소로 전체 비행, 새 로고/버전 표시, 다섯 표정의 원본 해시, 주변 도구 줄, 종료 후 메뉴 클릭과 모달 반복 열기/닫기, 440px 짧은 시작 화면과 320px 모션 감소 화면을 확인했다. 24px/600 버전, 10px 막대, 실제 준비 완료의 100%와 440px 도구 줄 버전 가시성도 확인했다. 별도 Electron fixture는 실제 컴포넌트의 ready를 false에서 true로 바꿔 대기 상태와 완료를 확인했다. 개발 앱의 자동화 생략을 해제하는 webdriver 변경은 검사에만 주입한다.
- 첫 검사에서 모달 전환 도중 소수점 크기를 비교한 실패가 발생해 유한 애니메이션 종료 후 검사하도록 고쳤다. 좁은 화면 모달은 기존 bottom sheet의 아래 모서리가 0이므로 넓은 모달의 동일 반경 단정 대신 실제 화면 경계와 닫기 크기, 공통 `captureDesign` 검사를 사용했다. 제품의 모달 코드는 변경하지 않았다. 컷신 뒤 모달 재열기/닫기는 실제 X 버튼 클릭으로 검사했다. 중간 자동화에서 Escape 닫기 대기 실패도 관찰되어 해당 키보드 경로는 이번 통과 항목에 포함하지 않았다.

결과와 캡처는 `verification/cinematic-brand-1.3.0/result.json`, `title-wide.png`, `title-narrow.png`, `title-reduced-320.png`, `workspace-after-cutscene.png`에 있다. 실행 중인 사용자 앱은 재시작하지 않았다.

실제 Windows의 native WCO 그림, hover와 클릭, 설치 후 실행과 최대화/DPI 조합은 미검증이다. Windows 설치 안내와 BrandingText는 빌더가 제공하는 `${VERSION}`, 제거 프로그램 이름은 `${version}`을 표시하도록 소스를 맞췄다. 설치 파일을 새로 만들거나 배포하지 않았다.

## 구현 근거

설치된 Electron 42.11.10의 [WCO 갱신 구현](https://github.com/electron/electron/blob/v42.11.10/shell/browser/native_window_views.cc), [버튼 가시성과 비활성화](https://github.com/electron/electron/blob/v42.11.10/shell/browser/ui/views/win_caption_button_container.cc), [투명 색과 hover 그리기](https://github.com/electron/electron/blob/v42.11.10/shell/browser/ui/views/win_caption_button.cc)를 대조했다. 공개 `setTitleBarOverlay`는 색과 높이를 바꾸며 실행 중 overlay 자체를 끄는 API는 제공하지 않는다. 투명 색과 비활성화를 함께 사용하는 것은 이 소스에서 도출한 구현이며 Windows 실측 성공 근거는 아니다.

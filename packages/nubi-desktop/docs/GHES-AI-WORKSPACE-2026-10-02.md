# Desktop 내부 AI Workspace

사용자 결정: AI Workspace는 GHES의 기존 정적 화면을 누비 Desktop 안에서 연다. 화면과 공유 목록의 관리 원본은 `Manufacturing-IT/ai_workspace`의 `main` 한 곳이다. Desktop용 업무 데이터베이스나 화면 복사본을 만들지 않는다.

## 화면과 데이터

- 왼쪽 AI Workspace 버튼과 스킬 화면의 AI Workspace 동작은 오른쪽 보조 영역을 연다. 중앙 에이전트는 유지한다.
- GHES 연결이 없으면 기존 Desktop 계정 연결 화면으로 이어진다. 연결이 끝나면 요청한 AI Workspace를 연다.
- `main`의 커밋을 먼저 고정하고, 해당 tree의 `index.html`, `assets/`, 아이콘과 폰트를 읽는다. blob의 크기와 Git SHA를 확인한다. 저장소에 배포된 빌드 파일이 있어야 한다.
- 기존 정적 화면의 목록 조회, 앱과 Agent 등록/편집/삭제, 스킬 카탈로그의 Git 저장 경로를 재사용한다. 실제 권한은 기존 화면의 역할 조회와 GHES 서버가 판단한다.
- 화면 파일은 열린 동안 같은 버전이다. 목록과 업무 데이터는 기존 클라이언트가 GHES API의 현재 브랜치와 불변 커밋에서 다시 읽는다. UI 버전과 데이터 버전은 구분한다.
- 보조 영역을 닫거나 다른 파일을 열어도 iframe을 유지해 편집 초안을 보존한다. 명시적인 새로고침만 새 GHES 화면을 받는다. 새 화면 준비가 실패하면 기존 화면을 유지한다.
- 조회 실패를 이전 데이터의 성공으로 바꾸지 않는다. Desktop 호스트 오류는 공통 2초 토스트로 표시한다. 정적 앱 내부의 오류 표시는 그 앱의 기존 CX를 따른다.

## 인증과 호스트 경계

Desktop의 기존 GHES 계정을 재사용한다. 실제 토큰은 native 계정 저장소와 native 요청에만 사용한다. 정적 화면의 기존 세션 인터페이스에는 무권한 문자열 `nubi-desktop-session`과 사용자 표시 정보만 제공한다. 이 문자열로 GHES를 직접 인증할 수 없다.

전용 임시 loopback 서버가 GHES에서 받은 화면 파일을 제공한다. 접속 주소는 실행마다 바뀌며 native API는 동일 origin과 일회성 보기 키를 검사한다. 토큰과 업무 파일을 별도 디스크 캐시에 저장하지 않는다. 인증 갱신, 로그아웃, 토큰 거부와 만료는 기존 계정 계약을 따른다. 계정 무효화 시 서버와 메모리 캐시를 닫는다.

정적 화면은 다른 origin의 iframe에서 실행한다. Node 접근과 Desktop preload/IPC를 주지 않으며 상단 이동과 새 창 생성을 허용하지 않는다. 기존 `contextIsolation`, `sandbox`, IPC의 main-frame 검사를 유지한다. frame의 CSP는 자체 스크립트만 허용한다. 파일 편집, 셸, Office 쓰기와 A2A 권한은 이 화면에 연결하지 않는다.

## Git 저장

기존 `githubTransaction.js`의 snapshot/head/예상 blob 확인, 변경 blob 준비, tree/commit 생성, `force:false` ref 갱신과 저장한 커밋의 대상 파일 재조회를 재사용한다.

Native 중계는 같은 저장소의 읽기와 다음 쓰기만 허용한다.

- `POST git/blobs`, `POST git/trees`, `POST git/commits`
- `PATCH git/refs/heads/main`의 `force:false`
- 대상 파일: `data/**/*.json`, 기존 스킬 marketplace JSON과 `plugins/<name>/` 파일

tree는 중계에서 만든 blob과 허용된 경로만 사용한다. commit의 tree는 정확한 부모 tree에서 파생되어야 한다. 공개 manifest를 별도 commit으로 만드는 기존 저장도 같은 기준 HEAD의 하나의 게시 요청으로 처리한다. 게시가 끝난 부모를 다음 저장의 새 기준으로 삼는다.

브랜치 변경 직전에 native 확인창이 저장소, 브랜치, 메시지와 변경 경로를 보여준다. 확인 전후 HEAD가 달라지면 저장을 멈춘다. GHES의 브랜치 보호와 권한 제한을 우회하지 않는다. 응답이 유실되면 native 중계는 쓰기를 재전송하지 않으며 기존 앱이 ref와 커밋을 읽어 결과를 확인한다. 확인창에서 취소하면 브랜치를 변경하지 않는다. 준비한 미게시 Git 객체는 GHES에 남을 수 있다.

## 현재 범위

기존 정적 화면 전체를 제공하지만 모든 외부 연계가 Desktop 연계로 전환된 것은 아니다. 조직/팀 멤버십을 바꾸는 API는 이 중계의 쓰기 범위가 아니다. Codex/Claude 설치 링크, 외부 서비스 페이지와 사이트별 로그인은 누비 스킬 설치나 실행 완료로 표시하지 않는다. 누비의 기존 스킬 관리와 설치 실행기는 별도 계약을 유지한다. 실제 정적 앱에 새 기능이 필요하면 원본 GHES 프로젝트에서 변경한다.

외부 브라우저 자동화로 AI Workspace를 관리하는 경로를 선택하지 않았다. 화면 복제와 별도 저장 서버도 추가하지 않았다. 기존 정적 앱, native 인증 중계와 Git의 불변 버전/비강제 ref 갱신을 조합했다. 새 패키지 의존성은 추가하지 않았다.

참고한 BP: [Electron의 격리와 IPC 보안](https://www.electronjs.org/docs/latest/tutorial/security), [GHES Git reference 갱신 계약](https://docs.github.com/en/enterprise-server@3.17/rest/git/refs#update-a-reference). 문서 버전은 배포 GHES 버전 확인을 대신하지 않는다.

## 확인 범위

2026-10-02: `npm run build:electron`이 최종 소스 기준으로 종료 코드 0을 반환했다. 생성된 main 번들에 native AI Workspace 중계가 포함된 것을 확인했다. 사용자 요청대로 테스트는 실행하지 않았다.

실제 GHES 계정의 열기/등록/수정/삭제, Windows 설치판과 실제 스킬 설치는 이번 변경의 검증 범위에 포함하지 않는다. 실행 중인 Electron 앱은 재시작하지 않았다. 로컬 원본 정적 앱의 소스와 API 계약을 확인했으며 빌드 성공을 실서비스 성공으로 표시하지 않는다.

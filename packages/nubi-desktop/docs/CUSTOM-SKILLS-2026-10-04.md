# 커스텀 스킬 관리

2026-10-04 사용자 결정

## 화면과 흐름

스킬 관리의 두 영역은 **AI Workspace / 커스텀 관리**다. 회사 SSO와 Git 기반 설치는 AI Workspace에 유지한다. 로컬 등록은 커스텀 관리의 **등록** 한 동작에서 시작한다. 등록 화면에는 선택 버튼 하나와 같은 끌어놓기 영역만 두고 ZIP/폴더 등록을 구분하지 않는다. 실제 입력의 형식을 판별해 폴더, ZIP, SKILL.md와 일반 .md를 기존 등록기로 전달한다. macOS의 선택창은 파일/폴더를 함께 받으며 Windows/Linux의 네이티브 선택창은 ZIP/Markdown을 받는다. Windows/Linux 폴더는 같은 등록 영역에 끌어놓아 받는다. [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)의 파일/폴더 동시 선택 제한에 따라 형식별 버튼을 다시 노출하지 않는다.

등록 목록은 아이콘, 이름, 짧은 설명과 작은 수정/삭제 버튼으로 구성한다. 수정은 기존 파일 탭의 Monaco와 저장/undo/hash/readback 계약을 사용한다. 삭제는 현재 패키지를 읽어 확인한 뒤 해당 해시와 일치할 때만 휴지통으로 이동한다. 휴지통은 같은 목록 형태로 복원하며 같은 이름의 현재 폴더를 덮어쓰지 않는다. 여러 번 삭제하거나 같은 이름을 재등록해도 개별 삭제 영수증을 유지한다. 등록, 삭제, 복원 결과는 공통 2초 CX 토스트로 표시한다. 확인/등록 모달은 같은 X와 Escape/초점 복원을 사용하고 바깥 클릭으로 닫히지 않는다.

## 실제 구현과 도입 근거

- 기존 Pi/Agent Skills 계약을 유지한다. 폴더와 ZIP에는 하나의 SKILL.md가 필요하다. 단일 Markdown은 SKILL.md로 정규화하며 frontmatter가 없다면 안전한 ID와 짧은 description을 만들고 기존 본문을 보존한다. 기존 frontmatter가 있으면 검증하고 덮어쓰지 않는다. 자료 파일과 하위 폴더를 함께 보존한다. [Agent Skills specification](https://agentskills.io/specification)
- 기존 YAML 파서, yauzl, SQLite 영수증, Monaco와 CX 컴포넌트를 재사용한다. 새 패키지를 추가하지 않는다. archive 경로를 직접 추출하지 않고 기존 경로/CRC/중복/용량/링크 검사와 staging/readback을 유지한다.
- Electron의 `webUtils.getPathForFile`을 preload에서 사용해 실제로 끌어놓은 File의 경로만 신뢰된 main IPC에 전달한다. 경로를 renderer/원격 페이지/모델에 공개하지 않는다. generic importSkill RPC는 계속 차단한다. [Electron webUtils](https://www.electronjs.org/docs/latest/api/web-utils), [Electron dialog](https://www.electronjs.org/docs/latest/api/dialog)
- 수정으로 스킬 메타데이터가 잘못되어도 관리 목록에서 지침을 다시 열 수 있다. `unavailable`은 실행 가능한 `skills` 배열과 분리하고 삭제/복원은 소유한 패키지의 현재 bytes를 확인한다. 삭제 백업은 숨김 폴더라 에이전트 카탈로그에 포함되지 않는다. 스크립트/훅은 등록만으로 실행하지 않는다.

## 확인 범위

Electron build: `npm run build:electron` 완료. 자동 테스트는 사용자 결정에 따라 실행하지 않았다.

예시 데이터 웹 화면에서 커스텀 목록, 등록 화면, 삭제 확인, 휴지통 이동/복원과 등록 후 목록 복귀를 수동 확인했다. 실제 사용자 파일 등록이나 삭제를 한 결과가 아니다. native chooser/drop, 실제 Windows 설치판과 실계정 GHES는 별도 미검증이다. 실행 중 앱과 인증 정보는 재시작하지 않고 보존했다. 스킬 수정 버튼으로 SKILL.md가 개별 편집 탭에 열리고 Markdown/YAML 내용이 표시되는 것도 예시 화면에서 확인했다.

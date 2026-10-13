# Windows 1.1.5 Beta mail content hotfix

빈 text/plain과 HTML 본문이 함께 있는 MIME 메일에서 HTML 본문을 텍스트로 읽습니다. 이전 버전은 빈 텍스트를 선택하여 제목만 표시할 수 있었습니다.

본문에 삽입된 CID 이미지와 명시적인 파일 첨부를 구분합니다. 본문 이미지는 첨부 목록, 개수, 첨부 조건 검색에서 제외합니다. 명시적인 파일 첨부와 원본 EML은 보존합니다. 외부 이미지를 불러오거나 메일 HTML을 화면에서 실행하지 않습니다.

기존 저장 메일도 검증된 원본 EML에서 본문과 MIME 역할을 복구합니다. 원본/manifest/receipt 해시는 바꾸지 않습니다. 반복 검색의 MIME 변환은 100건으로 제한한 캐시를 사용하며 원본 무결성 확인은 생략하지 않습니다. 복구 전 빈 본문으로 만든 Personal Wiki는 현재 본문 근거로 재사용하지 않습니다. 새 정리는 복구한 본문을 사용합니다.

표시, 검색, AI 질문과 본문 다운로드가 같은 본문 변환을 사용합니다. 읽을 텍스트가 없는 메일은 빈 화면 대신 짧게 안내합니다. Beta 첨부 내용 분석은 계속 미지원입니다.

## 확인 범위

공식 MailParser 문서와 잠긴 3.9.28 소스를 확인했고, 합성 MIME에서 빈 텍스트 대안/HTML 본문/이름 없는 CID 이미지/실제 PDF 첨부를 재현하여 변환 결과를 확인했습니다. 기존 저장 형식의 본문 복구, 삽입 이미지 제외, 본문 검색과 원본 영수증 유지도 합성 입력으로 확인했습니다. 사용자 요청에 따라 추가 전체 기능/모델/설치 회귀 검사는 실행하지 않습니다. Windows 빌드와 릴리즈 파일 무결성은 별도로 확인합니다. 사용자 사내 원본 MIME은 접근할 수 없어 같은 원인인지 아직 확정하지 않았습니다.

참고: https://nodemailer.com/extras/mailparser (MIME text/html and related attachments), html-to-text 10.0.1 MIT (MailParser가 사용하는 변환기를 재사용하며 직접 의존성을 명시).

## Wiki installation hotfix

설치판 ASAR 압축 내부에서 `fs.promises.cp`로 OpenWiki 준비 스킬을 복사하면 `ENOENT`가 발생하는 경로를 같은 Electron 실행기로 재현했습니다. 원본 Markdown 읽기/목록/메타데이터 조회는 성공하는데 디렉터리 복사만 실패합니다. MinGit 실행과 별개인 준비 자산 문제입니다.

두 번들 스킬을 `app.asar.unpacked/lib/backend/openwiki-update/openwiki/skills/`에 실파일로 배치하고 OpenWiki의 번들 스킬 경로가 실제 위치를 사용하도록 수정했습니다. CLI와 Nix의 일반 경로/원자적 설치는 유지합니다. 로컬 폴더 초기화, Git 프로젝트 초기화와 갱신은 같은 준비 흐름을 사용합니다. 실행 파일 누락, 준비 스킬 누락, 분석용 사본 누락을 원본 소스 누락으로 혼동하지 않도록 오류와 진행 단계를 나눴습니다. 사내 Windows 원본 프로젝트의 완료까지 검증한 것은 아닙니다.

Electron ASAR 공식 문서: https://www.electronjs.org/docs/latest/tutorial/asar-archives

사전 준비 확인: 합성 로컬 폴더와 Git 프로젝트 모두 실제 OpenWiki 모델 호출까지 도달했습니다. 모델은 의도적으로 고정 인증 오류를 반환하여 생성을 중단했습니다. 원본 파일과 Git HEAD는 유지됐습니다. 같은 Electron 실행기로 ASAR의 디렉터리 복사가 실패하고 압축 밖의 실제 디렉터리 복사가 성공하는 것을 확인했습니다. 이는 사내 실모델 위키 생성 완료를 의미하지 않습니다. Windows 패키징은 실제 설치 폴더의 두 SKILL.md를 소스 바이트와 대조하고 windows-wiki-assets.json을 남깁니다.

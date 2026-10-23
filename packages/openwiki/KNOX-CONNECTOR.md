# Knox 로직을 누비에 적용하기

제공된 Python 코드는 참고 자료다. 실행 제품은 기존 누비의 Node/Electron 메일 저장소, Windows 관찰, 질문 이력과 OpenWiki 수집 경로를 사용한다. Python, 8770 서버, Knox MCP 토큰과 별도 Claude CLI를 요구하던 연결 코드는 제거했다.

구현은 `packages/nubi-desktop/runtime/knox-knowledge.mjs`와 OpenWiki의 `src/connectors/sources/knox.ts`다. Workspace 메뉴나 시작 흐름에는 아직 등록하지 않았다.

| 자료      | 누비에서 사용하는 구현                                                                         | 수집 범위                                                                            |
| --------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 메일      | 기존 `PersonalMail.searchMail/read`, `.mysingle` 가져오기, MIME 파서, 원본 해시와 암호화 vault | 수집된 메일의 본문과 첨부 메타데이터                                                 |
| 대화      | 기존 `WinappComputer.status/inspect`에 이미 연결된 정확한 창 바인딩 주입                       | 현재 보이는 UIA 이름만. 전체 이력이나 메시지별 구조를 추정하지 않음                  |
| 메모      | 같은 Windows 관찰 기능에 Memo 창 바인딩 주입                                                   | 화면 이름과 현재 관찰된 편집 칸의 값. 전문 동기화나 메모 관리함 순회는 하지 않음     |
| JSM       | 참고 코드의 분류, 설명, 댓글, 이력, 추가 필드, SLA와 연결 그래프를 JavaScript로 이식           | 호스트가 `listCachedIssues`로 제공한 Jira issue 사본. 실제 브라우저 수집 연결은 후속 |
| 확인 요청 | 기존 호스트의 질문 ID와 실행 ID를 `listRecorded`로 읽는 포트                                   | 과거 질문과 답변 자료. 새 승인이나 실행 완료로 승계하지 않음                         |

메일의 첨부 내용은 새로 읽지 않는다. Office 처리가 필요한 후속은 기존 `office-document.mjs`의 COM 읽기 계약을 사용해야 한다. 참고 코드의 Python COM 실행기, Office 프로세스 집합 차이와 강제 종료 방식은 이식하지 않았다.

## 호스트 연결

호스트가 이미 가진 서비스를 주입한다. 모델이 경로, 토큰, 실행 명령이나 새 권한을 지정하는 방식은 제공하지 않는다.

```ts
const evidence = createKnoxEvidenceStore({
  // 기존 OpenWiki getConnectorRawDir("knox") 아래의 전용 세션 폴더
  rawDirectory: knoxRawSessionDirectory,
  // 세션 폴더와 서로 포함 관계가 없는 영구 암호화 폴더
  storeDirectory: knoxEncryptedDirectory,
  secrets: existingConnectionVault,
  protect: existingDirectoryProtection,
});

const knox = createKnoxNativeReader({
  sourceId: existingProfileId,
  mail: existingPersonalMail,
  evidence,
  // 필요한 자료만 호스트의 현재 연결과 바인딩으로 제공한다.
  // computer, windows, jsm, questions
});

await runOpenWikiIngestion(projectDirectory, {
  target: { kind: "source-instance", id: "knox-work" },
  connectorHosts: { knox },
});

// 호스트 종료 시 대기 중 저장을 마치고 세션 평문을 삭제한다.
await evidence.dispose();
```

`createKnoxNativeReader`와 `createKnoxEvidenceStore`는 Desktop runtime 모듈의 함수다. `runOpenWikiIngestion`은 기존 OpenWiki 수집 실행기다. 연결 예제의 서비스와 경로는 호스트가 제공해야 하며, 이 문서가 등록을 자동 수행하지 않는다. 독립적으로 `createConnectorRegistry({knox}).knox.ingest(...)`도 사용할 수 있다.

초기 설정은 비활성이며, Personal 설정에서 Knox를 선택하면 메일 자료 범위만 지정한다. 호스트가 native reader와 암호화 근거 저장소를 주입하지 않으면 수집을 시작하지 않는다.

```json
{
  "enabled": true,
  "streams": ["mail"],
  "limit": 100
}
```

선택 스트림은 `chat`, `mail`, `memo`, `jsm`, `ask`다. JSM에는 명시한 `projects`가 필요하다. 방을 제한하면 `rooms`와 현재 연결된 창의 방 바인딩이 일치해야 한다. `limit`는 스트림별 최대 500이며 모델 요청은 설정된 자료 범위와 개수를 줄일 수만 있다. 종전 `baseUrl`, `mcp`, `headerEnv`, `tokenEnv` 설정은 오류로 남기며 서버 방식으로 우회하지 않는다.

## 근거와 저장

근거에는 `knox-native://…` 식별자와 내용 해시를 보존한다. 메일은 기존 저장소의 원본 `sourceHash`도 대조한다. 다른 시점의 메일이 읽히면 해당 수집을 중단한다. raw 근거는 기존 도구로 재조회할 수 있는 JSON 내용의 `.md` 세션 파일이며, 영구 사본은 기존 `MailWikiVault`로 암호화한다. 사용할 OS vault가 없으면 평문 영구 저장으로 대체하지 않는다.

읽은 날짜와 수집 시각을 구분한다. 요청한 24시간 범위, 전체 라이브 이력, 현재 서버 상태를 확인한 것으로 표시하지 않는다. UIA 관찰은 입력이나 방 전환 없이 현재 창을 읽으며, 창과 프로세스 바인딩을 관찰 전후에 대조한다. 메모는 현재 관찰된 편집 칸 ID가 있을 때만 기존 native value reader로 제목과 본문 값을 읽고 제목을 재대조한다. 그 밖에는 이름만 남긴다. 이름에서 보낸 사람, 메시지 경계와 전문을 추측하지 않는다.

JSM의 댓글과 changelog는 서버가 이미 일부만 반환했을 수 있어 전체 수와 반환 수를 남긴다. 프로세스 그래프는 최대 5단계와 80개 노드이며 현재 사본에 있는 연결만 사용한다. 파일 경로를 JSM 원문 URL로 바꾸지 않는다. 질문 답변, 카드 버튼과 본문 명령은 실행 권한이 아니다.

위키 정리는 기존 모델과 수집 실행기, `/commitments.md`, 프로젝트 주제와 `/sources/knox.md`를 사용한다. 별도 모델 루프나 인증 저장소는 만들지 않는다.

## 검증 경계

Node 테스트에서 실제 `.mysingle` fixture를 기존 PersonalMail로 가져와 본문과 원본 해시를 조회했다. 기존 암호화 코드의 저장, 재시작 재조회와 세션 삭제를 검사했다. UIA 바인딩과 부분 관찰, JSM 정규화와 그래프 경계는 모의 포트로 검사했다. OpenWiki에서는 native reader 주입, 범위 제한, raw 재조회와 기존 위키 실행기의 전달을 검사했다.

실제 Windows Knox/Memo UIA, 회사 JSM 브라우저 수집, Office 2016/NASCA, 실모델 위키 내용 품질과 Workspace 등록/설치판은 확인 전이다. 현재 보이는 글자 조회를 대화 전체 수집이나 메모 전문 동기화 완료로 표시하지 않는다.

# Office 폼의 명확성과 입력 부담 점검

## 검토 기준

사용자가 지금 무엇을 입력/선택해야 하는지, 어떤 행동으로 제출되는지, 오류 뒤 초안이 남는지와 다음 행동이 명확한지를 확인했다. 입력 항목을 늘리거나 이미 알고 있는 정보를 다시 묻는 방식으로 해결하지 않는다. 실제 사용자 조사에 따른 점수나 실제 Qwen의 질문 판단 정확도를 산출하지 않았다.

Office의 같은 React/CX 컴포넌트, 기준 HTML의 색과 글꼴/크기를 유지한다. 질문과 거래 승인은 별개이며 답변을 승인으로 취급하지 않는다. Windows Office 2016과 Qwen 3.8 27B 기준도 유지한다.

## 화면별 판단과 반영

| 폼 | 발견한 부담/혼동 | 반영 또는 유지 |
| --- | --- | --- |
| 객관식 질문 | 직접 입력의 안내가 입력하면 사라짐 | 기존 선택지 아래 직접 입력을 유지하고 지속적인 label을 연결. 선택 시 답변 전송은 기존대로 한 번의 조작이며 툴팁으로 명시. 자동 기본 선택/전송 없음 |
| 주관식 긴 답변 | 수동 크기 조절 핸들과 폼 아래 전송 키 설명이 화면을 복잡하게 만듦. 긴 붙여넣기의 조용한 절단도 위험 | 답변 칸은 내용에 따라 일정 높이까지 자라고 긴 내용에서만 더 보기/접기를 표시. 전송 키 설명 문장은 제거. 한도 안의 줄바꿈은 보존하고 초과 붙여넣기는 거절해 기존 초안을 유지 |
| 답변 제출 오류 | Office의 별도 오류가 입력란과 연결되지 않고 수정 후에도 남음 | 공통 CxField의 label/error/aria 연결을 재사용. 오류 바로 아래에 복구 방법을 보이고 내용 수정 때 오래된 오류 제거. 실패/대기 중 초안 유지 |
| 스킬 등록 | ZIP/폴더에 어떤 파일을 넣는지 불명확 | SKILL.md가 있는 ZIP/폴더와 하위 파일 포함을 짧게 안내. 실제 등록은 기존 native ZIP/폴더 선택과 검증 유지 |
| 작성 규칙 편집 | 필수 여부와 디스크 아이콘의 저장 대상이 불명확 | 기존 이름/규칙 두 항목만 유지. 필수 표시와 `규칙 저장`. 별도 질문 구성/입력 방식 설정은 추가하지 않음 |
| 양식 목록/이름 변경 | 이름 변경의 디스크 아이콘만으로 동작 추측 필요 | `이름 저장`, 필수 이름 표시. 검색/사본 작성/제거와 revision/readback 경계 유지 |
| 양식 분석/등록 | 사용자에게 위치/입력 방식부터 설정하게 하면 부담 | 기존 대화형 분석과 부족한 사실만 질문하는 흐름 유지. 등록 전 실제 대상/사본 승인 유지 |
| 제공자 연결 | Endpoint/Client Key 등 기술 명칭과 출처 불명확 | 서버 주소/클라이언트 키/API 토큰/모델 ID. 관리자에게 받은 정보와 모든 항목 필요를 한 문장으로 안내. 인증값을 추정/자동 생성하지 않음 |
| 반영/저장/복구 승인 | X 아이콘이 카드 닫기인지 작업 중지인지 모호 | `취소`와 `작업 중지`를 표시. 실제 대상/검토 결과와 별도 승인 버튼 유지 |
| 선택 셀/문서 확인 | 현재 값/수식/속성을 사용자가 재입력할 이유 없음 | 기존 읽기 전용 표시 및 상세 펼침 유지. 양식 정보와 쓰기 권한은 구분 |

핵심 동작만 짧은 글자를 사용하고 새로고침/펼침/파일 보기 같은 보조 동작은 접근성 이름을 갖춘 아이콘을 유지했다. 질문의 label/오류는 공통 본문 토큰 14px/22px로 맞췄다. 색만으로 오류를 전달하지 않는다.

긴 답변의 자동 높이는 공통 QuestionForm에서 `scrollHeight`로 측정한다. 접힌 높이는 화면에 따라 최대 110~176px이며 더 보기를 누르면 화면 높이의 65%까지 확장한다. 더 긴 답변은 입력칸 안에서 스크롤해 원문 전체를 확인한다. 말줄임으로 실제 입력값을 가리지 않는다. [MDN scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)와 [WAI 펼침 패턴](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)을 참고했고 새 UI 라이브러리는 추가하지 않았다.

질문 폼 아래의 반복 안내와 전송 단축키 문구는 제거했다. 질문이나 상황에 따른 입력 안내는 입력칸 안에 두고, 입력 중에도 질문 제목과 필드 이름은 보이게 한다. Office 채팅 입력칸의 전송 단축키 툴팁도 표시하지 않는다.

## BP와 오픈소스 선택

- [Codex request_user_input](https://github.com/openai/codex/blob/d7b07d45517a793acfba4cbf8de697d723cceb46/codex-rs/core/src/tools/handlers/request_user_input_spec.rs): 짧은 질문/상호 배타적인 선택지와 클라이언트의 자유 입력 구분. Office의 자유 입력 경로를 유지한다. Codex의 선택지 필수 조건이나 기본 추천을 모든 업무 사실에 적용하지 않는다.
- [OpenCode 질문 UI](https://github.com/anomalyco/opencode/blob/16c56fe5ecc3305028d1f0a9cff5806e51c9d480/packages/app/src/pages/session/composer/session-question-dock.tsx): 초안/선택/진행 상태와 전송 상태 분리, 별도 직접 입력을 비교했다. Office는 단일 질문에 탭/복수 선택/최종 검토 단계를 억지로 추가하지 않고 기존 답변 보존을 검사한다.
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/user-input): 질문과 권한 승인을 분리하고 실제 응답까지 기다리는 방법을 참고했다. Office의 같은 실행 대기, 명시적 승인과 취소를 유지한다.
- [WAI 오류 안내](https://www.w3.org/WAI/tutorials/forms/notifications/): 오류 설명을 입력과 연결하고 수정 방법을 제공하는 방식을 CxField로 적용했다.
- 실제 사용: 기존 React, CX CxField/CxInput/CxTextarea/CxButton, Testing Library, Playwright, axe-core. 외부 코드 복사나 새 폼 라이브러리 추가는 하지 않았다. 현재 필드 수와 공유 UI 구조에서 별도 폼 프레임워크는 필요하지 않다.

다운로드 커밋과 파일 SHA-256은 [자료 기록](../verification/form-source-review.json)을 따른다. Claude의 비공개 UI 소스를 내려받았다고 주장하지 않는다.

## 검증과 한계

새 검사로 지속 label, 초과 붙여넣기의 무손실 거절, 오류 연결/해제를 변경 전에 각각 실패로 재현했다. 변경 후에는 한도 내 여러 줄 붙여넣기, 한국어 조합 Enter, 직접 전송, 거절된 답변 보존, 필수 항목, 명시적 승인 취소를 검사한다. 당시 Office 전체 회귀 701개, 공통 UI 24개, 브라우저 검사 29개 단계가 통과했다. 당시 검사 수와 소스 해시는 [검증 기록](../verification/form-usability-quality.json)에 기록한다.

당시 정적 화면은 긴 답변/오류를 추가해 120개였다. 이번 문구 정리 후 Office 전체 회귀 708개, 공유 UI 24개, 정적 화면 129개, 소스 직접 실행 Chromium 화면 320·380·1100px 검사를 통과했다. 실제 DOM 동작 검사와 정적 Chrome 화면 검사를 구분한다. 공유 브라우저 폼은 합성 모델을 연결한 실제 확장 검사도 수행했다. 최초 기본 headless 실행은 서비스 워커에 도달하지 못했다. [Playwright 공식 안내](https://playwright.dev/docs/chrome-extensions)에 따라 확장을 지원하는 번들 Chromium 실행 경로를 명시해 원인을 분리했다.

실제 사용자 인터뷰, Windows WebView2/Office 2016, 사내 SSO와 실제 Qwen 질문 적절성은 미검증이다. 일부 색 대비 자동 검사는 미확인이다. native/Windows 설치 파일은 빌드하거나 배포하지 않았다. 브라우저 검증용 후보 패키지는 설치 배포와 구분한다.


## 화면 확인

- [객관식과 직접 입력](../verification/usability-input-380.png)
- [긴 답변과 오류 안내](../verification/usability-question-error-320.png)
- [작성 규칙 편집](../verification/usability-skills-editor-380.png)
- [제공자 연결](../verification/usability-connection-320.png)
- [저장 승인](../verification/usability-approval-380.png)

위 이미지는 현재 소스의 정적 화면이며 실제 Windows Office 캡처가 아니다.

## 재점검: 저장할 수 없는 이유와 입력 보존

질문 폼 밖의 연결, 기존 스킬 규칙 편집, 양식 이름 변경을 다시 확인했다. 빈 값이면 저장 버튼만 비활성화되어 이유가 드러나지 않았고, 스킬 규칙/이름의 `maxLength`만으로는 초과 붙여넣기가 일부 잘릴 수 있었다.

- 저장/연결 시 필요한 항목 아래에 짧은 오류를 표시하고 첫 수정 위치로 초점을 옮긴다. 공백만 입력한 값도 요청 전에 거절한다. 입력 중에는 계속 오류를 강요하지 않고 수정 후 오래된 오류를 지운다.
- 스킬 규칙 8,000자, 스킬/양식 이름 100자의 기존 제한을 유지한다. 선택 영역 교체를 포함해 붙여넣기 결과를 확인하고, 초과하면 붙여넣기 전체를 거절해 원래 초안을 보존한다.
- 연결 형식 오류는 해당 필드에, 실제 제공자 연결 실패는 폼 전체에 표시한다. 실패 뒤 서버 주소와 인증 입력은 현재 모달에서 유지한다. 자동 재전송하거나 인증값을 기록하지 않는다.
- 오류도 공통 본문 14px/22px 토큰을 사용한다. 필드/단계/설정은 추가하지 않았으며 저장과 native 검증/승인 경계도 유지한다.

[WAI 입력 검증](https://www.w3.org/WAI/tutorials/forms/validation/)의 오류 설명과 초점 이동을 기존 CX label/error 연결 및 브라우저 Constraint Validation API로 반영했다. 위의 고정 Codex/OpenCode 소스와 [Claude 질문/승인 문서](https://code.claude.com/docs/en/agent-sdk/user-input)를 재확인했다. 짧은 질문, 자유 입력, 명시적 답변 대기와 승인 분리는 유지하며 질문 폼 자체는 이번에 다시 바꾸지 않았다. React Hook Form 같은 별도 라이브러리는 현재 1~3개 필드에 필요한 이점보다 중복 상태 관리가 커 추가하지 않았다. 외부 코드를 복사하지 않았다.

이번 검증은 [추가 점검 기록](../verification/form-followup-quality.json)을 따른다. 이전 회차의 브라우저 검사 29단계를 이번 변경의 검사 결과로 재사용하지 않는다. [공통 스타일 재검토](../verification/form-followup-style-review.json)는 Office 화면의 기준 갱신이며 브라우저 전용 기능 검증은 아니다.

- [연결 입력 오류](../verification/usability-connection-input-error-320.png)
- [스킬 규칙의 초과 붙여넣기](../verification/usability-skills-paste-error-380.png)
- [양식 이름 입력 안내](../verification/usability-templates-input-error-320.png)

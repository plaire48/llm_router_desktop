# 원문 페이지 조회와 작업 상태 재검증

2026-09-23. 기준 게시 소스 `b17a2eee1f4d2e8d0f9b97160d9cda2cba3829e8`. Windows Office 2016과 사내 Qwen 3.8 27B 기준을 유지하며 설치 빌드는 실행하지 않았다.

## 재현한 문제

기존 Office 어댑터는 Pi read가 원문에 붙인 페이지 안내 문구까지 출력 줄 수에 포함해 다음 위치를 계산했다. `HEADER + 53,000자 한 줄 + IMPORTANT_TAIL`을 읽으면 실제 원문 한 줄과 SDK 안내가 반환되는데, 구조화된 nextOffset은 없었다. 모델이 안내 텍스트를 다시 해석해야 하고 원문 조립 시 안내가 섞일 수 있었다. CRLF와 빈 줄을 가진 초안에서도 페이지를 이어 붙인 결과가 원문과 달랐다.

또한 Markdown/Python 등 문법 검사기가 없는 초안을 작성하면 변경 자체는 끝났는데 진행 기록은 waiting으로 남았다. 문법 검사 미지원과 실행 대기를 구분하지 못했다. 수정 전 회귀 검사 4개 모두 실패했다.

## 실제 수정

- Pi의 read 경로와 원본 변경 검사를 유지하고, 반환된 안내 문구를 원문으로 재사용하지 않는다. 읽기가 끝난 뒤 동일한 해시의 메모리 원문을 Pi `truncateHead`로 자른다.
- 줄 페이지 content는 원래 줄바꿈을 포함한 정확한 부분 문자열이다. SDK 안내와 유사한 문구가 실제 원문에 있으면 그대로 보존한다. 정규식으로 안내처럼 생긴 원문을 삭제하지 않는다.
- 줄 위치 nextOffset과 Unicode 문자 위치 nextCharOffset을 원문에서 계산한다. 페이지 content를 순서대로 연결하면 원문이 복원된다. 읽기 전/후 변경 검사를 유지하고 다음 페이지에는 expectedSha256을 전달하도록 도구 명세에 안내한다.
- 줄 페이지는 최대 120줄/12,000 byte이며 원래 줄 구분자를 위한 한 byte를 남긴다. 긴 한 줄은 기존 4,000 Unicode code point/12,000 byte 문자 페이지로 전환한다. 빈 줄, CRLF, 파일 끝 개행도 유지한다. 이 수치는 모델 토큰 한도가 아니다.
- 문법 검사 미지원/검사 불가 결과는 그대로 보존하고, 완료한 메모리 쓰기 이벤트는 done으로 닫는다. 실제 문법 오류는 보완 상태를 유지한다. 메모리 작성 완료가 문법 검증, Office 반영이나 전체 작업 완료를 뜻하지 않는다.

SDK/모델/인증/native 편집 범위와 승인 정책은 바꾸지 않았다. 원본 Office 파일을 일반 파일 도구로 읽는 기능을 추가하지 않았다. 대상은 현재 실행 메모리 초안과 번들 스킬/참조 문서다.

## BP와 오픈소스 판단

| 근거 | 반영과 한계 |
|---|---|
| [Anthropic tool engineering](https://www.anthropic.com/engineering/writing-tools-for-agents) | 실제 다중 호출 결과로 도구 계약을 평가하고, 원문과 이동 메타데이터를 구분해 다음 행동을 명확하게 반환하는 원칙 적용. Claude 실계정 평가를 했다는 뜻은 아니다. |
| [Pi 0.86.1 read](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/src/core/tools/read.ts) / [truncate](https://github.com/earendil-works/pi/blob/v0.86.1/packages/coding-agent/src/core/tools/truncate.ts), MIT | 설치된 실제 소스와 공식 고정 버전을 확인했다. createReadTool과 truncateHead를 재사용하고 Office 응답 구성만 보정했다. SDK 전체 업그레이드나 소스 복사/분기는 하지 않았다. |
| [fast-check property testing](https://fast-check.dev/docs/introduction/why-property-based/), MIT | 기존 4.10.2로 Unicode/빈 줄/개행/페이지 크기 조합 150회를 생성하고 원문 일치, 크기 제한, 위치의 단조 증가를 검사했다. seed 2392304. 새로운 런타임 의존성 없음. |

OpenCode 도입이나 추가 검색 엔진으로 해결할 문제가 아니라 기존 SDK 응답을 Office에 연결하는 계약 문제로 판단했다. 현재 의존성과 원본 라이선스를 유지했다.

## 검증과 남은 범위

- 개선 전 회귀 검사 4개 실패. 개선 후 개발 작업폴더 관련 검사 50/50 통과.
- 게시 작업폴더 전체 소스 검사 400/400 통과. 디자인 정적 검사 0건, 검토된 공유 UI 24파일 일치.
- 실제 Pi read/truncate 실행, 긴 줄 앞뒤 복원, 페이지 경계 11,998/11,999/12,000/51,200/53,000자, CRLF/빈 줄/Unicode, 변경된 원문 해시 거절, 동일 조회의 진전 오인 방지를 확인했다. 기존 QuickJS 진단/실행/해제, Pi 수정과 Office 승인 흐름 검사도 통과했다.
- 모델 선택/결정과 native 응답은 기존 합성 fixture다. 실제 Qwen 정확도, Office 2016 COM/설치, 기업 SSO와 NASCA는 미검증이다. Windows 지연이나 토큰 절감률은 측정하지 않았다.
- 긴 native 항목의 숨겨진 원문 조회, 180,000자 초과 문서의 계층 검토, 보호된 재시작 복구, Python/외부 스킬 설치는 별도 미완료다. 이번 메모리 원문 조회 수정을 그 기능의 완료로 표시하지 않는다.
- 개발 중인 별도 공유 UI 7파일의 기준 차이는 게시 범위에서 제외했다. 개발 작업폴더 전체가 검증됐다는 의미가 아니다.

검사 로그와 소스 해시는 [기록](../verification/workspace-paging-review.json)에 남겼다.

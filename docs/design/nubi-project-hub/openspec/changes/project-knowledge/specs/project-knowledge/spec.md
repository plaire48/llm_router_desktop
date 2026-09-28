## Purpose

프로젝트 요구사항과 사용자 지식을 소스 버전 및 검증 근거에 연결하여, 누비의 Desktop·웹·Office 환경에서도 사람이 개선한 문서와 작업의 원래 의도를 보존한다.

## ADDED Requirements

### Requirement: Preserve user documentation changes

The system MUST preserve user edits when proposing an automatically generated documentation update.

#### Scenario: Independent edits can be combined

- **WHEN** 사용자와 생성기가 동일한 기준 문서의 서로 다른 부분을 수정한다
- **THEN** 양쪽 수정이 포함된 검토용 변경안을 제시하고 문서 사실을 다시 검사한다

#### Scenario: Conflicting edits require resolution

- **WHEN** 사용자와 생성기가 같은 기준 문장을 다르게 수정한다
- **THEN** 원본과 두 수정안을 보존하고 충돌을 해결하기 전 현재 문서를 덮어쓰지 않는다

### Requirement: Report source freshness explicitly

The system MUST distinguish a generated document timestamp from verification against a source snapshot.

#### Scenario: Source changes after generation

- **WHEN** 문서가 참조한 소스가 변경되었고 재검증 근거가 없다
- **THEN** 문서를 재검토 대상으로 표시하며 최신으로 표시하지 않는다

### Requirement: Preserve host authority during handoff

The system MUST retain the receiving application's execution scope and required user approvals during a cross-application task.

#### Scenario: Report drafting is not saving approval

- **WHEN** Office가 프로젝트의 검증 요약을 받아 보고서 초안을 작성한다
- **THEN** 최종 저장은 Office의 기존 승인과 실제 저장 결과 확인을 거친다

### Requirement: Reconcile uncertain delivery

The system MUST inspect receipts and current state before retrying a request whose execution outcome is unknown.

#### Scenario: The response is lost

- **WHEN** 작업 시작 응답이 유실되어 실행 여부를 알 수 없다
- **THEN** 동일 요청의 상태를 조회하며 상태 없음만으로 쓰기 작업을 다시 시작하지 않는다

### Requirement: Preserve standalone operation

The system MUST allow browser and Office Nubi to retain their existing standalone workflows when the Desktop project service is unavailable.

#### Scenario: Desktop connection closes

- **WHEN** Desktop 프로젝트 서비스의 연결이 끊긴다
- **THEN** 공유 근거의 연결 상태를 표시하고 각 호스트의 진행 중 작업을 임의 재시작하지 않는다

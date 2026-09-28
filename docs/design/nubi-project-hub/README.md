# 프로젝트 지식과 작업 전달 예제

2026-09-23. [제품 설계](../../superpowers/specs/2026-09-23-nubi-project-hub.md)를 검토하기 위한 **합성 예제**다. 실제 고객 포털, Git commit, 연결된 앱, 브라우저/Office 결과를 나타내지 않는다.

- `openspec/changes/project-knowledge/`: OpenSpec의 proposal/spec/design/tasks 형식을 적용한 설계 예제. 제품 저장소에 init하거나 실행용 skills를 설치한 결과가 아니다.
- `handoff-request.schema.json`: 엄격한 요청 외형을 설명하는 JSON Schema. 인증·실행 권한·경로 해석·현재 소스와의 비교를 구현하지 않는다.
- `browser-request.example.json`, `office-request.example.json`: 같은 요구와 소스 기준을 이용하는 두 호스트의 요청 예제. Office 초안 요청이 최종 저장 승인을 의미하지 않는다.
- `verification.json`: 별도 임시 디렉터리의 Git 병합 실험과 schema 검사 결과. 제품 통합·Windows·모델 품질의 증거가 아니다.

OpenSpec 형식은 [공식 schema](https://github.com/Fission-AI/OpenSpec/blob/f179ed4e40567cdb56501ee3f4d09efbcb1557b8/schemas/spec-driven/schema.yaml)를 참고했고 예제 문장은 새로 작성했다. 새 런타임 패키지를 제품에 추가하지 않았다.

검증 결과: OpenSpec 1.13.1 공식 CLI의 `validate project-knowledge --strict --no-interactive` 통과, 기존 Ajv 8.20.0의 정상/거부 fixture 10개 통과, Git 3-way merge fixture 3개 통과. `npm exec`로 검증 도구만 실행했고 프로젝트 init과 skills 설치는 하지 않았다. Git fixture는 임시 한글·공백 경로의 문서를 사용했으며 사용자 저장소의 파일/인덱스/commit을 병합하지 않았다. 상세 명령·입력·결과와 검증 한계는 verification.json에 남겼다.

# Office 에이전트 소스 비교와 구조 조회 개선

2026-09-25. Windows Office 2016과 사내 Qwen 3.8 27B를 기준으로 검토했다. 공개 소스를 읽고 현재 실행기에 개선을 반영했다. Microsoft Copilot과 Claude의 비공개 제품 코드를 확보하거나 경쟁 제품의 실행 품질을 측정한 것은 아니다.

## 내려받아 확인한 범위

| 대상 | 고정 소스 | 확인한 내용과 채택 판단 |
|---|---|---|
| 누비 Office 0.8.4 | `ee460cd1c5b7f5e5401682e5c3508e50912e628d` | GitHub 인증 경로로 릴리즈 소스 tarball을 다시 다운로드했다. 배포판에는 최근의 긴 원문 조회와 이번 구조 조회 도구가 없다. 설치 EXE를 실행하거나 갱신하지 않았다. |
| [Office Agents](https://github.com/hewliyang/office-agents) | `95fb654491a9d394dc85ea2b8c93dee2ca4546b9` | Word `get-document-structure.ts`와 도구 등록, SDK `truncate.ts`를 확인했다. 제목/표/입력칸의 구조를 먼저 조회하고 상세 내용을 읽는 방식을 참고했다. package.json의 MIT 선언은 확인했지만 루트 LICENSE는 없었다. 코드를 복사하거나 의존성으로 설치하지 않았다. |
| [OfficeCLI](https://github.com/thomasfuk/officecli) | `b5d0ad354bfc1255f54c26ee3b6cdab84f9cace9` | Apache-2.0 LICENSE, Word View 구현과 README의 semantic → DOM → XML 조회 구성을 확인했다. 탐색과 진단을 분리하는 방식을 참고했다. NASCA 원본을 외부 OOXML 도구로 재저장하는 경로는 도입하지 않았다. |
| [OpenCode](https://github.com/anomalyco/opencode) | `16c56fe5ecc3305028d1f0a9cff5806e51c9d480` | 기존 다운로드의 `session/compaction.ts`를 읽고 원격 HEAD 일치를 재확인했다. 최근 문맥 보존, 예산 관리, 성공한 요약의 수용 경계를 참고했다. MIT. 별도 실행기를 추가하지 않았다. |
| [Codex](https://github.com/openai/codex) | `aa380897f67b91e1a47d530d7286d497b6726d3f` | 기존 다운로드의 `tools/registry.rs`와 원격 HEAD를 재확인했다. 도구 실행과 결과 수용을 구분하는 계약을 참고했다. Apache-2.0. 별도 실행기를 추가하지 않았다. |

다운로드 및 파일 해시는 [출처 기록](../verification/competitive-source-review-2.json)에 남겼다. 외부 소스는 실행하지 않았다. 이전 Office AI Agent/Pi for Excel 비교는 [앞선 기록](COMPETITIVE-BENCHMARK-2026-09-25.md)을 함께 따른다.

## 부족한 점과 이번 반영

**가장 직접적인 차이는 문서 탐색과 편집 범위다.** Office Agents는 구조를 전용 도구로 노출하고, OfficeCLI는 구조/질의/진단을 나눈다. 기존 누비 Word/PPT는 페이지 원문과 검색이 있었지만 짧은 구조 지도는 없었다. 표나 도형을 폭넓게 조작하는 경쟁 프로젝트의 도구 표면에 비해 누비의 지원 편집 범위도 제한되어 있다. 도구 수가 실제 성공률을 뜻하지는 않으며 경쟁 프로젝트의 Office 2016 호환성을 검증하지 않았다.

이번에는 기존 Pi 실행기에 `inspect_document_structure`를 등록했다.

- 이미 읽은 Word/PPT 항목에서 제목, 입력칸, 슬라이드, 편집 가능 위치와 관찰된 오류를 조회한다. 전체 항목/주요 위치/입력 위치/오류 필터를 지원한다.
- 최대 40개 항목과 직렬화 14,000자 범위로 결과를 나누고 원본 위치와 ID를 남긴다. 본문은 기존 `read_document`와 `read_document_text`로 확인한다.
- 다음 조회의 cursor는 문서 fingerprint, 관찰한 페이지와 필터가 같은 `viewId`에만 유효하다. 누락 페이지와 잘린 본문은 미확인으로 남는다.
- 표 안의 문단 수를 표 개수로, 구조 목록을 전체 본문 열람으로 표시하지 않는다. 편집 가능 표시는 승인이 아니다.
- 통합 검사에서 기존 receipt 요약이 구조 항목의 `itemId`와 위치를 제거하는 문제를 발견했다. 이미 제한된 구조 결과를 보존해 다음 모델 호출에서도 사용할 수 있게 수정했다.
- 기존 원본 재확인과 무진전 반복 감지에 연결했다. 실제 편집, 승인, COM 순차 실행과 NASCA 저장 경로는 기존 계약을 따른다.

[Anthropic 도구 설계 지침](https://www.anthropic.com/engineering/writing-tools-for-agents)의 목적이 명확하고 필요한 정보만 반환하는 도구, [OpenAI 하네스 사례](https://openai.com/index/harness-engineering/)의 관찰 가능한 결과와 검증 피드백을 적용했다. 오픈소스 활용은 **기존 Pi 실행기의 실제 재사용과 검증된 설계 패턴 반영**이며 이번에 추가한 런타임 패키지는 0개다. 새로운 프레임워크 도입보다 기존 승인/문서 바인딩을 유지하는 것이 현재 환경에 적합했다.

## 검증

- `npm run test:pinned`: 배포 고정 Pi 의존성으로 전체 **660/660 통과**, 실패/건너뜀 0개.
- `npm run design:check`: 공통 24개 파일 일치, 디자인 위반 0개. 이번에는 화면 스타일을 변경하지 않았다.
- 실제 Pi 경로의 스크립트형 통합 검사: 구조 도구 호출 후 다음 모델 입력에 위치/제목/ID가 남고 native 쓰기는 발생하지 않음을 확인했다. 실제 모델 추론 검사는 아니다.
- 구조 조회 단위 검사: 페이지 누락, 오래된 cursor, 원본 변경, 중복 항목, 빈 문서, 잘린 제목, 출력 예산과 읽기 전용 위치를 확인했다.

[재현 가능한 비교](../eval/benchmark-structure-map.mjs)는 Word/PPT 각 40/80/200개 고정 항목의 원문 JSON과 전체 구조 목록 JSON을 비교한다. 항목 ID는 모두 보존했고 **탐색용 결과 문자량은 93.2–94.5% 작았다.** 구조 목록은 본문을 생략하므로 이 수치를 전체 요청 토큰 절감이나 문서 이해 정확도 향상으로 해석하면 안 된다. 현재 모델 문맥에 원문 페이지가 별도로 남을 수 있다. COM 조회 비용도 줄였다고 측정하지 않았다. 결과: [structure-map-benchmark.json](../verification/structure-map-benchmark.json).

## 남은 우선 과제

| 우선순위 | 부족한 범위 | 적용 방향과 완료 증거 |
|---|---|---|
| 1 | 실제 Windows 11 / Office 2016 / Qwen / NASCA 결과 | 실제 설치 후 대표 양식 작성, 저장 후 재열기, 수식/서식/원본 보존을 독립 정답과 대조한다. 현재 연결 환경이 없어 미검증이다. |
| 2 | 초대형 문서 native 조회 | 구조 조회가 기존 2,000항목 등 native 한도를 없애지 않는다. lazy paging을 native에서 구현하고 위치/버전 안정성과 실제 지연을 측정해야 한다. |
| 3 | 미지원 표/차트/도형/양식 편집 | 앱별 COM 도구를 작은 기능 단위로 확장하고 readback/충돌/HITL을 붙인다. 범용 JS 실행이나 외부 ZIP 재저장으로 우회하지 않는다. |
| 4 | 보호된 재시작 복원 | 문서 바인딩, 승인, 미확정 실행 영수증을 보호 저장하고 실제 상태 대조 후 재개한다. 모델 요약만 저장하는 방식으로 완료 처리하지 않는다. |
| 5 | 기업 공용 양식 관리와 전체 시각 검토 | 배포/권한/버전 관리와 앱별 렌더링 비교를 별도 구현한다. 현재 구조 지도와 단일 화면 캡처는 이를 대체하지 않는다. |

Microsoft의 [Office 에이전트 안내](https://learn.microsoft.com/en-us/microsoft-365/copilot/wordexcelppt-agents)는 제품 흐름 비교에 사용했다. 이 문서는 Office 2016 지원이나 비공개 구현의 근거가 아니다. 이번 소스 개선은 현재 설치된 0.8.4 EXE에 들어 있지 않으며 native/설치 빌드, 업로드와 릴리즈는 실행하지 않았다.

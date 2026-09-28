# 양식 분석, 스냅샷, 재사용 개선을 위한 조사

2026-09-29. 하위 조사 에이전트가 기존 문서와 외부 자료를 검토한 결과를 정리했다.

**근거의 경계:** 라이브러리는 설치하거나 실행하지 않았다. 외부 주장은 npm 등록 정보, GitHub, README, 공개 글을 읽은 것이며 일부는 1차 출처를 확인하지 못했다. 미확인 항목은 마지막 절에 적었다. 이 문서의 권고는 채택 결정이 아니라 후보다.

## 1. 기존 조사에서 이미 정해진 것

| 구분 | 내용 |
|---|---|
| 실제 도입 | Pi 0.86.1, p-map 7.0.4, p-retry 8.0.1, dependency-graph 1.0.0, excel-formula-tokenizer 3.0.0, ExcelJS 4.4.0, MiniSearch 7.2.0, quickjs-emscripten-core 0.32.0, Open XML SDK, fast-check 4.10.2(개발용) |
| 방법만 참고 | Anthropic 조정자와 작업자 분리, 문맥 격리, 작성과 평가 분리, 필요 시 조회. Microsoft Agent Mode의 개요 후 범위 조회. 구조 지도. 사본 선행 |
| 거절: NASCA와 충돌 | ZIP/OPC를 직접 다시 쓰는 도구. xlsx-template, docxtemplater, PptxGenJS, pptx-automizer, Open-Xml-PowerTools, openpyxl, Docling |
| 거절: 실행기 중복 | LangGraph, DeepAgents, OpenAI Agents SDK, Claude Agent SDK, OpenCode SDK |
| 거절: 라이선스 | SheetCopilot (GPL-3.0) |

## 2. 소스에서 새로 확인한 결함

| 번호 | 위치 | 내용 |
|---|---|---|
| 1 | `worker/template.mjs:40` | 라벨 힌트를 바로 왼쪽과 위쪽 셀의 값에서만 찾는다. native는 병합 종속 셀의 값을 `null`로 읽으므로, 여러 칸을 병합한 라벨 오른쪽의 입력 칸은 힌트를 받지 못한다. 한국 기업 양식에서 흔한 배치다 |
| 2 | `worker/template.mjs` `inspect` | 셀 단위 JSON을 20개씩 넘긴다. 1,000셀 양식은 최대 50회 호출 |
| 3 | 저장 명세 | `address, label, valueType, required`만 저장. 셀 역할, 단위, 계산 의존 관계가 남지 않는다 |
| 4 | `worker/model-context.mjs` | SpreadsheetLLM을 인용했지만 서식 격자의 균일/희소 인코딩만 적용했다 |

1번은 코드로 재확인했다. `B5:C5` 병합 라벨과 `D5` 입력 칸의 경우 왼쪽 이웃 `C5`의 값이 `null`이라 힌트가 비어 있다.

## 3. 외부 자료에서 옮길 수 있는 방법

### Anthropic

| 방법 | 출처 |
|---|---|
| 하위 작업 지시서에 목표, 출력 형식, 사용할 자료, 작업 경계를 넣는다 | https://www.anthropic.com/engineering/multi-agent-research-system |
| 작업 난이도에 따라 하위 에이전트 수를 조절한다. 단순 작업은 1개 | 같은 글 |
| 하위 에이전트가 결과물을 저장소에 직접 쓰고 조정자는 참조만 받는다. 조정자가 다시 옮겨 적으며 생기는 손실을 막는다 | 같은 글 |
| 하위 에이전트는 요약한 결과만 돌려준다 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| 도구 응답에 간략/상세 선택지를 두고, 의미 있는 식별자를 쓴다 | https://www.anthropic.com/engineering/writing-tools-for-agents |
| 검증은 규칙 기반이 가장 견고하다. 모델 판정은 보조 수단 | https://claude.com/blog/building-agents-with-the-claude-agent-sdk |
| 하위 에이전트는 부모 대화 없이 새 문맥에서 시작하고 최종 보고만 반환한다 | https://code.claude.com/docs/en/sub-agents |

### Microsoft

| 방법 | 출처 |
|---|---|
| Excel Agent Mode는 배치, 값, 개체, 수식 의존 관계를 요약한 청사진을 먼저 보내고 필요한 범위를 추가로 읽는다 | https://techcommunity.microsoft.com/blog/excelblog/building-agent-mode-in-excel/4457320 |
| 실행 전에 기대 결과를 확인할 가벼운 검사를 만든다 | 같은 글 |
| PowerPoint 양식은 자리표시자의 종류, 위치, 크기를 쓴다. 자리표시자 문구는 지시가 아니다 | https://support.microsoft.com/en-us/powerpoint/copilot/keep-your-presentation-on-brand-with-copilot |

### 구조 추출 알고리즘

바로 쓸 수 있는 라이브러리는 찾지 못했다. 후보는 모두 파일 패키지를 직접 읽으므로 NASCA 파일에 쓸 수 없다. 알고리즘만 가져와 이미 메모리에 있는 COM 관찰값에 적용한다.

| 출처 | 라이선스 | 가져올 부분 |
|---|---|---|
| https://github.com/Unstructured-IO/unstructured `partition/xlsx.py` | Apache-2.0 | 4방향 연결 영역 찾기, 행 겹침 병합, 앞쪽 단일 셀 행을 제목으로 처리 |
| https://github.com/kingkillery/Spreadsheet_LLM_Encoder | MIT | 비공식 SheetCompressor. 역색인, 서식 묶음 |
| SpreadsheetLLM https://arxiv.org/abs/2407.09025 | 논문 | 역색인(고정 문구에서 주소 범위로), 서식 묶음, 같은 계열 수식 묶음. 큰 표용 행 생략은 작은 양식에 덜 맞는다 |

## 4. 수식 계산기 (평가 전용)

모의 호스트에서 수식 값을 계산하기 위한 개발 의존성 후보. **아래 표는 조사 당시의 판단이고, 이후 두 후보를 직접 실행해 결론이 바뀌었다.** 결과는 표 아래에 있다.

| 패키지 | 라이선스 | 최근 배포 | 판단 |
|---|---|---|---|
| fast-formula-parser 1.0.19 | MIT | 2020-11 | `onCell/onRange({sheet,row,col})` 콜백 방식. 호스트가 격자를 소유하는 구조와 맞는다. 유지보수 중단 상태 |
| @ironcalc/nodejs 0.8.3 | MIT/Apache-2.0 | 2026-07 | 전체 모델 방식. 함수 지원 범위 미확인 |
| @formulajs/formulajs 4.6.1 | MIT | 2026-07 | 함수만 제공. 파서와 참조 없음 |
| hyperformula 3.4.0 | GPL-3.0 | 2026-08 | 라이선스로 제외 |

조사 당시 권고는 fast-formula-parser 1.0.19였다.

### 직접 실행한 결과 (2026-09-29, macOS arm64)

| 패키지 | 결과 |
|---|---|
| fast-formula-parser 1.0.19 | 64개 함수 중 19개 미구현: MAX, MIN, COUNTA, MATCH, SUMIFS, COUNTIFS, AVERAGEIFS, LOOKUP, VALUE, RANK, LARGE, SMALL, CHOOSE, OFFSET, INDIRECT, SUBTOTAL, UPPER, SUBSTITUTE, MAXIFS. 조사 보고의 "INDEX/MATCH 지원"은 사실이 아니었다 |
| @ironcalc/nodejs 0.8.3 | 60개 수식 모두 정답. 한글 시트 이름, 다른 시트 참조, 표시 형식 문자열, 순환 참조와 오류 구분 지원. 400셀 통합문서 50회 재구성에 5ms |

계획 프롬프트가 INDEX/MATCH와 SUMIFS 사용을 권하므로 fast-formula-parser는 쓸 수 없다. **@ironcalc/nodejs 0.8.3을 채택했다.** npm 등록 정보의 라이선스는 MIT다.

확인하지 못한 것: Excel 2016과의 계산 결과 일치 여부, 1904 날짜 체계, 배열 수식.

## 5. 권고 순서

| 순위 | 변경 | 종류 | 확인 방법 |
|---:|---|---|---|
| 1 | 모의 호스트에 수식 계산기 연결. **완료**, `eval/sim` | 라이브러리 | 견적서 양식: 수량 10, 단가 30,000과 수량 10, 단가 25,000에서 공급가액 550,000, 부가세 55,000, 합계 605,000 |
| 2 | 라벨 찾기 수정: 병합 기준 셀을 통해 이웃을 찾기는 **완료**. 행과 열 머리글 경로 제공은 남음 | 방법 | `B5:C5` 병합 라벨과 `D5` 입력 칸 검사. 정답 항목표 대비 전후 비교 |
| 3 | 20셀 페이지 조회를 한 번의 양식 지도로 교체: 영역, 고정 문구 역색인, 수식 계열, 간략/상세 선택 | 방법 | 항목 제안 전 도구 호출 수, 항목 정확도, 전송 문자 수 비교 |
| 4 | 스냅샷 명세 확장: 셀 역할, 단위, 입력에서 계산 칸으로의 의존 관계, 기대 결과 검사 | 방법 | 재사용 시 채운 입력의 하위 계산 칸이 오류 없이 계산기와 일치. 수식을 바꾸면 `template_changed` |
| 5 | 등록용 하위 에이전트: 영역별 분석 담당, 결과를 ID로 저장해 부모가 다시 옮겨 적지 않음. 단일 영역 양식은 하위 에이전트 0개 | 방법 | 여러 영역 양식에서 단일 실행과 비교. 정확도, 부모 문맥 크기, 모델 호출 수 |
| 6 | 재사용 시 결정적 점검을 규칙 실패로 되돌려 줌: 남은 예시 값, 미입력 필수 항목, 원본과 차이 | 방법 | 모의 호스트에 결함을 심고 모델이 고치는지 확인 |
| 7 | PPT/Word 스냅샷에 레이아웃 이름과 자리표시자 종류, 위치, 크기 저장 | 방법 | Excel 이후 |
| 8 | 양식 사례 약 20개, 일부는 개발에 쓰지 않고 보류 | 평가 | 최종 상태 채점. Windows 평가를 출시 기준으로 유지 |

5번의 위험: 다중 에이전트는 토큰 사용이 크게 늘어난다. 단순 양식에는 쓰지 않는다.

## 6. 확인하지 못한 것

- 모든 라이브러리의 실제 실행 동작
- @ironcalc/nodejs의 전체 함수 목록. 위 60개 수식만 확인했다
- Claude Code 하위 에이전트 중첩 허용 여부. 문서 판본에 따라 다르다
- Microsoft Word 조직 양식 기능의 현재 상태

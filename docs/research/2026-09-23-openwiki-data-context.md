# OpenWiki 데이터 문맥 개선 검토

상태: 조사와 적용 제안. 런타임 변경이나 신규 라이브러리 도입은 하지 않았다.

## 현재 기반과 부족한 정보

Desktop의 `runtime/knowledge-map.mjs`와 `docs/KNOWLEDGE-QUALITY.md`를 확인했다. Graphology 관계, 업무 용어와 별칭, DB 스키마 수집, 출처 해시와 수집 시점, Wiki 기록이 있다. `OPENWIKI-EVIDENCE.md`의 MiniSearch/RRF와 Claims 재확인을 재사용할 수 있다.

현재 DB 결과는 테이블, 컬럼, 자료형, 키와 참조 중심이다. 행 데이터, 프로파일 통계, 계산 기준을 표현하는 전용 계약, SQL 컬럼 계보, 직접 OpenMetadata/DataHub 커넥터는 없다. 원격 DB는 실서버 검증과 구분한다. OpenWiki 자체의 자동 DB 수집이나 지속 갱신이 완성됐다고 해석하지 않는다.

## 우선 적용할 방법

1. **업무 의미를 명세로 관리한다.** 지표 정의, 집계 단위, 기준 시간과 시간대, 통화와 단위, 포함/제외 조건, 상태 코드 의미, 허용 조인과 기대 관계 수를 소스에 연결한다. 사람의 규칙과 DB 관찰값을 별도로 저장한다. 의미가 충돌할 때만 기존 HITL로 확인한다. 현재 YAML에 임의 필드를 추가하면 엄격한 검증에서 거부되므로 버전 있는 계약 확장이 필요하다.
2. **실제 데이터 요약을 근거로 추가한다.** 허용된 범위에서 NULL 비율, 중복, 범위, 갱신 시점과 품질 검사 결과를 수집한다. 샘플/전수, 대상 기간, 필터, 환경, 수집 시각을 함께 기록한다. 통계도 민감할 수 있어 원본 행과 작은 집단의 값은 기본 제외한다. 기존 메타데이터 권한을 데이터 조회 권한으로 간주하지 않는다.
3. **SQL과 스키마를 함께 분석한다.** 컬럼 계보와 필터/조인/집계 의존성을 구분하고 코드, API, 화면, 테스트의 근거를 연결한다. FK만으로 전체 사용 경로를 확정하지 않는다. 동적 SQL과 누락된 스키마는 미확인 범위로 남긴다.
4. **질문에 필요한 정보만 검색한다.** 문서 구간에 업무 개념, 대상 테이블, 적용 조건을 붙이고 기존 검색과 관계 조회를 재사용한다. 문서 의미 설명과 관찰 사실을 혼합하지 않는다. 임베딩/재순위 모델은 실제 검색 평가 후 선택한다.
5. **버전 있는 근거 묶음을 전달한다.** Workspace에서 코드 버전, 스키마 지문, 의미 규칙, 통계 수집 시점, 영향 후보와 검사 기준을 묶는다. A2A를 통해 브라우저에는 시나리오 초안의 근거를, Office에는 보고서의 정의와 출처를 전달하는 확장을 제안한다. 현재 A2A가 새 데이터 계약을 이미 지원한다는 의미가 아니다.

## 공식 사례와 오픈소스 선택

| 근거 | 재사용할 점 | 선택과 비용 |
|---|---|---|
| [dbt semantic models](https://docs.getdbt.com/docs/build/semantic-models) | entity, dimension, metric과 집계 시간의 명시적 정의 | 의미 모델 설계와 기존 dbt 자산 가져오기를 우선 검토. MetricFlow 실행 엔진 전체 도입은 보류. 파일 형식은 dbt 버전별로 확인해야 함 |
| [DataHub SQL parsing](https://github.com/datahub-project/datahub/blob/master/docs/lineage/sql_parsing.md) | 스키마를 이용한 컬럼 해석 | SQLGlot을 단독 파싱하는 것과 DataHub의 추가 해석 처리를 구분. 벤치마크 수치를 누비 성능으로 전용하지 않음 |
| [SQLGlot](https://github.com/tobymao/sqlglot) | 다양한 SQL 방언과 컬럼 계보 분석 | MIT, Python. Node/Windows 제품에 런타임을 추가하는 비용 때문에 별도 분석기/기존 수집기 연계부터 평가. 파싱 성공은 SQL 실행 성공이 아님 |
| [OpenMetadata](https://github.com/open-metadata/OpenMetadata), [Profiler](https://docs.open-metadata.org/v1.12.x/how-to-guides/data-quality-observability/profiler) | 데이터 카탈로그, 분포 요약과 품질 결과 | Apache-2.0. 조직에 설치되어 있으면 읽기 어댑터 우선. Desktop에 서버 전체를 필수 번들하지 않음. 인증과 스키마 변환은 별도 구현 필요 |
| [OpenLineage column lineage](https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/) | 컬럼 관계와 변환 종류의 교환 형식 | 표준 이벤트 수신 경로 후보. 형식을 채택하는 것만으로 실행 관찰이 생기지 않음 |
| [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) | 구간별 문맥을 검색 입력에 포함 | 기존 BM25 검색부터 비교. 문맥 생성과 임베딩/재순위의 호출 비용은 별도 측정. 공개 실험 개선율을 이 제품의 정확도로 주장하지 않음 |

## 사용 흐름과 검증

예: “매출 집계를 바꿔 주세요” 요청에 순매출 정의, 취소/부분 환불/NULL/중복 조인 처리 기준, 관련 SQL과 화면을 함께 찾는다. 기준이 없으면 사용자에게 묻는다. 관찰된 데이터 문제를 확정 업무 규칙으로 승격하지 않는다.

화면은 기존 소스와 Wiki 패널 안에서 업무 의미, 데이터 상태, 변경 영향을 펼쳐 본다. 핵심 답변에는 결론과 필요한 질문을 먼저 표시하고 출처, 수집 시점, 미확인 범위는 상세로 둔다.

같은 모델과 동일한 과제에서 코드만, 코드+Wiki, 코드+Wiki+데이터 문맥을 비교한다. 독립된 정답 SQL/fixture와 브라우저 실행 결과로 요구사항 누락, 잘못된 조인, 지표 계산, 영향 대상 누락, 오래된 근거 인용을 측정한다. 시간과 토큰 비용도 기록한다. 모델 자기평가나 합성 계약 검사만으로 품질 개선을 선언하지 않는다.

첫 구현 단위는 의미 규칙 계약, 기존 카탈로그/품질 결과의 정규화된 입력, Wiki 근거 검색 연결이다. 실데이터 조회와 SQL 분석기 배포는 권한, 지원 방언, Windows 패키징을 확인한 다음 단계로 둔다.

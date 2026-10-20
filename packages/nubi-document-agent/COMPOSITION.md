# 요구사항에서 구성을 정하는 작성

`@nubi/document-agent/composition`은 업무 템플릿 없이 호스트 모델이 문서의 구조를 결정하는 선택 진입점이다. 모델, 인증, 승인과 최종 저장은 기존 호스트가 소유한다. 새 평문 초안만 처리한다.

```ts
import {prepareComposition, composeExcel, reviseComposition} from '@nubi/document-agent/composition';

const plan = await prepareComposition('excel', {
  request,
  sources: authorizedSources
}, hostTransport, signal, {datasets});
const candidate = await composeExcel(plan, datasets, signal);
// The host calculates the actual file, checks facts and renders it for review.
const revision = await reviseComposition('excel', {
  request: verificationFeedback,
  plan,
  sources: verificationEvidence,
  datasets
}, hostTransport, signal);
const next = await composeExcel(revision.plan, datasets, signal);
// Final save approval and actual Office readback remain with the host.
```

## 자유도와 제한

| 앱 | 모델이 결정하는 내용 | 현재 제한 |
| --- | --- | --- |
| Word | 문단과 표의 순서, 제목과 본문, 구역 방향, 머리글과 바닥글 | 160개 블록, 표 12열과 100행. 혼합 run, 중첩 표, 그림과 변경 추적 미지원 |
| Excel | 시트 이름과 순서, 데이터 표 위치와 열, 수식과 출력 위치, 병합, 용지와 방향, 인쇄 높이 | 8시트, 시트당 20열과 400행, 전체 12,000셀. 지원 수식 문법만 허용 |
| PowerPoint | 슬라이드 수, 제목과 메시지, 개체 종류와 좌표, 표와 차트 | 12장, 장당 40개 개체, 13.33×7.5인치. 막대와 선 차트, 제한된 도형. 마스터와 SmartArt 미지원 |

문서별 양식, 고정 제목 순서, 셀 주소, PPT 레이아웃 이름을 프롬프트에 넣지 않는다. 지원하는 선언형 개체와 공통 기본 서식은 있다. 한글 글꼴은 호스트가 `fontFamily`로 지정할 수 있다. PPT의 실행 포트는 `composePowerPoint(plan, engine, signal, options)`에 주입한다.

Excel의 `tables[].dataset`과 `columns[].field`는 승인된 레코드의 원천 값을 복사한다. 업무 계산은 모델이 작성한 수식에 있으며, `{row}`는 해당 원천 행의 실제 행 번호로만 치환한다. 수식/셀 중복, 범위, 순환 참조와 외부 참조를 검사한다. 출력 `metric/sheet/cell`은 계산 검사를 위한 위치 표식이며 정답 자체가 아니다.

수식 필드의 선행 `=`는 선택 사항이다. 직렬화할 때 한 번 제거하며 일반 값 필드의 `=...` 문자열은 수식으로 바꾸지 않는다. 새 초안의 수식 참조는 허용된 시트 안에서 전체 열 `A:A`, 전체 행 `1:1`, 아직 값이 없는 셀까지 가능하다. 시트 전체가 알려진 새 초안에서만 빈 셀을 빈 상태로 해석하며 쓰기 한도는 위 표대로 유지한다. 의존성 분석은 실제 할당된 셀과 교차해 순환 참조를 확인하고, 저장 수식의 범위는 줄이지 않는다. 따라서 `COUNTBLANK(A:A)`와 같은 계산의 빈 셀 의미도 보존한다.

Office 2016 함수 목록을 기준으로 한다. `SORT` 같은 이후 버전 함수와 spill 문법은 허용 목록에 추가하지 않고 같은 호스트 모델에 해당 함수와 셀 위치를 알려 대체 수식을 받는다. 생성과 부분 수정 모두 같은 오류 피드백을 사용한다. 이것은 수식 이름/참조 계약이며 함수별 수치 호환 성공을 뜻하지 않는다. [실제 작성과 계산 보완 기록](../../docs/research/2026-10-16-document-agent-excel-authoring-repair.md)에 거부 초안, 입력 변경과 전체 페이지 검토를 남긴다.

`fitToHeight: 0`은 세로 여러 페이지, 양수는 해당 페이지 수에 맞춘 인쇄다. `paper`, `orientation`, `printHeaderRows`도 모델이 정한다. 원천 자료가 많을 때 한 장 맞춤은 작은 글씨를 만들 수 있으므로 실제 렌더를 확인한다. 병합이 기존 값을 지우면 렌더를 거부한다.

## 보완과 검증

`reviseComposition`은 기존 GenOffice 계획 루프로 최대 80개의 JSON Pointer 패치를 준비한다. `applyCompositionPatch`는 복사본에 원자적으로 반영하고 전체 구성을 다시 검사한다. 파일 경로, 스크립트나 실행 코드는 허용하지 않는다. 호스트는 수정 목적에 맞는 비대상 보존 검사를 추가해야 한다. 전체 검증 성공만으로 숫자나 업무 결론이 맞는 것은 아니다.

독립 원천 계산, 파일의 실제 수식 재계산, 입력 변경, 0 조건, 원천 보존, 사실 검토와 렌더 검토를 분리한다. `calculationRequired: true`와 `savedToOffice: false`를 실제 Office 계산/저장 완료로 바꾸지 않는다. 이 진입점은 NASCA 파일을 직접 열거나 기존 회사 문서를 복호화하지 않는다.

실제 호스트 모델의 세 업무 평가와 최초 실패는 [평가 기록](../../docs/research/2026-10-16-document-agent-open-composition-evaluation.md)을 따른다.

# 누비 Office 모의 호스트 실측 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows와 Excel 없이 macOS에서 실제 모델로 누비 Office Excel 실행기를 돌리고, 양식 등록과 재사용의 품질을 채점한다.

**Architecture:** native `WorkbookEngine`의 검증 규칙을 JS로 옮긴 엔진이 메모리 통합문서 위에서 동작한다. 수식 계산은 IronCalc에 맡긴다. 로그인은 별도 세션 프로세스가 한 번만 수행하고, 실행 프로세스는 유닉스 소켓으로 모델 호출만 요청한다.

**Tech Stack:** Node 22.22 이상, `node:test`, `@ironcalc/nodejs` 0.8.3(개발 의존성), 기존 Pi 0.86.1과 worker 모듈.

**Spec:** `docs/superpowers/specs/2026-09-29-nubi-office-live-sim-eval-design.md`

## Global Constraints

- 작업 위치는 `packages/nubi-office`. 새 코드는 `eval/sim/`과 `tests/sim-*.test.mjs`에만 둔다.
- 제품 번들에 넣지 않는다. `@ironcalc/nodejs`는 `devDependencies`에만 추가한다.
- `extensions/aipro-chat`는 수정하지 않는다.
- native와 설치 파일을 빌드하지 않는다.
- 인증값은 세션 프로세스 메모리에만 둔다. 파일, 로그, 기록, 소켓 응답에 쓰지 않는다.
- 복구 승인은 자동 통과시키지 않는다. 의미 채점 대기는 합격에 넣지 않는다.
- 보고서 종류는 `simulated-host-live-model-evaluation`. 실제 Excel 평가와 섞지 않는다.
- 사례 한도: 10분, 모델 호출 80회, 호스트 동작 120회 (`eval/driver.mjs`의 `EVALUATION_LIMITS`).
- 사용자에게 보이는 문구는 한국어.
- 저장소 반영은 `GIT_INDEX_FILE` 임시 인덱스와 `commit-tree`로 한다. 작업 폴더의 브랜치를 바꾸지 않는다.

## 결정 기록

| 결정 | 내용 | 근거 |
|---|---|---|
| 수식 계산기 | `@ironcalc/nodejs` 0.8.3, MIT | 직접 실행해 60개 수식 모두 정답. 한글 시트 이름, 표시 형식 문자열, 순환 참조 검출 지원 |
| 탈락 | `fast-formula-parser` 1.0.19 | 직접 실행해 MAX, MIN, COUNTA, MATCH, SUMIFS, COUNTIFS 등 19개 미구현 확인. 계획 프롬프트가 INDEX/MATCH와 SUMIFS를 권하므로 쓸 수 없다 |
| 계산 방식 | 쓰기마다 입력 전체로 계산기를 새로 만든다 | 400셀 50회 재구성에 5ms. 상태 동기화 오류를 없앤다 |
| 재사용 채점 | 등록 결과가 아니라 정답 명세로 시작 | 등록 오류가 재사용 점수에 번지지 않게 분리 |
| 회사 PC | 실행만 가능, 파일 반출 불가 | 진단 묶음은 화면 요약을 직접 옮겨 적는 형태로 별도 계획에서 설계 |

## 파일 구조

| 파일 | 책임 |
|---|---|
| `eval/sim/calc.mjs` | 시트 입력을 받아 계산값, 오류 여부, 표시 문자열을 돌려준다 |
| `eval/sim/workbook.mjs` | 메모리 통합문서. 셀 입력과 서식, 병합, 입력 제한, 복제 |
| `eval/sim/engine.mjs` | native `WorkbookEngine` 이식 |
| `eval/sim/host.mjs` | native 프로토콜 메서드와 양식 등록, 사본 열기 |
| `eval/sim/transcript.mjs` | 모델 호출 기록 |
| `eval/sim/model-session.mjs` | 로그인 유지와 모델 호출 중계 서버 |
| `eval/sim/relay-providers.mjs` | 실행 프로세스의 providers 대역 |
| `eval/sim/forms.mjs` | 합성 양식 정의와 정답 항목표 |
| `eval/sim/form-scoring.mjs` | 항목 제안 채점 |
| `eval/sim/run.mjs` | 실측 실행기 |

---

### Task 1: 수식 계산 어댑터

**Files:**
- Create: `eval/sim/calc.mjs`
- Test: `tests/sim-calc.test.mjs`
- Modify: `package.json` (`devDependencies`에 `"@ironcalc/nodejs": "0.8.3"`)

**Interfaces:**
- Produces: `calculate(sheets) -> Array<Map<string, {value, error, displayText}>>`
  - `sheets`: `[{name: string, cells: [{row: number, column: number, value: null|number|string|boolean, formula: null|string, numberFormat: string}]}]`. 행과 열은 1부터 시작.
  - 결과 배열의 순서는 `sheets`와 같다. Map의 키는 `` `${row}:${column}` ``.
  - 오류 셀은 `{value: '#EXCEL_ERROR', error: true}`. native `ExcelPort.Read`와 같은 표기다.

- [ ] **Step 1: 의존성 설치**

```bash
cd packages/nubi-office && npm install --save-dev --save-exact @ironcalc/nodejs@0.8.3
```

- [ ] **Step 2: 실패하는 검사 작성**

```js
// tests/sim-calc.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../eval/sim/calc.mjs';

const cell=(row,column,value,extra={})=>({row,column,value,formula:null,numberFormat:'General',...extra});
const formula=(row,column,text,extra={})=>({row,column,value:null,formula:text,numberFormat:'General',...extra});

test('formulas calculate across sheets with Korean names',()=>{
  const [main]=calculate([
    {name:'양식',cells:[cell(2,1,100),cell(3,1,250),formula(4,1,'=SUM(A2:A3)'),formula(5,1,'=SUM(동부!B2:B3,서부!B2:B3)')]},
    {name:'동부',cells:[cell(2,2,120),cell(3,2,80)]},
    {name:'서부',cells:[cell(2,2,50),cell(3,2,150)]}]);
  assert.deepEqual(main.get('4:1'),{value:350,error:false,displayText:'350'});
  assert.equal(main.get('5:1').value,400);
});
test('Excel 2016 lookup and conditional functions are available',()=>{
  const [sheet]=calculate([{name:'S',cells:[cell(2,1,100),cell(3,1,250),cell(2,2,'x'),cell(3,2,'y'),
    formula(5,1,'=INDEX(B2:B3,MATCH(250,A2:A3,0))'),formula(6,1,'=SUMIFS(A2:A3,A2:A3,">100")'),formula(7,1,'=MAX(A2:A3)-MIN(A2:A3)'),formula(8,1,'=IFERROR(1/0,0)')]}]);
  assert.equal(sheet.get('5:1').value,'y');assert.equal(sheet.get('6:1').value,250);assert.equal(sheet.get('7:1').value,150);assert.equal(sheet.get('8:1').value,0);
});
test('errors use the native error marker',()=>{
  const [sheet]=calculate([{name:'S',cells:[formula(1,1,'=1/0'),formula(2,1,'=A2'),formula(3,1,'=NOPE(1)')]}]);
  for(const key of ['1:1','2:1','3:1'])assert.deepEqual({value:sheet.get(key).value,error:sheet.get(key).error},{value:'#EXCEL_ERROR',error:true});
});
test('text keeps leading zeros and number formats shape the displayed text',()=>{
  const [sheet]=calculate([{name:'S',cells:[cell(1,1,'00123'),cell(2,1,1234.5,{numberFormat:'#,##0.00'}),cell(3,1,46296,{numberFormat:'yyyy-mm-dd'}),cell(4,1,0.125,{numberFormat:'0.00%'}),cell(5,1,true),cell(6,1,null)]}]);
  assert.deepEqual(sheet.get('1:1'),{value:'00123',error:false,displayText:'00123'});
  assert.equal(sheet.get('2:1').displayText,'1,234.50');assert.equal(sheet.get('3:1').displayText,'2026-10-01');assert.equal(sheet.get('4:1').displayText,'12.50%');
  assert.equal(sheet.get('5:1').value,true);assert.equal(sheet.has('6:1'),false);
});
```

- [ ] **Step 3: 실패 확인**

Run: `node --test tests/sim-calc.test.mjs`
Expected: `Cannot find module '../eval/sim/calc.mjs'`

- [ ] **Step 4: 구현**

```js
// eval/sim/calc.mjs
// Evaluation-only calculator. Rebuilds the model from inputs on every call so
// no calculator state can drift from the workbook that owns the cells.
import {createRequire} from 'node:module';
const {Model}=createRequire(import.meta.url)('@ironcalc/nodejs');
const ERROR_TYPE=16;

export function calculate(sheets){
  const model=new Model('workbook','en','UTC','en');
  sheets.forEach((sheet,index)=>index?model.addSheet(sheet.name):model.renameSheet(0,sheet.name));
  const failed=new Set();
  sheets.forEach((sheet,index)=>{for(const cell of sheet.cells){
    const {row,column,value,formula}=cell;
    try{
      if(typeof formula==='string')model.updateCellWithFormula(index,row,column,formula);
      else if(typeof value==='number')model.updateCellWithNumber(index,row,column,value);
      else if(typeof value==='boolean')model.updateCellWithBool(index,row,column,value);
      else if(typeof value==='string')model.updateCellWithText(index,row,column,value);
      else continue;
      if(cell.numberFormat&&cell.numberFormat!=='General'){const style=model.getCellStyle(index,row,column);style.num_fmt=cell.numberFormat;model.setCellStyle(index,row,column,style);}
    }catch{failed.add(`${index}:${row}:${column}`);}
  }});
  model.evaluate();
  return sheets.map((sheet,index)=>{
    const results=new Map();
    for(const {row,column,value,formula} of sheet.cells){
      if(formula===null&&value===null)continue;
      const key=`${row}:${column}`;
      if(failed.has(`${index}:${key}`)||model.getCellType(index,row,column)===ERROR_TYPE){results.set(key,{value:'#EXCEL_ERROR',error:true,displayText:failed.has(`${index}:${key}`)?'#NAME?':model.getFormattedCellValue(index,row,column)});continue;}
      results.set(key,{value:model.getCellValue(index,row,column),error:false,displayText:model.getFormattedCellValue(index,row,column)});
    }
    return results;
  });
}
```

- [ ] **Step 5: 통과 확인**

Run: `node --test tests/sim-calc.test.mjs`
Expected: 4개 통과

---

### Task 2: 메모리 통합문서

**Files:**
- Create: `eval/sim/workbook.mjs`
- Test: `tests/sim-workbook.test.mjs`

**Interfaces:**
- Consumes: `calculate(sheets)` (Task 1)
- Produces:
  - `createWorkbook({name, date1904?, readOnly?, sheets}) -> Workbook`
    - `sheets`: `[{name, protected?, cells: {[address]: CellInput}, merges?: string[], hiddenRows?: number[], hiddenColumns?: number[]}]`
    - `CellInput`: `{value?, formula?, validation?, locked?, rowHeight?, columnWidth?, borders?}`와 서식 10개 필드(`bold, italic, fillColor, numberFormat, fontName, fontSize, fontColor, horizontalAlignment, verticalAlignment, wrapText`)
  - `Workbook.documentId: string`, `Workbook.name: string`, `Workbook.sheets: [{id, name, protected}]`, `Workbook.customXml: object[]`
  - `Workbook.read(sheetId, address) -> SheetState` — `{documentId, sheetId, workbook, worksheet, address, date1904, readOnly, protected, cells}`. `cells`는 행렬이며 각 셀은 native `ExcelPort.Read`와 같은 24개 필드를 가진다.
  - `Workbook.write(sheetId, address, patches)` — `patches: [{row, column, field, value}]`. 행과 열은 `address` 기준 0부터. 쓰기 뒤 전체를 다시 계산한다.
  - `Workbook.usedRange(sheetId) -> string`
  - `Workbook.clone({name}) -> Workbook` — 새 `documentId`, 새 시트 ID, 같은 내용.
- 지원하지 않는 입력 제한 종류는 생성 시 `sim_validation_unsupported`를 던진다. 조용히 통과시키지 않는다.

기본값은 한국어 Excel 새 통합문서를 따른다: 글꼴 `맑은 고딕` 11, 글자색 `#000000`, 표시 형식 `General`, 가로 정렬 `general`, 세로 정렬 `center`, 잠금 `true`, 행 높이 16.5, 열 너비 8.38.

- [ ] **Step 1: 실패하는 검사 작성**

```js
// tests/sim-workbook.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbook} from '../eval/sim/workbook.mjs';

const FIELDS=['value','formula','error','bold','italic','fontName','fontSize','fontColor','fillColor','numberFormat','wrapText','horizontalAlignment','verticalAlignment','displayText','locked','mergedAddress','arrayFormula','hiddenRow','hiddenColumn','rowHeight','columnWidth','borders','validation','validationValid'];
const book=()=>createWorkbook({name:'출장신청서.xlsx',sheets:[{name:'신청서',merges:['A1:D1','B3:C3'],cells:{
  A1:{value:'출장 신청서',bold:true,fontSize:14,horizontalAlignment:'center'},A3:{value:'담당 부서'},
  A4:{value:'수량'},B4:{value:3},A5:{value:'단가'},B5:{value:15000,numberFormat:'#,##0'},A6:{value:'합계'},B6:{formula:'=B4*B5',numberFormat:'#,##0'},
  A7:{value:'구분'},B7:{value:'국내',validation:{type:3,formula1:'국내,해외',ignoreBlank:true,inCellDropdown:true,listSeparator:','}}}}]});

test('a read returns every native cell field with Korean Excel defaults',()=>{
  const w=book(),state=w.read(w.sheets[0].id,'A1:D7');
  assert.deepEqual(Object.keys(state.cells[0][0]),FIELDS);
  assert.deepEqual([state.cells.length,state.cells[0].length],[7,4]);
  const plain=state.cells[3][0];
  assert.deepEqual([plain.fontName,plain.fontSize,plain.fontColor,plain.numberFormat,plain.horizontalAlignment,plain.verticalAlignment,plain.locked,plain.rowHeight,plain.columnWidth],['맑은 고딕',11,'#000000','General','general','center',true,16.5,8.38]);
  assert.deepEqual([state.workbook,state.worksheet,state.address,state.readOnly,state.protected,state.date1904],['출장신청서.xlsx','신청서','A1:D7',false,false,false]);
});
test('merged followers are empty and carry the merge address',()=>{
  const w=book(),state=w.read(w.sheets[0].id,'A1:D3');
  assert.deepEqual(state.cells[0].map(c=>c.mergedAddress),['A1:D1','A1:D1','A1:D1','A1:D1']);
  assert.deepEqual(state.cells[0].map(c=>c.value),['출장 신청서',null,null,null]);
  assert.equal(state.cells[2][1].mergedAddress,'B3:C3');assert.equal(state.cells[2][3].mergedAddress,null);
});
test('formulas recalculate after a write and keep their number format text',()=>{
  const w=book(),id=w.sheets[0].id;
  assert.deepEqual([w.read(id,'B6').cells[0][0].value,w.read(id,'B6').cells[0][0].displayText],[45000,'45,000']);
  w.write(id,'B4',[{row:0,column:0,field:'value',value:4}]);
  const total=w.read(id,'B6').cells[0][0];
  assert.deepEqual([total.value,total.formula,total.displayText,total.error],[60000,'=B4*B5','60,000',false]);
});
test('writing a value clears a formula and writing text keeps the text',()=>{
  const w=book(),id=w.sheets[0].id;
  w.write(id,'B6',[{row:0,column:0,field:'value',value:'00123'}]);
  const cell=w.read(id,'B6').cells[0][0];assert.deepEqual([cell.value,cell.formula],['00123',null]);
});
test('list validation reports whether the current value is allowed',()=>{
  const w=book(),id=w.sheets[0].id;
  assert.equal(w.read(id,'B7').cells[0][0].validationValid,true);
  w.write(id,'B7',[{row:0,column:0,field:'value',value:'우주'}]);assert.equal(w.read(id,'B7').cells[0][0].validationValid,false);
  assert.equal(w.read(id,'B4').cells[0][0].validation,null);assert.equal(w.read(id,'B4').cells[0][0].validationValid,null);
});
test('an unsupported validation type is refused instead of passing silently',()=>{
  assert.throws(()=>createWorkbook({name:'b.xlsx',sheets:[{name:'S',cells:{A1:{value:1,validation:{type:7,formula1:'=A1>0'}}}}]}),/sim_validation_unsupported/);
});
test('a clone is an independent document with the same content',()=>{
  const w=book(),copy=w.clone({name:'사본.xlsx'});
  assert.notEqual(copy.documentId,w.documentId);assert.equal(copy.name,'사본.xlsx');
  copy.write(copy.sheets[0].id,'B4',[{row:0,column:0,field:'value',value:9}]);
  assert.equal(w.read(w.sheets[0].id,'B4').cells[0][0].value,3);assert.equal(copy.read(copy.sheets[0].id,'B6').cells[0][0].value,135000);
});
test('the used range covers every cell that has content or a merge',()=>{
  const w=book();assert.equal(w.usedRange(w.sheets[0].id),'A1:D7');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/sim-workbook.test.mjs`
Expected: `Cannot find module '../eval/sim/workbook.mjs'`

- [ ] **Step 3: 구현**

핵심 규칙:
- 셀 저장소는 시트별 `Map<'row:column', cell>`. 저장하는 것은 입력(`value` 또는 `formula`)과 서식, 배치 속성뿐이다. 계산값은 저장하지 않는다.
- `read`와 `write`는 매번 `calculate`를 불러 전체 시트를 계산한다.
- 병합 종속 셀은 값을 가질 수 없다. 생성 시 종속 셀에 값이 있으면 `sim_merge_follower_value`를 던진다.
- `write`의 `field`가 `value`면 `formula`를 지운다. `formula`면 `value`를 지운다. 그 외는 서식 필드다.
- 목록 입력 제한(`type: 3`)의 유효성: 값이 비어 있고 `ignoreBlank`면 유효. 아니면 `String(value)`가 `formula1`을 `listSeparator`로 나눈 목록에 있어야 한다. `formula1`이 `=`로 시작하면 `sim_validation_unsupported`.

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/sim-workbook.test.mjs`
Expected: 8개 통과

---

### Task 3: 엔진 이식

**Files:**
- Create: `eval/sim/engine.mjs`
- Test: `tests/sim-engine.test.mjs`
- 참조: `native/Nubi.Office.Core/WorkbookEngine.cs`, `native/Nubi.Office.Core/CellStyle.cs`, `native/Nubi.Office.Tests/Program.cs`

**Interfaces:**
- Consumes: `Workbook` (Task 2)
- Produces: `createEngine(port) -> Engine`
  - `port`: `{captureSelection() -> SheetState, read(state) -> SheetState, write(state, patches), listSheets(anchor, offset), inspectSheet(anchor, sheetId, part, offset), readRange(anchor, sheetId, address) -> SheetState}`
  - `Engine.selection() -> PublicState` — 새 `scopeId` 발급
  - `Engine.read(scopeId) -> PublicState`
  - `Engine.apply(scopeId, operationId, plan) -> {applied, changedCells, snapshot?, error?, cause?, changeId?, recoverable?, preview?}`
  - `Engine.reconcile(scopeId, operationId, plan) -> {outcome: 'not_started'|'complete'|'partial'|'uncertain', result?}`
  - `Engine.restore(changeId) -> {restored, changeId}`
  - `Engine.history() -> object[]`
  - `Engine.listSheets(scopeId, offset)`, `Engine.inspectSheet(scopeId, sheetId, part, offset)`, `Engine.readWorkbookRange(scopeId, sheetId, address)`
  - `Engine.boundState(scopeId, fingerprint) -> SheetState`
  - `describe(state) -> PublicState`
  - `fingerprint(state) -> string`
  - 오류는 `Object.assign(new Error(code), {code})`로 던진다.
- `PublicState`: `{scopeId, documentId, worksheet, workbook, address, date1904, readOnly, protected, values, formulas, errors, displayTexts, formats, properties, fingerprint}`. `formats`는 서식 10개, `properties`는 `locked, mergedAddress, arrayFormula, validation, rowHeight, columnWidth, hiddenRow, hiddenColumn, borders, validationValid`.

- [ ] **Step 1: native 계약 검사를 읽고 시나리오 목록을 만든다**

`native/Nubi.Office.Tests/Program.cs`의 각 시나리오에서 입력 계획과 기대 오류 코드를 옮겨 적는다.

- [ ] **Step 2: 실패하는 검사 작성**

검사가 다루는 규칙. 각 항목이 검사 하나다.

| 규칙 | 입력 | 기대 |
|---|---|---|
| 값 쓰기 | `set_values A1 [[42]]` | `applied: true`, 스냅샷의 A1 값 42 |
| 수식 쓰기와 계산 | `set_formulas A3 [['=SUM(A1:A2)']]` | 수식 보존, 값 계산됨 |
| 서식 쓰기 | `format_range A1 {bold:true, fillColor:'#ffcc00'}` | `bold: true`, `fillColor: '#FFCC00'` |
| 범위 밖 | 선택 `A1:B2`, 대상 `C1` | `out_of_scope` |
| 격자 크기 불일치 | `A1:B1`에 `[[1]]` | `invalid_grid` |
| 수식처럼 보이는 문자열 | `set_values`에 `'=1+1'`, `'+1'`, `'@x'` | `invalid_value` |
| Excel 2016에 없는 함수 | `=XLOOKUP(...)`, `=FILTER(...)`, `=LET(...)` | `unsupported_formula` |
| 외부 참조 | `='[other.xlsx]S'!A1` | `unsupported_formula` |
| 겹치는 작업 | 같은 셀에 값 두 번 | `overlapping_operations` |
| 허용하지 않는 키 | 계획에 `extra` | `invalid_plan` |
| 잘못된 서식 값 | `fontSize: 0`, `fontColor: 'red'` | `invalid_format` |
| 병합 종속 셀 쓰기 | 병합 `B2:C2`의 `C2`에 값 | `unsupported_target` |
| 병합 기준 셀 쓰기 | 병합 `B2:C2`의 `B2`에 값 | 성공 |
| 선택 밖으로 나가는 병합 | 선택 `A1:B2`, 병합 `B2:C2`의 `B2` | `unsupported_target` |
| 읽기 전용과 보호 | `readOnly` 또는 `protected` | `workbook_not_writable` |
| 입력 제한 위반 | 목록에 없는 값 | `applied: false`, `error: 'validation_failed'` 또는 `partial_change`와 `cause: 'validation_failed'` |
| 같은 작업 ID 재전송 | 같은 계획 | 저장된 결과 반환, 쓰기 1회 |
| 같은 작업 ID에 다른 계획 | | `operation_collision` |
| 쓰기 전 외부 변경 | 선택 뒤 값이 바뀜 | `cells_changed` |
| 복원 | 값 변경 뒤 `restore` | 원래 값, `restored: true` |
| 복원 충돌 | 변경 뒤 외부 수정, `restore` | `recovery_conflict` |
| 만료된 범위 | 없는 `scopeId` | `scope_expired` |
| 크기 제한 | 1,001셀 선택 | `range_limit` |
| 지문 | 같은 상태 두 번 읽기 | 같은 지문. 값이 바뀌면 다른 지문 |

- [ ] **Step 3: 실패 확인**

Run: `node --test tests/sim-engine.test.mjs`
Expected: `Cannot find module '../eval/sim/engine.mjs'`

- [ ] **Step 4: 구현**

`WorkbookEngine.cs`의 메서드를 같은 이름과 순서로 옮긴다: `Compile`, `ValidateTarget`, `ApplyTo`, `Verify`, `Equivalent`, `Apply`, `Reconcile`, `Restore`, `History`, `ValidateState`, `PublicState`, `Preview`. 지문은 `sha256(documentId|sheetId|address|date1904|readOnly|protected|JSON(cells))`의 base64다.

옮길 때 바꾸지 않는 것:
- 쓰기 전에 영수증을 먼저 기록한다. 기본 결과는 `write_uncertain`이다.
- `Verify`는 패치한 셀만이 아니라 선택 범위 전체를 비교한다. 수식 셀의 계산값 변화는 허용한다.
- 배치 속성이 바뀌면 `recoverable: false`다.

- [ ] **Step 5: 통과 확인**

Run: `node --test tests/sim-engine.test.mjs`
Expected: 표의 24개 규칙 모두 통과

---

### Task 4: 모의 호스트

**Files:**
- Create: `eval/sim/host.mjs`
- Test: `tests/sim-host.test.mjs`
- 참조: `native/Nubi.Office.EvalHost/Program.cs`, `native/Nubi.Office.Host/ExcelTemplateStore.cs`, `native/Nubi.Office.Host/ExcelWorkbookReader.cs`

**Interfaces:**
- Consumes: `createWorkbook`, `createEngine`, `describe`
- Produces: `createSimHost() -> {call(method, payload) -> Promise<object>, close()}`
  - 기존 평가 호스트와 같은 메서드: `init, read, apply, reconcile, restore, history, audit, auditSources, saveReopen, workbook_sheets, workbook_structure, workbook_range`
  - 양식 메서드: `template_register {scopeId, record, expectedFingerprint}`, `template_catalog_index {templateId}`, `template_open_copy {templateId}` → `{copied, record, path, comparison, scope}`, `template_install {record}` → 정답 명세로 등록본을 만든다
  - `init`의 `host` 응답: `{evaluationProtocol: 4, platform: 'simulated', simulated: true, calculator: '@ironcalc/nodejs'}`
  - 오류는 `call`이 `Error(code)`로 거절한다. 실행기가 `{error: code}`로 바꾼다.
- `init`은 기존 `eval/cases.json` 형식을 그대로 받는다. 셀 정의에 서식 필드와 `validation`을 추가로 쓸 수 있다.

- [ ] **Step 1: 실패하는 검사 작성**

검사 항목:
- `init`이 `scope`, `before`, `sourcesBefore`, `host.simulated === true`를 돌려준다. `scope.address`는 사례의 `range`, `before.address`는 `auditRange`.
- `init`의 `merges`와 `sourceSheets`가 반영된다.
- `apply` 뒤 `audit`이 변경을 보여준다. 다른 시트는 `auditSources`에서 변하지 않는다.
- `saveReopen` 뒤 값과 수식, 서식이 같다. 계산값은 다시 계산된 값이다.
- `workbook_sheets`가 시트 목록을 페이지로 돌려준다. `workbook_range`는 `kind: 'workbook_range'`, `readOnly: true`, `sourceScopeId`를 가진다.
- `template_register`가 `saved, id, metadataVerified, comparison.before, comparison.after`를 돌려준다. 원본 통합문서는 바뀌지 않는다. 지문이 다르면 `cells_changed`.
- `template_catalog_index`가 등록하지 않은 ID에 `template_not_found`.
- `template_open_copy`가 새 `documentId`의 범위를 돌려준다. 사본에 쓴 값이 등록본에 영향을 주지 않는다.
- 기존 검사 구성(`tests/harness-fixtures.mjs`의 `scriptedProvider`)으로 `startAgent`를 끝까지 돌려 A1을 42로 바꾼다. 모의 호스트가 실제 실행기와 맞물리는지 확인하는 검사다.

- [ ] **Step 2: 실패 확인**

Run: `node --test tests/sim-host.test.mjs`
Expected: `Cannot find module '../eval/sim/host.mjs'`

- [ ] **Step 3: 구현**

- [ ] **Step 4: 통과 확인**

Run: `node --test tests/sim-host.test.mjs`

---

### Task 5: 모델 호출 기록

**Files:**
- Create: `eval/sim/transcript.mjs`
- Test: `tests/sim-transcript.test.mjs`

**Interfaces:**
- Produces: `recordingProviders(providers, write) -> providers`
  - `write(entry)`는 호출마다 한 번 불린다.
  - `entry`: `{sequence, role, startedAt, elapsedMs, request: {messages, toolNames, characters}, response?: {content, calls, finishReason, usage}, error?: {code, status?, retryAfterMs?}}`
  - `role`: 시스템 프롬프트 앞부분으로 정한다. `NUBI_TASK_PLANNER` → `planner`, `NUBI_ACTION_REVIEWER` → `action_review`, `NUBI_STEP_REVIEWER` → `step_review`, `NUBI_RESULT_REVIEWER` → `result_review`, `NUBI_RECOVERY_PLANNER` → `recovery`, `You are Nubi for Excel` → `actor`, 그 외 → `other`.
  - `status`와 나머지 메서드는 원래 providers에 그대로 넘긴다.
- Produces: `summarize(entries) -> {modelCalls, byRole, elapsedMs, requestCharacters, toolCalls: {[name]: count}, errors: {[code]: count}}`

- [ ] **Step 1: 실패하는 검사 작성**

검사 항목:
- 성공한 호출이 역할, 도구 이름, 문자 수, 응답을 기록한다.
- 실패한 호출이 오류 코드와 `status`를 기록하고 원래 오류를 다시 던진다.
- 기록 항목에 `token`, `credential`, `Authorization`이라는 키가 없다.
- `summarize`가 역할별 호출 수와 도구별 호출 수를 센다.

- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인**

Run: `node --test tests/sim-transcript.test.mjs`

---

### Task 6: 모델 중계 세션

**Files:**
- Create: `eval/sim/model-session.mjs`, `eval/sim/relay-providers.mjs`
- Test: `tests/sim-relay.test.mjs`

**Interfaces:**
- Produces: `startRelayServer({providers, socketPath}) -> Promise<{close()}>`
  - 줄 단위 JSON. 요청 `{id, method: 'status'|'complete'|'cancel', messages?, tools?}`, 응답 `{id, ok, result?, error?: {code, status?, retryAfterMs?}}`.
  - 응답에 넣는 `status`는 `{provider, model, connected, vision, models}`뿐이다.
  - 연결이 끊기면 그 연결의 진행 중 요청을 취소한다.
- Produces: `connectRelayProviders({socketPath}) -> Promise<providers>`
  - `status()`는 동기 함수다. 연결할 때 받은 상태를 돌려준다.
  - `complete(messages, tools, signal, onText, onPhase)`. `signal`이 취소되면 `cancel`을 보내고 `Error('cancelled')`로 거절한다.
  - `dispose()`
- CLI: `node eval/sim/model-session.mjs --socket <경로> --provider chatgpt --model gpt-5.6-luna`. 로그인이 끝나면 표준 출력에 `READY`를 한 줄 쓴다.

- [ ] **Step 1: 실패하는 검사 작성**

검사는 가짜 providers로 서버를 띄운다. 실제 로그인은 하지 않는다.
- `status`와 `complete`가 소켓을 건너 같은 결과를 돌려준다.
- 동시에 보낸 두 요청이 각자의 응답을 받는다.
- 제공자 오류의 코드와 `status`, `retryAfterMs`가 보존된다.
- 취소하면 서버 쪽 `signal`이 취소된다.
- 가짜 providers의 세션에 `token` 값을 넣어 두고, 소켓으로 오간 모든 바이트에 그 값이 없는지 확인한다.

- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인**

Run: `node --test tests/sim-relay.test.mjs`

---

### Task 7: 합성 양식과 채점

**Files:**
- Create: `eval/sim/forms.mjs`, `eval/sim/form-scoring.mjs`
- Test: `tests/sim-forms.test.mjs`

**Interfaces:**
- Produces: `forms: Form[]`
  - `Form`: `{id, title, workbook, range, registerRequest, fields, reuse}`
  - `fields`: 정답 항목표 `[{address, label, valueType, required}]`
  - `reuse`: `{request, dialogue: [{match, answer}], checks, allowedChanges}`
- Produces: `scoreMapping(proposed, gold) -> {precision, recall, exact, typeMatches, missing, unexpected, wrongType}`

양식 네 개. 모두 합성 자료다.

| ID | 특징 |
|---|---|
| `trip-request` 출장 신청서 | 병합 제목, 병합 라벨과 입력 칸, 날짜, 목록 입력 제한 |
| `expense-report` 지출 결의서 | 라벨과 입력 칸 쌍, 금액 표시 형식, 합계 수식, 앞자리 0이 있는 코드 |
| `training-request` 교육 신청서 | 세로로 병합한 구역 라벨, 퍼센트, 예시 값이 미리 채워진 칸 |
| `quotation` 견적서 | 품목 표(반복 행), 행별 금액 수식, 공급가액과 세액과 합계 |

`quotation`의 표는 현재 도구가 단일 셀 항목만 지원하므로 품목 칸마다 항목이 된다. 표를 항목으로 다루는 개선의 기준선이다.

- [ ] **Step 1: 실패하는 검사 작성**

검사 항목:
- 모든 양식이 `createWorkbook`으로 만들어지고, 정답 항목의 주소가 `analyzeTemplate`에서 `candidate`다.
- 정답 항목표로 `createTemplateSession`의 `propose`, `confirm`, `profile`이 성공한다.
- `scoreMapping`: 정답과 같으면 `exact: true`. 수식 칸을 제안하면 `unexpected`에 들어가고 정밀도가 내려간다. 항목을 빠뜨리면 재현율이 내려간다. 값 종류가 다르면 `wrongType`에 들어가고 `exact: false`다.

- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인**

Run: `node --test tests/sim-forms.test.mjs`

---

### Task 8: 실측 실행기

**Files:**
- Create: `eval/sim/run.mjs`
- Test: `tests/sim-run.test.mjs`

**Interfaces:**
- Consumes: 앞의 모든 모듈, `eval/driver.mjs`의 `driveEvaluationRun`, `eval/scoring.mjs`의 `scoreCase`, `eval/interactions.mjs`의 `fixtureInteraction`
- Produces: `evaluateSimulated({providers, suites, caseIds?, trials?, outputDir}) -> Promise<Report>`
  - `suites`: `'edit' | 'template' | 'register' | 'reuse'`의 배열
  - `Report`: `{kind: 'simulated-host-live-model-evaluation', schema: 1, provider, model, startedAt, finishedAt, limits, results, summary, limitations}`
  - `results[i]`: `{suite, id, trial, passed, outcome, state, error?, metrics, transcript: summarize(...), score}`
- CLI: `node eval/sim/run.mjs --socket <경로> --suites register,reuse --out verification/sim-live/<ID>`

사용자 역할의 규칙:
- `show_plan`: 표시했다고 응답
- `request_approval` `kind: 'edit'`: 승인
- `request_approval` `kind: 'template_mapping'`: 등록 묶음에서는 제안을 기록하고 승인. 채점은 따로 한다. 양식 채우기 묶음에서는 기존 `fixtureInteraction` 규칙대로 정답과 같을 때만 승인
- `request_approval` `kind: 'template_register'`: 승인
- `request_approval` `kind: 'recovery'`: 승인하지 않고 사례를 중단
- `request_input`: 사례의 `dialogue`에서 하나만 맞을 때 답한다. 아니면 중단

- [ ] **Step 1: 실패하는 검사 작성**

미리 작성한 모델 응답으로 실행기 전체를 돌린다.
- 편집 사례 `value-and-format`이 통과로 채점된다.
- 등록 사례에서 정답과 같은 제안이 `exact: true`로 채점되고 등록 영수증이 남는다.
- 등록 사례에서 수식 칸을 제안하면 실행기가 거절하고 채점이 실패한다.
- 재사용 사례가 정답 명세로 시작해 값을 채우고 통과한다. 등록본은 바뀌지 않는다.
- 복구 승인 요청이 오면 승인하지 않고 `evaluation_recovery_requires_human`으로 끝난다.
- 보고서의 `kind`와 `limitations`가 채워진다.
- 사례별 기록 파일이 만들어진다.

- [ ] **Step 2~4: 실패 확인, 구현, 통과 확인**

Run: `node --test tests/sim-run.test.mjs`

---

### Task 9: 전체 확인과 기록

- [ ] **Step 1: 전체 검사**

Run: `npm test` 와 `npm run test:pinned`
Expected: 기존 712개 통과는 유지. 남은 실패는 제품 결정 대기 2건뿐.

- [ ] **Step 2: 문서 갱신**

`docs/HANDOFF-2026-09-29.md`, `docs/IMPROVEMENT-STATUS.md`, `eval/README.md`에 모의 실측의 실행 방법과 근거 경계를 적는다. `docs/TEMPLATE-SNAPSHOT-RESEARCH-2026-09-29.md`의 수식 계산기 권고를 직접 실행한 결과로 고친다.

- [ ] **Step 3: 저장소 반영**

바뀐 파일만 임시 인덱스에 넣어 커밋하고 `plaire48/llm_router_office`의 `main`에 올린다.

- [ ] **Step 4: 실모델 기준선 측정**

사용자가 브라우저에서 ChatGPT 로그인을 해야 한다. 로그인 뒤 `register`, `reuse`, `template`, `edit` 묶음을 사례당 1회 실행하고 실패를 분류한다. 결과는 다음 계획의 입력이다.

## Self-Review

- 설계 4.1 모의 호스트: Task 2, 3, 4
- 설계 4.2 모델 중계 세션: Task 6
- 설계 4.3 기록: Task 5
- 설계 4.4 보고서: Task 8
- 설계 5 사례: Task 7, 8. 기존 새 문서 사례 4개는 문서 호스트 모의 구현이 필요해 이 계획에서 뺐다.
- 설계 6 개선 루프: Task 9 Step 4부터. 개선 자체는 기준선 뒤 별도 계획.
- 설계 7 양식 스냅샷 개선: 별도 계획. 이 계획은 측정 기반만 만든다.

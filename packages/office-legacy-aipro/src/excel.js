import { validateInput, validatePlan, rectangle } from '../../office-copilot-aipro/src/contract-schema.js';

const clone = value => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function addressOf(address) { return address.slice(address.lastIndexOf('!') + 1).replace(/\$/g, ''); }
export async function readSelection(excel = window.Excel) {
  return excel.run(async context => {
    const range = context.workbook.getSelectedRange();
    range.load('address,rowCount,columnCount'); range.worksheet.load('id,name');
    await context.sync();
    if (range.rowCount * range.columnCount > 1000) throw new Error('한 번에 1,000셀까지 선택할 수 있습니다. 결과를 넣을 빈 셀도 함께 선택하세요.');
    range.load('values,formulas'); await context.sync();
    return { sheetId: range.worksheet.id, worksheet: range.worksheet.name, address: addressOf(range.address), values: clone(range.values), formulas: clone(range.formulas) };
  });
}
export function makeInput(snapshot, request, mode) {
  return validateInput({ request, mode, worksheet: snapshot.worksheet, address: snapshot.address, values: snapshot.values, formulas: snapshot.formulas });
}
export async function readSnapshot(snapshot, excel = window.Excel) {
  return excel.run(async context => {
    const sheet = context.workbook.worksheets.getItem(snapshot.sheetId), range = sheet.getRange(snapshot.address);
    sheet.load('name'); range.load('values,formulas'); await context.sync();
    if (sheet.name !== snapshot.worksheet) throw new Error('시트 이름이 바뀌었습니다. 다시 요청하세요.');
    return { ...snapshot, values: clone(range.values), formulas: clone(range.formulas) };
  });
}
function checkFormatOverlap(operations) {
  const targets = new Set();
  for (const op of operations) {
    if (op.type !== 'format_range') continue;
    const rect = rectangle(op.address);
    for (let row = rect.row; row <= rect.endRow; row++) for (let col = rect.column; col <= rect.endColumn; col++) {
      for (const key of ['bold', 'numberFormat', 'fillColor']) if (op[key] !== undefined) {
        const id = `${row}:${col}:${key}`;
        if (targets.has(id)) throw new Error('같은 셀의 서식을 중복 지정한 응답입니다. 요청을 나누어 다시 실행하세요.');
        targets.add(id);
      }
    }
  }
}
export async function applyPlan(snapshot, raw, input, excel = window.Excel) {
  const plan = validatePlan({ answer: raw.answer, operations: raw.operations }, input);
  if (!plan.operations.length) return { applied: false, operations: 0 };
  checkFormatOverlap(plan.operations);
  let writesQueued = false;
  try {
    return await excel.run(async context => {
      const sheet = context.workbook.worksheets.getItem(snapshot.sheetId);
      const scope = sheet.getRange(snapshot.address); scope.load('values,formulas'); sheet.load('name');
      await context.sync();
      if (sheet.name !== snapshot.worksheet || !same(scope.values, snapshot.values) || !same(scope.formulas, snapshot.formulas)) throw new Error('요청한 뒤 셀 내용이 바뀌었습니다. 현재 내용을 읽고 다시 요청하세요.');
      const area = rectangle(snapshot.address), expected = new Map(), formats = [];
      for (const op of plan.operations) {
        const target = sheet.getRange(op.address), rect = rectangle(op.address);
        writesQueued = true;
        if (op.type === 'set_values' || op.type === 'set_formulas') {
          const isFormula = op.type === 'set_formulas';
          const data = isFormula ? op.formulas : op.values.map(row => row.map(value => value === null ? '' : value));
          if (isFormula) target.formulas = data; else target.values = data;
          data.forEach((row, r) => row.forEach((value, c) => expected.set(`${rect.row - area.row + r}:${rect.column - area.column + c}`, { value, isFormula })));
        } else {
          if (op.bold !== undefined) target.format.font.bold = op.bold;
          if (op.fillColor !== undefined) target.format.fill.color = op.fillColor;
          if (op.numberFormat !== undefined) target.numberFormat = Array.from({ length: rect.rows }, () => Array(rect.columns).fill(op.numberFormat));
          formats.push({ op, target });
        }
      }
      await context.sync();
      scope.load('values,formulas,valueTypes');
      for (const { op, target } of formats) {
        if (op.bold !== undefined) target.format.font.load('bold');
        if (op.fillColor !== undefined) target.format.fill.load('color');
        if (op.numberFormat !== undefined) target.load('numberFormat');
      }
      await context.sync();
      for (const [key, want] of expected) {
        const [r, c] = key.split(':').map(Number);
        const observed = want.isFormula ? scope.formulas[r][c] : scope.values[r][c];
        if (observed !== want.value) throw new Error('셀에 반영된 값이 요청 결과와 다릅니다.');
        if (want.isFormula && scope.valueTypes[r][c] === 'Error') throw new Error('적용한 수식에서 Excel 오류가 발생했습니다. 수식을 확인하세요.');
      }
      for (const { op, target } of formats) {
        if (op.bold !== undefined && target.format.font.bold !== op.bold) throw new Error('굵게 서식 확인에 실패했습니다.');
        if (op.fillColor !== undefined && target.format.fill.color.toUpperCase() !== op.fillColor.toUpperCase()) throw new Error('배경색 확인에 실패했습니다.');
        if (op.numberFormat !== undefined && target.numberFormat.some(row => row.some(value => value !== op.numberFormat))) throw new Error('표시 형식 확인에 실패했습니다.');
      }
      return { applied: true, operations: plan.operations.length };
    });
  } catch (error) {
    if (writesQueued) throw new Error(`일부 변경이 이미 반영되었을 수 있습니다. 자동 재실행하지 않았습니다. ${error.message || 'Excel 셀을 확인하세요.'}`);
    throw error;
  }
}

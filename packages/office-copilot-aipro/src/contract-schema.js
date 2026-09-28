import { z } from 'zod';

// Dynamic schema compilation emits modern syntax that older Office webviews cannot parse.
z.config({ jitless: true });

const cell = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null()]);
const matrix = z.array(z.array(cell).min(1).max(1000)).min(1).max(1000);
const address = z.string().regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}(?::[A-Z]{1,3}[1-9][0-9]{0,6})?$/);
export const inputSchema = z.object({
  request: z.string().trim().min(1).max(8000).describe('The user request; do not include credentials.'),
  mode: z.enum(['analyze', 'edit']).describe('Use edit only when the user requested workbook changes.'),
  worksheet: z.string().min(1).max(31).describe('Exact worksheet name observed in Excel.'),
  address: address.describe('Observed selected range, A1 notation without worksheet prefix.'),
  values: matrix.describe('Observed cell values in the selected range, including blank destination cells.'),
  formulas: matrix.optional().describe('Observed formulas in the same shape; include before requesting edits.'),
}).strict();

const operation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_values'), address, values: matrix }).strict(),
  z.object({ type: z.literal('set_formulas'), address, formulas: z.array(z.array(z.string().max(2000)).min(1).max(1000)).min(1).max(1000) }).strict(),
  z.object({
    type: z.literal('format_range'), address,
    bold: z.boolean().optional(),
    numberFormat: z.string().min(1).max(80).optional(),
    fillColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }).strict().refine(value => ['bold', 'numberFormat', 'fillColor'].some(key => value[key] !== undefined)),
]);
export const planSchema = z.object({
  answer: z.string().min(1).max(12000),
  operations: z.array(operation).max(20),
}).strict();

export function rectangle(value) {
  const convert = text => {
    const [, letters, digits] = /^([A-Z]+)([0-9]+)$/.exec(text);
    const column = [...letters].reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0);
    const row = Number(digits);
    if (column > 16384 || row > 1048576) throw new Error('Range exceeds Excel limits.');
    return { column, row };
  };
  const [first, last = first] = address.parse(value).split(':');
  const start = convert(first), end = convert(last);
  if (end.column < start.column || end.row < start.row) throw new Error('Range is reversed.');
  return { ...start, endColumn: end.column, endRow: end.row, rows: end.row - start.row + 1, columns: end.column - start.column + 1 };
}

function dimensions(data, range) {
  if (data.length !== range.rows || data.some(row => row.length !== range.columns)) throw new Error('Cell data does not match the selected range.');
}

export function validateInput(raw) {
  const input = inputSchema.parse(raw);
  const range = rectangle(input.address);
  if (range.rows * range.columns > 1000 || JSON.stringify(input).length > 100000) throw new Error('Select at most 1,000 cells and 100 KB of content.');
  dimensions(input.values, range);
  if (input.formulas) dimensions(input.formulas, range);
  if (input.mode === 'edit' && !input.formulas) throw new Error('Read current formulas before requesting edits.');
  return input;
}

export function validatePlan(raw, input) {
  const plan = planSchema.parse(raw);
  if (input.mode === 'analyze' && plan.operations.length) throw new Error('An analysis request cannot propose edits.');
  const scope = rectangle(input.address);
  let writtenCells = 0;
  for (const op of plan.operations) {
    const target = rectangle(op.address);
    if (target.row < scope.row || target.column < scope.column || target.endRow > scope.endRow || target.endColumn > scope.endColumn) throw new Error('The plan writes outside the selected range.');
    writtenCells += target.rows * target.columns;
    if (writtenCells > 2000) throw new Error('Too many changes in one request.');
    if (op.type === 'set_values') {
      dimensions(op.values, target);
      if (op.values.flat().some(value => typeof value === 'string' && /^[\s]*[=+\-@]/.test(value))) throw new Error('Formula-like text must not be written as raw values.');
    }
    if (op.type === 'set_formulas') {
      dimensions(op.formulas, target);
      for (const formula of op.formulas.flat()) {
        if (!formula.startsWith('=') || /[\[\]|!\r\n]/.test(formula) || /(?:https?:|WEBSERVICE\s*\(|HYPERLINK\s*\(|RTD\s*\(|IMAGE\s*\()/i.test(formula)) throw new Error('Only formulas local to the selected worksheet are supported.');
      }
    }
  }
  return plan;
}

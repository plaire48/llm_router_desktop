export function fakeExcel() {
  const state = { values: [[10, 20], [30, '']], formulas: [[10, 20], [30, '']], types: [['Double', 'Double'], ['Double', 'Empty']], styles: [[{}, {}], [{}, {}]], syncs: 0, writes: 0, failure: false };
  const rect = address => {
    const [a, b = a] = address.split(':');
    const cell = text => [Number(text.slice(1)) - 1, text.charCodeAt(0) - 65];
    return [...cell(a), ...cell(b)];
  };
  function range(address) {
    const [r, c, lastR, lastC] = rect(address);
    const get = key => state[key].slice(r, lastR + 1).map(row => row.slice(c, lastC + 1));
    const each = fn => { for (let y = r; y <= lastR; y++) for (let x = c; x <= lastC; x++) fn(y, x); };
    const style = key => ({ load() {}, get [key]() { return state.styles[r][c][key]; }, set [key](value) { each((y, x) => { state.styles[y][x][key] = value; state.writes++; }); } });
    return {
      load() {}, address: `Sheet1!${address}`, rowCount: lastR - r + 1, columnCount: lastC - c + 1, worksheet: sheet,
      get values() { return get('values'); }, set values(data) { each((y, x) => { state.values[y][x] = data[y-r][x-c]; state.formulas[y][x] = data[y-r][x-c]; state.writes++; }); },
      get formulas() { return get('formulas'); }, set formulas(data) { each((y, x) => { state.formulas[y][x] = data[y-r][x-c]; state.values[y][x] = 30; state.types[y][x] = state.formulaError ? 'Error' : 'Double'; state.writes++; }); },
      get valueTypes() { return get('types'); },
      get numberFormat() { return get('styles').map(row => row.map(cell => cell.numberFormat)); }, set numberFormat(data) { each((y,x) => { state.styles[y][x].numberFormat = data[y-r][x-c]; state.writes++; }); },
      format: { font: style('bold'), fill: style('color') },
    };
  }
  const sheet = { id: 'sheet-id', name: 'Sheet1', load() {}, getRange: range };
  const context = { workbook: { getSelectedRange: () => range('A1:B2'), worksheets: { getItem(id) { if (id !== sheet.id) throw new Error('Sheet missing'); return sheet; } } }, async sync() { state.syncs++; if (state.failure && state.writes) throw new Error('Simulated sync failure'); } };
  return { state, excel: { run: async callback => callback(context) } };
}

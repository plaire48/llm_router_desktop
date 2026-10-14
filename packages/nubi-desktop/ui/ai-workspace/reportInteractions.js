import { summarizeAutomationRate } from './automationRate';

const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const missing = (value) => value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value));

export function getPage(total, size, requestedPage) {
  const pageSize = Math.max(1, Math.floor(Number(size) || 10));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Math.floor(Number(requestedPage) || 1)));
  return { page, pageSize, pageCount, start: (page - 1) * pageSize, end: Math.min(page * pageSize, total), total };
}

export function columnValue(row, column) { return column.value ? column.value(row) : row[column.key]; }
function filterValues(row, column) {
  const values = column.filterValues ? column.filterValues(row) : [columnValue(row, column)];
  return values.length ? values : [null];
}
export function filterValueKey(value) { return JSON.stringify(missing(value) ? null : value); }
export function filterTableRows(rows, columns, filters) {
  return rows.filter((row) => columns.every((column) => !Object.hasOwn(filters, column.key) || filterValues(row, column).some(value => filters[column.key].includes(filterValueKey(value)))));
}

// Facet choices follow every other column's filter; the current column stays editable.
export function columnFilterOptions(rows, columns, filters = {}) {
  return Object.fromEntries(columns.map(column => {
    const otherFilters = Object.fromEntries(Object.entries(filters).filter(([key]) => key !== column.key));
    const values = new Map();
    for (const row of filterTableRows(rows, columns, otherFilters)) {
      for (const value of filterValues(row, column)) {
        const key = filterValueKey(value);
        if (!values.has(key)) values.set(key, { key, label: key === 'null' ? '미입력' : String(value) });
      }
    }
    return [column.key, [...values.values()].sort((a, b) => collator.compare(a.label, b.label))];
  }));
}

export function togglePageSelection(ids, pageRows, getId = row => row.id) {
  const next = new Set(ids);
  const remove = pageRows.length > 0 && pageRows.every((row) => next.has(getId(row)));
  for (const row of pageRows) remove ? next.delete(getId(row)) : next.add(getId(row));
  return next;
}

export function sortReportRows(rows, sort, getValue = (row, key) => row[key], compareValues) {
  if (!sort?.key) return [...rows];
  return [...rows].sort((a, b) => {
    const av = getValue(a, sort.key), bv = getValue(b, sort.key);
    // Unknown values stay last in either direction; zero remains a real value.
    if (missing(av) || missing(bv)) return Number(missing(av)) - Number(missing(bv));
    const comparison = compareValues ? compareValues(av, bv) : typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
    return comparison * (sort.direction === 'desc' ? -1 : 1);
  });
}

export function groupAutomationRows(rows, by) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify(by === 'activity' ? [row.process, row.activity] : [row.process]);
    if (!groups.has(key)) groups.set(key, { key, process: row.process, activity: row.activity, rows: [] });
    groups.get(key).rows.push(row);
  }
  return [...groups.values()].map((group) => ({ ...group, ...summarizeAutomationRate(group.rows) }));
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  // Text entered by users must remain text when opened in spreadsheet software.
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function createReportCsv(rows, columns) {
  return '\uFEFF' + [columns.map((column) => csvCell(column.label)).join(','), ...rows.map((row) => columns.map((column) => csvCell(column.value ? column.value(row) : row[column.key])).join(','))].join('\r\n');
}

export function downloadReportCsv(rows, columns, filename) {
  const url = URL.createObjectURL(new Blob([createReportCsv(rows, columns)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

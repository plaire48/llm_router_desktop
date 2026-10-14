import { ActionButton } from './ActionButton';
import {SearchField} from './SearchField';
import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { formatAutomationRate, summarizeAutomationRate } from './automationRate';
import { TableViewport } from './WorkspaceMemory';
import { togglePageSelection } from './reportInteractions';
import {useFeedback} from './Toast';
import { ActiveColumnFilters, ColumnFilter, ColumnResize, ControlledTable, PageSizeSelect } from './TableControls';

export function SortHeader({ label, field, sort, onSort, className = '', unit, pinned = false, onPin, pinHint }) {
  const active = sort.key === field;
  const direction = active && sort.direction === 'asc' ? 'desc' : 'asc';
  return <th scope="col" data-column={field} data-column-pinned={pinned||undefined} style={pinned?{left:`var(--frozen-${field})`}:undefined} className={className} aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}><div className="table-th-content">
    {onPin&&<button className="cx-column-pin" type="button" aria-pressed={pinned} aria-label={`${label} 열 고정`} title={pinHint||`${label}: ${pinned?'클릭하면 열 고정 해제':'클릭하면 이 열 고정'}`} onClick={()=>onPin(field)}><span>{label}{unit&&<small>{unit}</small>}</span></button>}
    <button className={`cx-sort-button${onPin?' cx-column-sort':''}`} type="button" aria-label={onPin?`${label} ${direction==='asc'?'오름차순':'내림차순'} 정렬`:undefined} title={onPin?`${direction==='asc'?'오름차순':'내림차순'} 정렬`:undefined} onClick={() => onSort({ key: field, direction })}>
      {!onPin&&<span>{label}{unit && <small>{unit}</small>}</span>}<Icon name={active ? sort.direction === 'asc' ? 'arrowUp' : 'arrowDown' : 'sort'} size={14} />
    </button><ColumnFilter field={field} label={label} /></div><ColumnResize field={field} label={label} />
  </th>;
}

export function SelectionCheckbox({ checked, mixed = false, onChange, label }) {
  const input = useRef(null);
  useEffect(() => { input.current.indeterminate = mixed; }, [mixed]);
  return <input ref={input} className="cx-checkbox" type="checkbox" checked={checked} onChange={onChange} aria-label={label} />;
}

export function useRowSelection(rows, scope, getId = row => row.id) {
  const [selection, setSelection] = useState({ scope, ids: new Set() });
  const [notice, setNotice] = useFeedback();
  const visibleIds = new Set(rows.map(getId));
  const ids = new Set(selection.scope === scope ? [...selection.ids].filter((id) => visibleIds.has(id)) : []);
  useEffect(() => {
    if (selection.scope !== scope) {
      if (selection.ids.size) setNotice('조회 조건이 바뀌어 선택을 해제했습니다.');
      setSelection({ scope, ids: new Set() });
    }
  }, [scope, selection.scope, selection.ids]);
  const change = (next) => { setNotice(''); setSelection({ scope, ids: next }); };
  return {
    ids, notice, all: rows.length > 0 && ids.size === rows.length,
    toggle: (id) => { const next = new Set(ids); next.has(id) ? next.delete(id) : next.add(id); change(next); },
    toggleAll: () => change(ids.size === rows.length ? new Set() : new Set(rows.map(getId))),
    togglePage: (pageRows) => change(togglePageSelection(ids, pageRows, getId)),
    clear: () => change(new Set()),
  };
}

export function ReportActionBar({ id, title, description, count, total, stats, selection, onDownload, onOpenSelected, children, busy = false, pagination, search, onSearch, columnControls }) {
  const selectedCount = selection?.ids.size || 0;
  const heading = useRef(null);
  return <header className="cx-action-header">
    <div className="cx-heading-row"><div className="cx-heading-copy"><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>{description && <p>{description}</p>}</div>
      <div className="cx-heading-actions">{onSearch && <div className="search-box table-toolbar-search"><SearchField label="Agent 검색" value={search} onChange={onSearch}/></div>}<ActionButton action="download" className="table-export" type="button" disabled={!count || busy} onClick={() => onDownload(false)} title="현재 조회 결과를 CSV로 내보내기" aria-label="내보내기"/>{columnControls && <ActionButton action="resetWidths" type="button" onClick={columnControls.resetWidths} disabled={!columnControls.hasCustomWidths} title="열 너비를 기본값으로 되돌리기" aria-label="열 너비 초기화"/>}{children}</div>
    </div>
    <div className="cx-result-meta"><span>조회 <strong>{count.toLocaleString()}</strong><span className="cx-meta-total"> / {total.toLocaleString()}건</span></span>{pagination && <PageSizeSelect pagination={pagination} />}{stats}</div>
    {selection && <div className={`cx-selection-bar ${selectedCount ? 'is-selected' : ''}`}>
      <div className="cx-selection-label">{selectedCount ? <ActionButton action="clearSelection" type="button" onClick={() => { selection.clear(); heading.current?.focus({ preventScroll: true }); }} aria-label="선택 해제" title="선택 해제"/> : <Icon name="clipboardCheck" size={17} />}<span role="status" aria-live="polite">{selectedCount ? `${selectedCount}건 선택` : selection.notice || 'Agent를 선택해 상세를 확인하거나 내보내세요.'}</span></div>
      <div className="cx-selection-actions"><ActionButton action="detail" disabled={selectedCount !== 1 || busy} onClick={onOpenSelected} title={selectedCount > 1 ? '한 건을 선택하면 상세를 볼 수 있습니다.' : '선택한 Agent 상세'}/><ActionButton action="download" label="선택 내보내기" type="button" disabled={!selectedCount || busy} onClick={() => onDownload(true)}/></div>
    </div>}
    {columnControls && <ActiveColumnFilters controls={columnControls} />}
  </header>;
}

export function WorkspaceFilters({ children, onReset }) {
  return <section className="workspace-filters master-toolbar" aria-label="조회 조건">
    <div className="agent-filter-heading"><Icon name="filter" size={18}/><strong>조회 조건</strong></div>
    {children}
    <ActionButton action="clearFilters" className="filter-reset" type="button" onClick={onReset}/>
  </section>;
}

export function WorkspaceTabs({ items, active, onChange, label }) {
  return <nav className="workspace-tabs" aria-label={label}>
    {items.map(([key, title]) => <button key={key} type="button"
      className={active === key ? 'is-active' : ''}
      aria-current={active === key ? 'page' : undefined}
      onClick={() => onChange(key)}>{title}</button>)}
  </nav>;
}

export function AutomationRateBar({ value }) {
  return <div className="automation-rate-display">
    <span>{formatAutomationRate(value)}</span>
    <span className="automation-rate-track" aria-hidden="true">
      <span style={{ width: `${value ?? 0}%` }} />
    </span>
  </div>;
}

export function AutomationSummaryTable({ rows, items, page, by, sort, onSort }) {
  const total = summarizeAutomationRate(rows);
  return <TableViewport memoryKey={`overview.${by}.scroll`} resetKey={page} className="master-table-wrap summary-table-wrap">
    <ControlledTable className="master-table automation-summary-table">
      <thead><tr>
        <SortHeader label="Process" field="process" sort={sort} onSort={onSort} />
        {by === 'activity' && <SortHeader label="Activity" field="activity" sort={sort} onSort={onSort} />}
        <SortHeader label="업무 수" unit="Task" field="taskCount" className="numeric" sort={sort} onSort={onSort} />
        <SortHeader label="입력 완료" unit="Task" field="inputCount" className="numeric" sort={sort} onSort={onSort} />
        <SortHeader label="미입력" unit="Task" field="missingCount" className="numeric" sort={sort} onSort={onSort} />
        <SortHeader label="평균 자동화율" unit="% (입력 업무 기준)" field="averageRate" className="rate-column" sort={sort} onSort={onSort} />
      </tr></thead>
      <tbody>{items.map((item) => <tr key={item.key}>
        <td>{item.process}</td>
        {by === 'activity' && <td>{item.activity}</td>}
        <td className="numeric">{item.taskCount}</td>
        <td className="numeric">{item.inputCount}</td>
        <td className="numeric">{item.missingCount || '–'}</td>
        <td><AutomationRateBar value={item.averageRate} /></td>
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row" colSpan={by === 'activity' ? 2 : 1}>전체 합계</th>
        <td className="numeric">{total.taskCount}</td>
        <td className="numeric">{total.inputCount}</td>
        <td className="numeric">{total.missingCount || '–'}</td>
        <td><AutomationRateBar value={total.averageRate} /></td>
      </tr></tfoot>
    </ControlledTable>
    {!items.length && <div className="table-empty">조건에 맞는 업무 항목이 없습니다.</div>}
  </TableViewport>;
}

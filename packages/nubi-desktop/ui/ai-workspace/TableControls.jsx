import {useFilterPosition} from '../useFilterPosition.js';
import {ShowMore} from '../ShowMore.jsx';
import '../filter-panel.css';
import {PageNumbers} from '../PageNumbers.jsx';
import {CollectionTable} from '../CollectionTable.jsx';
import {CxSelect} from './CxSelect';
import { ActionButton } from './ActionButton';
import React, { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useWorkspaceState } from './WorkspaceMemory';
import { columnFilterOptions, filterTableRows, getPage } from './reportInteractions';
import { Icon } from './Icon';
import { useFeedback } from './Toast';
import { SearchField } from './SearchField';

export const TableControlsContext = createContext(null);

export function useColumnControls(memoryKey, view, columns, rows) {
  const [views, setViews] = useWorkspaceState(`${memoryKey}.columns`, {});
  const current = views[view] || { filters: {}, widths: {} };
  const [,notify] = useFeedback();
  const hasCustomWidths = columns.some(column => current.widths[column.key] != null && current.widths[column.key] !== (column.width || 180));
  const update = (patch) => setViews((all) => ({ ...all, [view]: { filters: {}, widths: {}, ...all[view], ...patch } }));
  const options = columnFilterOptions(rows, columns, current.filters);
  const unfilteredOptions = columnFilterOptions(rows, columns);
  return { columns, options, unfilteredOptions, filters: current.filters, widths: current.widths, hasCustomWidths,
    rows: filterTableRows(rows, columns, current.filters),
    setFilter: (field, values) => setViews(all => {
      const entry = { filters: {}, widths: {}, ...all[view] }, filters = { ...entry.filters };
      if (values === null) delete filters[field]; else filters[field] = values;
      return { ...all, [view]: { ...entry, filters } };
    }),
    clearFilters: () => update({ filters: {} }),
    setWidths: (widths) => update({ widths }),
    resetWidths: () => {
      if (!hasCustomWidths) return;
      update({ widths: {} });
      notify('열 너비를 기본값으로 되돌렸습니다.');
    },
  };
}

export function usePagination(memoryKey, rows, scope, { ready = true } = {}) {
  const [size, setSize] = useWorkspaceState(`${memoryKey}.pageSize`, '10');
  const [position, setPosition] = useWorkspaceState(`${memoryKey}.page`, { scope, page: 1 });
  const effectiveSize = size === 'all' ? Math.max(1, rows.length) : Number(size);
  const info = getPage(rows.length, effectiveSize, position.scope === scope ? position.page : 1);
  useEffect(() => {
    // Loading an empty placeholder must not overwrite the remembered page.
    if (!ready) return;
    if (position.scope !== scope || position.page !== info.page) setPosition({ scope, page: info.page });
  }, [ready, scope, info.page, position.scope, position.page]);
  return { ...info, size, rows: rows.slice(info.start, info.end),
    setPage: (page) => setPosition({ scope, page }),
    setSize: (next) => { setSize(next); setPosition({ scope, page: 1 }); },
  };
}

export function PageSizeSelect({ pagination }) {
  return <label className="table-page-size"><span className="visually-hidden">페이지당 표시 수</span><CxSelect aria-label="페이지당 표시 수" value={pagination.size} onChange={(event) => pagination.setSize(event.target.value)}>{[10, 20, 50, 100].map((size) => <option key={size} value={String(size)}>{size}개씩 보기</option>)}<option value="all">전체 보기</option></CxSelect><Icon name="chevronDown" size={13} /></label>;
}

export function TablePagination({ pagination, selectedCount = 0, as: Container = 'footer' }) {
  const { page, pageCount, total, start, end, setPage } = pagination;
  return <Container className="table-pagination nubi-collection-pagination"><span className="table-page-range" role="status" aria-live="polite">{total ? `${start + 1}–${end}` : '0'} / {total.toLocaleString()}</span><PageNumbers page={page} totalPages={pageCount} onPage={setPage} disabled={!total} label="표 페이지"/><span className="table-page-selection">{selectedCount ? `${selectedCount}개 선택` : ''}</span></Container>;
}

export function ColumnFilter({ field, label }) {
  const controls = useContext(TableControlsContext);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState([]);
  const [query, setQuery] = useState('');
  const trigger = useRef(null), popup = useRef(null);
  const options = controls?.options[field] || [];
  const active = controls && Object.hasOwn(controls.filters, field);
  const close = (focus = true) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }); };
  const position=useFilterPosition(open,trigger,popup,{onOutside:()=>close(false)});
  useEffect(()=>{if(!open)return;const keyboard=event=>{if(event.key==='Escape'){event.preventDefault();close();}};document.addEventListener('keydown',keyboard);return()=>document.removeEventListener('keydown',keyboard);},[open]);
  const selected=useMemo(()=>new Set(draft),[draft]);
  const matching=useMemo(()=>{if(!open)return [];const term=query.toLowerCase();return options.filter(option=>option.label.toLowerCase().includes(term));},[open,options,query]);
  if (!controls || !controls.columns.some((column) => column.key === field)) return null;
  const all = open && options.length > 0 && options.every((option) => selected.has(option.key));
  const selectedCount = open ? options.filter(option => selected.has(option.key)).length : 0;
  const unrestricted = controls.unfilteredOptions?.[field] || options;
  const selectsEveryValue = open && unrestricted.length > 0 && unrestricted.every(option => selected.has(option.key));
  return <><button ref={trigger} type="button" className={`table-column-filter ${active ? 'is-active' : ''}`} aria-label={`${label} 필터`} title={`${label} 필터${active ? ' 적용 중' : ''}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (open) close(); else { setDraft(active ? [...controls.filters[field]] : options.map((option) => option.key)); setQuery(''); setOpen(true); } }}><Icon name="filter" size={15} />{active && <i />}</button>
    {open && createPortal(<div ref={popup} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}} className="table-filter-popover nubi-filter-panel" role="dialog" aria-label={`${label} 필터 설정`} style={position}><div className="table-filter-title"><span className="nubi-mail-column-popover-title"><Icon name="filter" size={16}/><strong>{label}</strong></span><ActionButton action="close" type="button" onClick={() => close()} aria-label="필터 닫기"/></div>
      <SearchField className="table-filter-search" label="필터 값 검색" placeholder="값 검색" value={query} onChange={setQuery}/>
      <label className="table-filter-option table-filter-all"><input className="nubi-filter-checkbox" type="checkbox" checked={all} ref={(node) => { if (node) node.indeterminate = selectedCount > 0 && !all; }} onChange={() => setDraft(all ? [] : options.map((option) => option.key))} /><span>전체 선택</span><small>{selectedCount} / {options.length}</small></label>
      <div className="table-filter-options"><ShowMore items={matching} step={60} resetKey={query}>{visible=>visible.map((option) => <label className="table-filter-option" key={option.key}><input className="nubi-filter-checkbox" type="checkbox" checked={selected.has(option.key)} onChange={() => setDraft((current) => current.includes(option.key) ? current.filter((value) => value !== option.key) : [...current, option.key])} /><span>{option.label}</span></label>)}</ShowMore>{!matching.length && <p className="table-filter-empty">일치하는 값이 없습니다.</p>}</div>
      <div className="table-filter-footer"><ActionButton action="clearFilters" iconOnly={false} label="초기화" type="button" onClick={() => { controls.setFilter(field, null); close(); }}/><ActionButton action="apply" iconOnly={false} className="nubi-filter-apply" onClick={() => { controls.setFilter(field, selectsEveryValue ? null : draft); close(); }}/></div>
    </div>, trigger.current?.closest('[aria-modal="true"]') || document.body)}
  </>;
}

export function ColumnResize({ field, label }) {
  const controls = useContext(TableControlsContext);
  const drag = useRef(null);
  const column = controls?.columns.find((item) => item.key === field);
  if (!controls || !column) return null;
  const width = controls.widths[field] || column.width || 180;
  const resize = (value, base = controls.widths) => controls.setWidths({ ...base, [field]: Math.min(720, Math.max(100, Math.round(value))) });
  return <span className="table-column-resize" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={`${label} 열 너비`} aria-valuemin={100} aria-valuemax={720} aria-valuenow={Math.round(width)} title="드래그로 열 너비 조절, 더블클릭으로 초기화"
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); const header = event.currentTarget.closest('th'); const snapshot = Object.fromEntries([...header.closest('table').querySelectorAll('thead th[data-column]')].map((cell) => [cell.dataset.column, cell.getBoundingClientRect().width])); drag.current = { x: event.clientX, width: header.getBoundingClientRect().width, snapshot }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={(event) => { if (drag.current) resize(drag.current.width + event.clientX - drag.current.x, drag.current.snapshot); }}
    onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const header = event.currentTarget.closest('th'); const snapshot = Object.fromEntries([...header.closest('table').querySelectorAll('thead th[data-column]')].map((cell) => [cell.dataset.column, cell.getBoundingClientRect().width])); resize(header.getBoundingClientRect().width + (event.key === 'ArrowRight' ? 16 : -16), snapshot); } }}
    onDoubleClick={() => { const next = { ...controls.widths }; delete next[field]; controls.setWidths(next); }} />;
}

export function ControlledTable({ className, selection = false, detail = false, detailWidth = 56, frozenColumns = [], onPinLimitChange, stretchColumn, children }) {
  const controls = useContext(TableControlsContext);
  const table = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const frozenKey = frozenColumns.join(',');
  useLayoutEffect(() => {
    if (!frozenKey && !onPinLimitChange) return;
    const viewport = table.current.closest('.settings-grid-scroll') || table.current.parentElement;
    const measure = () => setViewportWidth(viewport.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [frozenKey, onPinLimitChange]);
  useLayoutEffect(() => {
    if (!viewportWidth || !onPinLimitChange) return;
    const selectionWidth = selection ? (viewportWidth < 1000 ? 36 : 44) : 0;
    // Desktop headers also need room for the title beside sort and filter controls.
    const minimumWidth = viewportWidth < 1000 ? 64 : 160;
    onPinLimitChange(Math.max(0, Math.floor((viewportWidth * .6 - selectionWidth) / minimumWidth)));
  }, [viewportWidth, selection, onPinLimitChange]);
  const columns = [...(selection ? [{ key: '__select', width: 44 }] : []), ...controls.columns.filter((column) => !column.hidden), ...(detail ? [{ key: '__detail', width: detailWidth }] : [])];
  const compact = Boolean(frozenKey && viewportWidth && viewportWidth < 1000);
  const fixed = columns.filter(column => frozenColumns.includes(column.key) && column.key !== '__select');
  const fixedWidth = fixed.reduce((sum, column) => sum + (controls.widths[column.key] || column.width || 180), 0);
  const selectionWidth = compact ? 36 : (controls.widths.__select || 44);
  const minimumPinnedWidth = compact ? 64 : 160;
  // Leave room to read and edit scrolling cells even when the window is narrow.
  const budget = Math.max(fixed.length * minimumPinnedWidth, viewportWidth * .6 - selectionWidth);
  const columnWidth = column => {
    const requested = controls.widths[column.key] || column.width || 180;
    if (!frozenKey) return requested;
    if (column.key === '__select') return selectionWidth;
    if (!frozenColumns.includes(column.key) || !viewportWidth) return requested;
    return Math.max(minimumPinnedWidth, Math.round(requested * Math.min(1, budget / fixedWidth)));
  };
  const widths = columns.map(columnWidth), width = widths.reduce((sum, value) => sum + value, 0);
  const flexibleColumn=stretchColumn?(columns.find(column=>column.key===stretchColumn&&!frozenColumns.includes(column.key))||columns.find(column=>column.key!=='__select'&&!frozenColumns.includes(column.key)))?.key:undefined;
  const geometryKey = columns.map((column, index) => `${column.key}:${widths[index]}`).join(',');
  useLayoutEffect(() => {
    if (!frozenKey) return;
    const element = table.current, viewport = element.closest('.settings-grid-scroll') || element.parentElement;
    const measure = () => {
      let left = 0;
      for (const key of frozenKey.split(',')) {
        const header = element.querySelector(`thead [data-column="${key}"]`);
        if (!header) continue;
        element.style.setProperty(`--frozen-${key}`, `${left}px`);
        left += header.getBoundingClientRect().width;
      }
      // Grouped tables share a scroller but can pin different columns.
      if (viewport === element.parentElement) viewport.style.scrollPaddingInlineStart = `${left + 8}px`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); if (viewport === element.parentElement) viewport.style.scrollPaddingInlineStart = ''; };
  }, [frozenKey, geometryKey]);
  return <CollectionTable ref={table} className={`${className} controlled-table${frozenKey ? ' has-frozen-columns' : ''}${compact ? ' compact-frozen-columns' : ''}`} style={{ width, minWidth: '100%' }}><colgroup>{columns.map((column, index) => <col key={column.key} style={{ width: column.key===flexibleColumn?undefined:widths[index] }} />)}</colgroup>{children}</CollectionTable>;
}

export function ActiveColumnFilters({ controls }) {
  const fields = controls.columns.filter((column) => Object.hasOwn(controls.filters, column.key));
  if (!fields.length) return null;
  return <div className="table-active-filters" aria-label="적용된 열 필터">{fields.map((column) => <button type="button" className="table-filter-chip" key={column.key} onClick={() => controls.setFilter(column.key, null)} aria-label={`${column.label} 필터 해제`} title={`${column.label} 필터 해제`}><span>{column.label}</span><span>{controls.filters[column.key].length}개</span><Icon name="xClose" size={12} /></button>)}<ActionButton action="clearFilters" label="열 필터 해제" onClick={controls.clearFilters}/></div>;
}

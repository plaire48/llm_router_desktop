import React, { useRef } from 'react';

// CX text tabs: selected text and underline share the product accent.
export function CxTabs({ items, active, onChange, label, idPrefix, panelId, disabled = false, className = '' }) {
  const tabs = useRef(null);
  const activate = async (item, focus = false) => {
    if (disabled) return;
    if (await onChange(item.key) === false) {
      tabs.current?.querySelector('[aria-selected="true"]')?.focus({preventScroll: true});
      return;
    }
    if (focus) requestAnimationFrame(() => {
      const target = tabs.current?.querySelector(`[data-tab-key="${item.key}"]`);
      target?.focus({preventScroll: true});
      target?.scrollIntoView({block: 'nearest', inline: 'nearest'});
    });
  };
  return <div ref={tabs} className={`cx-tabs ${className}`} role="tablist" aria-label={label} onKeyDown={event => {
    if (disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = items.findIndex(item => item.key === active);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length;
    activate(items[next], true);
  }}>{items.map(item => <button key={item.key} type="button" role="tab" id={`${idPrefix}-${item.key}`} data-tab-key={item.key} data-settings-key={idPrefix === 'settings-tab' ? item.key : undefined} aria-selected={active === item.key} aria-controls={panelId} tabIndex={active === item.key ? 0 : -1} disabled={disabled} onClick={() => activate(item)}>{item.label}</button>)}</div>;
}

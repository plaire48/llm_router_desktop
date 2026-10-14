import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ActionButton } from './ActionButton';
import { HelpButton } from './HelpButton';
import { activateModal } from './modalFocus';

export function DetailPanel({ title, subtitle, onClose, children, footer, className = '', embedded = false, hideHeading = false, variant = 'drawer', role = 'dialog', describedBy, initialFocus, hideHelp = false, helpTopic, busy = false }) {
  const titleId = useId();
  const panel = useRef(null);
  const close = useRef(onClose);
  close.current = () => { if (!busy) onClose?.(); };
  useEffect(() => {
    if (embedded) return undefined;
    return activateModal(panel.current, { initialFocus, confirmation: variant === 'confirmation' || role === 'alertdialog', onClose: () => close.current() });
  }, [embedded]);
  const content = <section ref={panel} tabIndex={embedded?undefined:-1} className={`${embedded?'cx-inline-editor':'cx-detail-panel'} ${className}`} role={embedded?'region':role} aria-modal={embedded?undefined:true} aria-busy={busy||undefined} aria-labelledby={titleId} aria-describedby={describedBy || (role==='alertdialog'?`${titleId}-body`:undefined)}>
    <header className={embedded && hideHeading ? 'visually-hidden' : 'cx-panel-header'}><div className="cx-panel-heading"><h2 id={titleId} title={typeof title==='string'?title:undefined} tabIndex={embedded?undefined:-1}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{!embedded&&<div className="cx-panel-header-actions">{!hideHelp&&variant!=='confirmation'&&role!=='alertdialog'&&<HelpButton initialTopic={helpTopic}/>}<ActionButton action="close" disabled={busy} onClick={()=>close.current()}/></div>}</header>
    <div id={`${titleId}-body`} className="cx-panel-body">{children}</div>
    {footer && <footer className="cx-panel-footer">{footer}</footer>}
  </section>;
  return embedded ? content : createPortal(<div className={`cx-panel-backdrop ${variant === 'confirmation' ? 'is-confirmation' : variant === 'modal' ? 'is-modal' : ''}`} onMouseDown={event=>event.target===event.currentTarget&&close.current()}>{content}</div>, document.body);
}

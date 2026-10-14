import React, {useId} from 'react';
import {DetailPanel} from './DetailPanel';
import {Icon} from './Icon';
import './confirmation.css';

// All confirmations use the same anatomy and focus the non-destructive action.
export function CxConfirmation({title,message,confirmLabel,cancelLabel='계속 수정',onConfirm,onCancel,onDiscard,discardLabel='반영 안 함',busy=false,confirmDisabled=false,className='',children,icon='alertCircle'}) {
  const descriptionId=useId();
  return <DetailPanel title={title} className={`cx-confirmation ${className}`} variant="confirmation" role="alertdialog" describedBy={descriptionId} initialFocus="[data-continue-editing]" busy={busy} onClose={onCancel} footer={<>
    <button type="button" className="cx-button" data-continue-editing disabled={busy} onClick={onCancel}>{cancelLabel}</button>
    {onDiscard&&<button type="button" className="cx-button" disabled={busy||confirmDisabled} onClick={onDiscard}>{discardLabel}</button>}
    <button type="button" className="cx-button cx-button--primary" disabled={busy||confirmDisabled} onClick={onConfirm}>{busy?'처리 중…':confirmLabel}</button>
  </>}><div className="cx-confirm-intro"><span className="cx-confirm-symbol" aria-hidden="true"><Icon name={icon} size={24}/></span><div id={descriptionId} className="cx-confirm-message">{message}</div></div>{children}</DetailPanel>;
}

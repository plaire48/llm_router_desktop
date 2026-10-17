import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {LoadingNote} from './LoadingNote.jsx';
import {processRecoveryView} from './process-recovery-view.mjs';

export function ProcessRecovery({process,connected,cancelled,disabled,onContinue}){
 const view=processRecoveryView(process,{connected,cancelled});if(!view)return null;
 return <section className="nubi-recovery-card" aria-label="실행 결과 확인">
  {view.pending?<LoadingNote>{view.label}</LoadingNote>:<><p>{view.label}</p><CxButton disabled={disabled} onClick={onContinue}><Icon name={connected?'play':'link'} size={16}/>{view.action}</CxButton></>}
 </section>;
}

import React from 'react';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';

export function NubiPreparing(){
 return <div className="nubi-connecting nubi-preparing" role="status" aria-label="누비 준비 중" aria-busy="true">
  <div className="nubi-preparing-emblem" aria-hidden="true">
   <span className="nubi-preparing-orbit"/>
   <AgentMark size={76} mood="still"/>
  </div>
 </div>;
}

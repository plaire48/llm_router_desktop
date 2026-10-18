import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {FileKindIcon} from './FileKindIcon.jsx';
import './output-file-cards.css';
const bytes=value=>value<1024?`${value} B`:value<1024*1024?`${(value/1024).toFixed(1)} KB`:`${(value/1024/1024).toFixed(1)} MB`;
export function OutputFileCards({cards=[],onOpen}){
 if(!cards.length)return null;
 return <div className="nubi-output-files" role="group" aria-label="산출물">{cards.map(card=>{
  const name=(card.path||card.name||'캡처.png').split(/[\\/]/).at(-1);
  return <CxButton key={card.id} className="nubi-output-file" title={card.path||name} aria-label={`${name} 열기`} onClick={()=>onOpen(card)}><FileKindIcon name={name} size={20}/><span className="nubi-output-file-body"><span className="nubi-output-file-name">{name}</span><span className="nubi-output-file-size">{bytes(card.size)}</span>{card.caption&&<span className="nubi-output-file-caption">{card.caption}</span>}</span><Icon name="chevronRight" size={16}/></CxButton>;
 })}</div>;
}

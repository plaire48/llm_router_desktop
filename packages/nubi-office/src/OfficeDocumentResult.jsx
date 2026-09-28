import React,{useId,useState} from 'react';
import {ActionButton,Icon} from '@e2e/cx-design-system';

export function OfficeDocumentResult({title,detail,path,onOpen,host='excel'}) {
  const [showLocation,setShowLocation]=useState(false),locationId=useId();
  return <section className="office-document-result" aria-label="문서 결과">
    <span className="deck-symbol"><Icon name={host==='excel'?'table':'file'} size={20}/></span>
    <div><strong>{title}</strong>{detail&&<span>{detail}</span>}{path&&<small id={locationId} hidden={!showLocation}>{path}</small>}</div>
    <div className="office-result-actions">
      {path&&<ActionButton action="view" label="저장 위치" aria-expanded={showLocation} aria-controls={locationId} onClick={()=>setShowLocation(value=>!value)}/>}
      {onOpen && <ActionButton action="openExternal" label="작성한 문서 보기" onClick={onOpen}/>}
    </div>
  </section>;
}

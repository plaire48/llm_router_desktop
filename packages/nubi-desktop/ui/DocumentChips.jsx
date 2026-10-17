import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {FileKindIcon} from './FileKindIcon.jsx';
export function DocumentChips({documents=[],onRemove,onOpen}){
 if(!documents.length)return null;
 return <div className="nubi-mail-evidence-chips" aria-label="첨부한 문서">{documents.map(item=><span className="nubi-mail-evidence-chip" key={item.id}><CxButton type="button" aria-label={`${item.filename} 읽은 내용 보기`} title={item.filename} onClick={()=>onOpen?.({...item,kind:'document'})}><FileKindIcon name={item.filename} size={16}/><span>{item.filename}</span></CxButton>{onRemove&&<CxButton type="button" aria-label={`${item.filename} 첨부 빼기`} title="첨부 빼기" onClick={()=>onRemove(item.id)}><Icon name="xClose" size={14}/></CxButton>}</span>)}</div>;
}

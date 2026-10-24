import React,{useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
export function appendMemoryReferences(current=[],added=[]){const rows=[...new Map([...current,...added].map(row=>[row.id,row])).values()];if(rows.length>10)throw Error('memory_reference_limit');return rows;}
export function MemoryReferences({references=[],onRemove,label='참조한 기억'}){
 const [preview,setPreview]=useState(null);if(!references.length)return null;
 return <><div className="nubi-mail-evidence-chips nubi-memory-references" aria-label={label}>{references.map(row=><span className="nubi-mail-evidence-chip nubi-memory-reference" key={row.sourceHash||row.id}><CxButton type="button" aria-label={`${row.text} 기억 보기`} title={row.text} onClick={()=>setPreview(row)}><Icon name="lightbulb" size={16}/><span>{row.text}</span></CxButton>{onRemove&&<CxButton type="button" aria-label={`${row.text} 참조 빼기`} title="참조 빼기" onClick={()=>onRemove(row.id)}><Icon name="xClose" size={16}/></CxButton>}</span>)}</div>
 {preview&&<DetailPanel className="deck-dialog nubi-panel" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon" aria-hidden="true"><Icon name="lightbulb" size={18}/></span><span>참조한 기억</span></span>} variant="modal" hideHelp onClose={()=>setPreview(null)}><p className="nubi-memory-preview-text">{preview.text}</p><p className="nubi-muted">{preview.scope==='user'?'내 기억':'프로젝트 기억'} / {preview.updatedAt?new Date(preview.updatedAt).toLocaleString('ko-KR'):''}</p><p className="nubi-muted">대화에 연결한 시점의 내용이에요. 현재 요청과 실제 자료를 우선해요.</p></DetailPanel>}
 </>;
}

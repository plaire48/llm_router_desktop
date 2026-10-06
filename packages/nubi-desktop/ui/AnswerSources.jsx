import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

export function sourceLocation(source) {
  const location=source.location;
  if(location?.page)return `${location.page}쪽`;
  if(location?.slide)return `슬라이드 ${location.slide}`;
  if(location?.sheet)return location.sheet;
  return source.start?`${source.start}${source.end&&source.end!==source.start?`–${source.end}`:''}줄`:'';
}
export function AnswerSources({message,onOpen}) {
  const cited=message.sourceReferences||[],consulted=message.consultedSources||(!cited.length?(message.mailSources||[]).map((source,index)=>({...source,kind:'mail',citationId:`legacy-mail-${index}`})):[]);
  if(!cited.length&&!consulted.length)return null;
  const row=source=><CxButton type="button" className="nubi-answer-source" key={source.citationId} title={[source.title,source.filename||source.path,sourceLocation(source),source.freshness==='source_changed'?'원본 변경됨':null].filter(Boolean).join('\n')} onClick={()=>onOpen?.(source)}>
    {source.number?<span className="nubi-source-number">{source.number}</span>:<Icon name={source.kind==='mail'?'mail':'file'} size={14}/>}
    <span>{source.filename||source.title}</span>{sourceLocation(source)&&<small>{sourceLocation(source)}</small>}{['source_changed','document_changed','unavailable'].includes(source.freshness)&&<small>원본 확인 필요</small>}
  </CxButton>;
  return <div className="nubi-answer-sources" aria-label="답변 근거">
    {!!cited.length&&<div className="nubi-cited-sources"><span className="nubi-source-label">출처</span>{cited.map(row)}</div>}
    {!!consulted.length&&<details><summary><Icon name="file" size={13}/>참고 자료 {consulted.length}개<Icon name="chevronDown" size={12}/></summary><div className="nubi-consulted-sources">{consulted.map(row)}</div></details>}
    {message.unresolvedCitations&&<small className="nubi-muted">확인하지 못한 출처가 있어요.</small>}
  </div>;
}

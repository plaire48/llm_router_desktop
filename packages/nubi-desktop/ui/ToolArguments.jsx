import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import './tool-arguments.css';
import {TerminalMark} from './marks.jsx';
function JsonText({text}){
 const parts=String(text||'{}').split(/("(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g);
 return <code>{parts.map((part,i)=><span key={i} className={part.startsWith('"')?(part.trimEnd().endsWith(':')?'json-key':'json-string'):/^(true|false|null|-?\d)/.test(part)?'json-value':undefined}>{part}</span>)}</code>;
}
export function ToolArguments({value,summary,open=false,readOnly=false}){
 if(!value?.text)return summary||null;
 return <details className="nubi-tool-arguments" open={open||undefined}>
  <summary>{summary?<>{summary}{readOnly&&<small className="nubi-tool-arguments-note">읽기 전용</small>}</>:<span className="nubi-tool-arguments-title"><TerminalMark size={14}/>실행 인자{readOnly&&<small>읽기 전용</small>}</span>}<Icon name="chevronDown" size={14}/></summary>
  <pre tabIndex={0} aria-label="도구 실행 인자"><JsonText text={value.text}/></pre>
  {value.omitted&&<small className="nubi-tool-arguments-note">긴 인자의 일부를 표시합니다.</small>}
 </details>;
}

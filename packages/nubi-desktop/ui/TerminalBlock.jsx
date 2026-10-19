import {DriftLabel} from './DriftLabel.jsx';
import React,{memo,useMemo,useRef} from 'react';
import {createTerminalProjection,terminalTextChunks} from './terminal-output-projection.mjs';
import './terminal-output.css';
const TerminalTextChunk=memo(function TerminalTextChunk({text}){return <span className="nubi-terminal-output-chunk">{text}</span>;});
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import {TerminalMark} from './marks.jsx';
import {CxButton} from '@e2e/cx-design-system';

// The prompt a command reads with in its own shell: PowerShell PS C:\dir>, cmd C:\dir>, the others $.
export function promptFor(profile = '', workspace = '') {
  const id = String(profile).toLowerCase();
  return /powershell|pwsh/.test(id) ? `PS ${workspace}>` : /^cmd/.test(id) ? `${workspace}>` : '$';
}

// A command as it reads in a terminal (user decision 2026-09-30, like Codex): a title bar with the shell and the folder,
// the prompt and the command, and the output below when there is one. The prompt is decoration, not part of the command.
export function TerminalBlock({profile, workspace, command, output, label = '명령', status, copyOutput = true,onOpenTerminal,inputText=false}) {
  const projector=useRef(null);if(!projector.current)projector.current=createTerminalProjection();
  output=useMemo(()=>projector.current(output),[output]);
  const chunks=useMemo(()=>output.length>32768?terminalTextChunks(output):null,[output]);
  const lines = command ? String(command).split('\n') : [], powershell = /powershell|pwsh/i.test(profile || '');
  return <figure className="nubi-terminal" aria-label={label}>
    <figcaption className="nubi-terminal-bar"><span className="nubi-terminal-shell"><TerminalMark size={14}/>{inputText?'프로그램 입력':profile}</span>{workspace && <DriftLabel className="nubi-terminal-cwd" title={workspace}>{workspace}</DriftLabel>}<span className="nubi-terminal-header-copy">{onOpenTerminal&&<CxButton className="nubi-terminal-open" aria-label="기본 터미널에서 직접 입력" title="설정한 기본 터미널에서 직접 입력" onClick={onOpenTerminal}><TerminalMark size={14}/><span>터미널</span></CxButton>}<CopyButton text={[command,copyOutput&&output].filter(Boolean).join('\n\n')} label={inputText?'프로그램 입력 복사':command&&copyOutput&&output?'명령과 결과 복사':command?'명령어 복사':'실행 결과 복사'} successMessage="복사했습니다."/></span></figcaption>
    <div className="nubi-terminal-body">
      {command&&<div className="nubi-terminal-section" data-terminal-part="command"><pre><code>{lines.map((line,index)=><span key={index} className="nubi-terminal-line"><span className="nubi-terminal-prompt" aria-hidden="true">{inputText?'›':index===0?promptFor(profile,workspace):powershell?'>>':'>'}</span> {line}{index<lines.length-1?'\n':''}</span>)}</code></pre>{output&&copyOutput&&<div className="nubi-terminal-copy"><CopyButton text={String(command)} label={inputText?'프로그램 입력 복사':'명령어 복사'} successMessage="복사했습니다."/></div>}</div>}
      {output&&<div className="nubi-terminal-section" data-terminal-part="output"><pre><samp className="nubi-terminal-output">{chunks?chunks.map((text,index)=><TerminalTextChunk key={index} text={text}/>):output}</samp></pre>{command&&copyOutput&&<div className="nubi-terminal-copy"><CopyButton text={String(output)} label="실행 결과 복사" successMessage="실행 결과를 복사했습니다."/></div>}</div>}
    </div>
    {status&&<div className="nubi-terminal-receipt" role="status">{status}</div>}
  </figure>;
}

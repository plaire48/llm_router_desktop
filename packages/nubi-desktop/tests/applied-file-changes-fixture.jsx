import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppliedFileChanges} from '../ui/AppliedFileChanges.jsx';
import {GitDiff} from '../electron-app/editor.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const names=['design/workspace-density.css','ui/CaptureChips.jsx','ui/SetupActions.jsx','ui/AppliedFileChanges.jsx','runtime/applied-file-summary.mjs','electron-app/editor.jsx','tests/changes.test.mjs','docs/CHANGES.md','ui/변경한-파일의-매우-긴-이름이-좁은-화면에서도-넘치지-않아야-합니다.jsx'];
const files=names.map((path,i)=>({path,hash:'hash-'+i,state:'verified',stats:{state:'counted',added:i+1,removed:i%3}}));
const receipts=files.map((row,i)=>({...row,id:String(i),afterHash:row.hash}));
window.calls=[];window.opened=[];
const api=async(method,args)=>{window.calls.push({method,...args});if(window.failSummary)throw Error('unavailable');return {files,total:files.length,totals:{added:45,removed:9}};};
const before=Array.from({length:100},(_,i)=>`const value${i} = ${i};`).join('\n')+'\n',after=before.replace('const value70 = 70;','const value70 = 170;\nconst added = true;');
function App(){const [diff,setDiff]=useState(null),[task,setTask]=useState('one');window.changeTask=setTask;return <main className="desktop-shell" style={{display:'flex',gap:24,padding:24,boxSizing:'border-box',height:'100vh',background:'#F1F7FE'}}><div style={{flex:1,minWidth:0,overflow:'auto'}}><p style={{fontSize:15}}>변경 사항을 반영했습니다.</p><AppliedFileChanges api={api} taskId={task} receipts={receipts} onOpen={async(row,{canPresent})=>{window.opened.push(row.path);if(window.delayOpen)await new Promise(r=>setTimeout(r,window.delayOpen));if(canPresent())setDiff({path:row.path,before,after,applied:true});}}/></div>{diff&&<aside style={{display:'flex',flexDirection:'column',width:'48%',minWidth:0,height:'90vh'}}><h3 style={{fontSize:14}}>{diff.path} 변경 비교</h3><GitDiff diff={diff}/></aside>}</main>;}
createRoot(document.getElementById('root')).render(<App/>);

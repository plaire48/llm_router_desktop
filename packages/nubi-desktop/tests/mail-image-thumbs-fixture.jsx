import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MailImageThumbs} from '../ui/MailImageThumbs.jsx';
import '@e2e/cx-design-system/styles.css';
import '../design/workspace-identity.css';
const canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;const context=canvas.getContext('2d');context.fillStyle='#F1F7FE';context.fillRect(0,0,480,320);context.fillStyle='#191F28';context.font='bold 28px sans-serif';context.fillText('출장비 영수증',40,65);context.font='22px sans-serif';context.fillText('교통비 120,000원',40,130);context.fillText('2026-10-15',40,185);context.fillStyle='#3182F6';context.fillRect(40,230,400,3);const image=canvas.toDataURL('image/png');
window.calls=[];window.opened=[];
const api=async(method,args)=>{window.calls.push({method,...args});if(args.expectedAttachmentHash==='changed')throw Error('mail_source_changed');return {image};};
const source={kind:'mail',id:'a'.repeat(64),sourceHash:'source',attachmentId:'image',attachmentHash:'image-hash',filename:'출장비 영수증.png',preview:'image'};
function App(){const [hash,setHash]=useState('image-hash');window.changeHash=()=>setHash('changed');const row={...source,attachmentHash:hash};return <main className="desktop-shell" style={{padding:32,maxWidth:720,fontFamily:'sans-serif'}}><h2>출장비는 120,000원입니다.</h2><p>첨부한 영수증에서 교통비와 발급 날짜를 확인했습니다.</p><MailImageThumbs message={{sourceReferences:[row],consultedSources:[row]}} api={api} onOpen={value=>window.opened.push(value)}/></main>;}
createRoot(document.getElementById('root')).render(<App/>);

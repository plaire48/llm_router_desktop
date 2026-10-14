import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {deferredScreen} from '../ui/deferred-screen.jsx';
let resolve,reject;window.loads=0;
function Loaded({count}){const [draft,setDraft]=useState('');return <section><p>부모 상태 {count}</p><input aria-label="화면 입력" value={draft} onChange={e=>setDraft(e.target.value)}/></section>;}
const Screen=deferredScreen(()=>{window.loads++;return new Promise((yes,no)=>{resolve=()=>yes({Screen:Loaded});reject=()=>no(Error('fixture_chunk_unavailable'));});},'Screen');
window.resolveScreen=()=>resolve();window.rejectScreen=()=>reject();
function App(){const [open,setOpen]=useState(false),[count,setCount]=useState(0);return <main><input aria-label="채팅 초안"/><button onClick={()=>setOpen(v=>!v)}>화면 전환</button><button onClick={()=>setCount(v=>v+1)}>상태 갱신</button>{open&&<Screen count={count}/>}</main>;}
createRoot(document.getElementById('root')).render(<App/>);

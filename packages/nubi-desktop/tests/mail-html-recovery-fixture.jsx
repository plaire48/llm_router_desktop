import '@e2e/cx-design-system/styles.css';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MailReader} from '../ui/MailReader.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../ui/mail-table.css';
function Fixture(){const [source,setSource]=useState(null);useEffect(()=>{void fetch('source.json').then(r=>r.json()).then(setSource);},[]);return <main style={{maxWidth:800,margin:'24px auto',padding:24}}>{source&&<MailReader source={source} api={async()=>({})}/>}</main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);

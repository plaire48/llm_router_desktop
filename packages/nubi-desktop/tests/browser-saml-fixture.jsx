import '@e2e/cx-design-system/styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const state={active:'sso',tabs:[{id:'sso',title:'EpSSO SAML',url:'https://sso.example.test/saml',authReturn:true,popup:true,contentReady:true,authFlow:{failure:{stage:'page',code:'epsso_request_missing'},events:[{stage:'post',method:'POST',elapsedMs:30},{stage:'redirect',method:'POST',httpStatus:307,elapsedMs:70},{stage:'post',method:'POST',elapsedMs:80},{stage:'page',method:'POST',httpStatus:200,elapsedMs:130}]}}]};
if(new URLSearchParams(location.search).has('network'))Object.assign(state.tabs[0],{error:'browser_certificate_failed',authFlow:null,networkFailure:{category:'browser_certificate_failed',netCode:-202,netError:'ERR_CERT_AUTHORITY_INVALID',stage:'redirect'}});
window.nubi={desktop:true,onBrowserEvent:()=>()=>{}};
const api=async(_method,args)=>{if(['authCopyDiagnostic','networkCopyDiagnostic'].includes(args.action))window.copied=true;if(args.action==='authReturn')window.returned=true;return state;};
createRoot(document.getElementById('root')).render(<main className="desktop-shell" style={{height:'100vh',display:'block',padding:0}}><section className="desktop-pane" style={{height:'100%',width:'100%',position:'relative'}}><BrowserPane api={api} visible onError={e=>{throw e;}}/></section></main>);

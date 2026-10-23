import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
const listeners=new Set();window.nubi={desktop:true,platform:'darwin',onHostEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}};window.browserLayoutCalls=[];
window.fixtureConfiguration={mode:'external',showInternal:false,connected:false,tabs:[],dock:{phase:'idle',supported:false}};
window.setFixtureConfiguration=value=>{window.fixtureConfiguration={...window.fixtureConfiguration,...value};for(const callback of listeners)callback({type:'external_browser_changed'});};
const tab={id:'test',url:'https://example.test/',title:'검증 페이지'},state={tabs:[tab],active:tab.id};
async function api(method,args){window.browserLayoutCalls.push({method,...args});if(method==='browserConnection'){if(args.action==='status'&&window.failFixtureConfiguration)throw Error('browser_unavailable');if(args.action==='mode')window.setFixtureConfiguration({mode:args.mode});return window.fixtureConfiguration;}return state;}
function Fixture(){const [visible,setVisible]=useState(true);window.setBrowserVisible=setVisible;return <main className="desktop-shell" style={{height:'100vh'}}><aside className="desktop-pane" style={{position:'relative',width:420,flex:'none'}}><header><strong>브라우저</strong></header><BrowserPane api={api} visible={visible} onError={()=>{}}/></aside></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);

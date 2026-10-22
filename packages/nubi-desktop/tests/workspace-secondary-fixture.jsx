import '@e2e/cx-design-system/styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import HelpPanel from '../ui/ai-workspace/HelpPanel.jsx';
import {GithubProfilePanel} from '../ui/ai-workspace/AccountProfile.jsx';
import {TeamAssignment} from '../ui/ai-workspace/TeamAssignment.jsx';
import {TalkTeamNotice} from '../ui/ai-workspace/TalkTeamNotice.jsx';
import '../ui/ai-workspace/admin-settings.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';

// Production secondary panels, explicit synthetic responses, no external effects.
const user={id:'fixture',login:'nubi',name:'김누비',company:'업무지원',email:'nubi@example.invalid',role:'editor',socials:[],bio:'자료와 변경 내용을 확인합니다.',location:'서울',blog:'https://example.invalid',status:{emoji:'🌱',message:'집중 중'}};
const teams=[{key:'editor',slug:'editor',label:'편집자',membership:{state:'active'},editable:true,enabled:true,count:8},{key:'system',slug:'system',label:'관리자',membership:null,editable:false,enabled:false,reason:'권한 확인이 필요합니다.',count:2}];
const client={load:async()=>user,teamUser:async()=>({user,teams}),options:async()=>teams};
const screen=new URLSearchParams(location.search).get('screen');
const no=()=>{};
const content=screen==='help'?<HelpPanel onClose={no}/>:screen==='profile'?<GithubProfilePanel account={user} client={client} onClose={no}/>:screen==='team'?<TeamAssignment initialUser={user} client={client} onClose={no}/>:<TalkTeamNotice post={{number:1,title:'이번 주 업무 공유'}} client={client} onClose={no}/>;
createRoot(document.getElementById('root')).render(<main className="nubi-workbench nubi-ai-workspace-embed">{content}</main>);

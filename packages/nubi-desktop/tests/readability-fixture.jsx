import '@e2e/cx-design-system/styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {WikiRepository} from '../ui/WikiRepository.jsx';
import {WorkspaceUpdate} from '../ui/WorkspaceUpdate.jsx';
import {DataResetConfirmation} from '../ui/DataResetConfirmation.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const no=()=>{},view=new URLSearchParams(location.search).get('view');
const item={id:'sample',title:'프로젝트 업무 가이드',description:'서비스 구조와 배포 방법을 공유합니다. 주요 화면과 데이터 흐름, API 연결, 오류 복구 방법을 포함합니다.',mode:'code',version:'1.2.0',createdBy:'nubi',updatedBy:'reviewer',managers:['maintainer'],createdAt:'2026-10-01T01:00:00Z',updatedAt:'2026-10-16T01:00:00Z',audience:{scope:'repository',readers:[]},releases:[{version:'1.2.0',createdAt:'2026-10-16T01:00:00Z'}],canEdit:true};
const api=async(method,args)=>{window.calls.push({method,args});if(args?.action==='list')return {head:'fixture',canUpload:true,items:[item]};if(args?.action==='detail')return {manifest:{files:[{path:'architecture.md'},{path:'operations.md'}]}};if(args?.action==='chooseFolder')return {token:'fixture',files:[{path:'architecture.md'},{path:'operations.md'}]};return {items:[],connections:[]};};
window.calls=[];
const notes='메일과 위키의 연결 흐름을 개선했습니다.\n\n메일 검색과 페이지 이동을 개선하고 선택한 원문의 문서와 첨부를 확인할 수 있습니다.\n\n긴 대화의 실행 결과와 진행 기록을 정리했습니다. 필요한 자료와 터미널 결과를 펼쳐 확인할 수 있습니다.\n\n프로젝트 이동, 위키 갱신, 연결 오류의 복구 안내를 개선했습니다. 기존 파일과 대화는 유지됩니다.';
createRoot(document.getElementById('root')).render(<main className="nubi-workbench" style={{padding:24}}>{view?.startsWith('reset')?<DataResetConfirmation kind={view==='reset-mail'?'mail':'wiki'} api={api} onClose={no} onDone={no}/>:view==='update'?<DetailPanel title="설정" variant="modal" className="deck-dialog nubi-panel" onClose={no}><WorkspaceUpdate update={{state:{phase:'available',currentVersion:'1.2.8',release:{version:'1.2.9',notes}},action:no,start:()=>{window.started=true;}}}/></DetailPanel>:<WikiRepository api={api} onSignIn={no}/>}</main>);

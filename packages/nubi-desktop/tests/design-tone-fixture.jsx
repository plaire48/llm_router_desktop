import React from 'react';
import {createRoot} from 'react-dom/client';
import {SkillManager} from '../ui/SkillManager.jsx';
import '@e2e/cx-design-system/styles.css';
import '../extension/lib/browser/style/style.css';
import '../design/workspace-identity.css';
import '../../nubi-vscode/design/host.css';

const description = '메일 첨부의 변경 요청을 읽고 관련 소스와 Wiki 근거를 비교한 뒤, 확인한 사실과 아직 확인하지 못한 항목을 구분해 보고서를 작성합니다.';
const catalog = {connected:true, installed:[], issues:[], items:[{id:'report', name:'report', title:'변경 요청 검토', description, version:'1.0.0', state:'available'}]};
window.toneDescription = description;
createRoot(document.getElementById('root')).render(<div className="nubi-workbench" data-host-layout="integrated"><div className="nubi-workbench-layout"><div className="nubi-workbench-content"><SkillManager api={async method => method==='listSkills'?{skills:[],issues:[]}:catalog}
  openPath={async()=>{}} onBack={()=>{}} onRegister={()=>{}} connectMarketplace={async()=>({connected:true})} openTeamWorkspace={async()=>{}}/></div></div></div>);

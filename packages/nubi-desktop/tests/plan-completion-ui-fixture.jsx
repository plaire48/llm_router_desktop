import '@e2e/cx-design-system/styles.css';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspacePlan} from '../ui/WorkspacePlan.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
const partial=new URLSearchParams(location.search).has('partial');
const steps=['메일 찾기','메일 원문 확인','답변 정리'].map((text,index)=>({text,expected_outcome:text,status:partial&&index===2?'pending':'completed',verified:!partial||index!==2}));
const task={id:'fixture-plan',state:'review',workPlan:{runId:'fixture-run',steps},resultReview:{status:'ready',checks:steps.map((step,index)=>({requirementId:'intent:step:'+index,state:step.verified?'supported':'unknown',evidenceIds:step.verified?['fixture-source']:[]}))}};
createRoot(document.getElementById('root')).render(<main className="nubi-workspace" style={{display:'block',padding:24,maxWidth:800,margin:'auto'}}><WorkspacePlan task={task} trace={[]}/></main>);

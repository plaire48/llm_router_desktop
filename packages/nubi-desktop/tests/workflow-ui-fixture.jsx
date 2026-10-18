import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-density.css';
import '../design/workspace-icons.css';
import '../design/workspace-alignment.css';
import React from 'react';import {createRoot} from 'react-dom/client';import {WorkflowRunDemo} from './workflow-run-demo.jsx';import {WorkflowDemo} from './workflow-demo.jsx';const root=document.getElementById('root'),shell=document.createElement('div');shell.className='desktop-shell';shell.dataset.layout='split';root.replaceWith(shell);shell.append(root);root.className='desktop-agent';createRoot(root).render(new URLSearchParams(location.search).has('execution')?<WorkflowRunDemo/>:<WorkflowDemo/>);

import {workflowGraph} from './workflow-layout.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,...workflowGraph(data.steps,{},data.geometry)});}catch{self.postMessage({id:data.id,error:'workflow_layout_failed'});}};

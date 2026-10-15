import {mcpToolLabel} from '../runtime/mcp-tool-labels.mjs';
export function mcpActivityLabels(steps=[]){
 const labels={};
 for(const step of steps){const match=/^mcp__([a-z][a-z0-9-]{1,39})__([A-Za-z0-9_-]{1,64})$/.exec(step?.tool||'');if(match)labels[step.tool]=mcpToolLabel(match[1],match[2]);}
 return labels;
}

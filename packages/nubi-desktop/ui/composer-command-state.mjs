import {AGENT_COMMANDS,desktopSkillCommand} from '../runtime/agent-commands.mjs';

export function draftCommand(name,skills=[]){
 const key=name.normalize('NFKC').toLowerCase(),builtin=AGENT_COMMANDS.find(item=>item.command===key);
 if(builtin)return builtin.action?null:builtin;
 const matches=skills.filter(skill=>desktopSkillCommand(skill)===key);
 return matches.length===1?{command:key,title:matches[0].title||matches[0].name,icon:'layers',description:matches[0].description,skill:matches[0]}:null;
}
// Keep the existing serialized request/draft contract. The chip is a projection
// of one leading command; legacy nested selections collapse to the last one.
export function splitComposerDraft(value,skills=[]){
 let input=value,selection=null,match;
 while((match=/^\/([^\s/]+)(?:[ \t]|\r?\n)/.exec(input))){
  const item=draftCommand(match[1],skills);if(!item)break;
  selection=item;input=input.slice(match[0].length);
 }
 return {selection,input};
}
export function replaceComposerCommand(value,command,skills=[]){
 return `/${command} ${splitComposerDraft(value,skills).input}`;
}
export function updateComposerInput(value,input,skills=[]){
 const previous=splitComposerDraft(value,skills),next=splitComposerDraft(input,skills);
 const selection=next.selection||previous.selection;
 return selection?`/${selection.command} ${next.input}`:input;
}
export function composerCommandQuery(value,caret=value.length){
 const end=Math.max(0,Math.min(caret,value.length)),match=/(?:^|\s)\/([^\s/]*)$/.exec(value.slice(0,end));
 return match?{query:'/'+match[1],start:end-match[1].length-1,end}:null;
}
export function removeComposerQuery(value,query){return query?value.slice(0,query.start)+value.slice(query.end):value;}

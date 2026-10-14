import Mention from '@tiptap/extension-mention';
import {fillMentionIdentity} from './mentionIdentity';

export const IdentityMention=Mention.extend({
 addOptions(){return {...this.parent?.(),profile:null};},
 addNodeView(){return ({node})=>{
  const dom=document.createElement('span'),login=node.attrs.id;let active=true;
  dom.dataset.type='mention';dom.dataset.id=login;dom.contentEditable='false';dom.tabIndex=0;dom.setAttribute('role','button');fillMentionIdentity(dom,login,null);
  this.options.profile?.(login)?.then(user=>{if(active)fillMentionIdentity(dom,login,user);}).catch(()=>{});
  return {dom,ignoreMutation:()=>true,update:next=>next.type===node.type&&next.attrs.id===login,destroy:()=>{active=false;}};
 };},
});

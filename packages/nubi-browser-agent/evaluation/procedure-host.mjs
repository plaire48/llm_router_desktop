import {createHash} from 'node:crypto';
import {runReplay,recordTarget,recordStep} from '../../../extensions/aipro-chat/browser-replay.js';
import {createReplayMemory} from '../dist/memory.js';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const address=value=>{const u=new URL(value);return u.origin+u.pathname;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Evaluation host bridge: no task answers or site-specific selectors enter the core.
export function createProcedureHost({page,origin,allowedOrigins=[origin],projectId='memory-evaluation',title='검증한 입력과 저장 절차',qualification=true}){
  const drafts=[],cards=new Map(),values=new Set();let enabled=true,revision=1,captureCount=0;
  const scrub=value=>{
    if(typeof value==='string'){for(const item of values)if(item.length>=3)value=value.replaceAll(item,'');return clean(value);}
    if(Array.isArray(value))return value.map(scrub);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,scrub(v)]));
    return value;
  };
  const frameRoute=frame=>{
    const chain=[];for(let at=frame;at;at=at.parentFrame())chain.unshift([address(at.url()),at.name()]);
    return 'https://nubi-frame.invalid/'+digest(chain);
  };
  const routeFrom=(info,frames)=>{
    const chain=[];for(let at=info;at;at=frames.find(x=>x.frameId===at.parentId))chain.unshift([at.address,at.name]);
    return 'https://nubi-frame.invalid/'+digest(chain);
  };
  const element=c=>scrub({ref:c.targetId,tag:c.tag,role:c.role||(c.tag==='input'||c.tag==='textarea'||c.editable?'textbox':c.tag==='button'?'button':c.tag==='a'?'link':c.tag==='select'?'combobox':'generic'),name:c.name,kind:c.editable?'field':'control',...(c.type?{type:c.type}:{}),context:c.context?[{role:'group',name:c.context}]:[],...(c.disabled||c.readOnly?{coveredBy:'disabled'}:{})});
  const view=async observation=>{
    if(!Array.isArray(observation.data?.candidates)||!Array.isArray(observation.data?.frames))throw Error('structural_evidence_required');
    const info=observation.data.frames;
    return {url:address(page.url()),title:await page.title(),frames:info.map((f,index)=>({frame:f.parentId===null?0:index,url:routeFrom(f,info),truncated:observation.data.truncated,elements:observation.data.candidates.filter(c=>c.frameId===f.frameId).map(element)}))};
  };
  const memory=createReplayMemory({
    qualification,
    replay:{runReplay,recordTarget},view,
    store:{
      async find(){return {notes:[],cards:enabled?[...cards.values()]:[]};},
      async get(id,version){const card=cards.get(id);return card?.version===version?structuredClone(card):null;},
      async current(card,context){return enabled&&cards.get(card.id)?.version===card.version&&card.wikiRef.version===revision&&allowedOrigins.includes(new URL(page.url()).origin)&&context.projectId===projectId;},
      async propose(candidate){drafts.push(structuredClone(candidate));},
    },
    async capture(context,action){
      if(typeof action.arguments.targetId!=='string'||!['browser_type','browser_click','browser_press_key'].includes(action.tool))return;
      captureCount++;if(typeof action.arguments.text==='string')values.add(action.arguments.text);
      const candidate=context.observation.data?.candidates?.find(x=>x.targetId===action.arguments.targetId);
      let target;
      if(candidate){const current=await view(context.observation),found=current.frames.flatMap(f=>f.elements).find(x=>x.ref===candidate.targetId);target=recordTarget(found,current);}
      else{
        const handle=await page.locator('aria-ref='+action.arguments.targetId).elementHandle();if(!handle)return;
        try{
          const frame=await handle.ownerFrame();if(!frame)return;
          const c=await handle.evaluate(el=>({tag:el.tagName.toLowerCase(),type:el instanceof HTMLInputElement?el.type:'',role:el.getAttribute('role')??'',name:(el.getAttribute('aria-label')??el.getAttribute('title')??el.textContent??'').trim().slice(0,120),context:(el.closest('tr')?.innerText??el.parentElement?.innerText??'').trim().slice(0,240),editable:el instanceof HTMLTextAreaElement||el instanceof HTMLInputElement||el.isContentEditable,disabled:el.disabled===true,readOnly:el.readOnly===true}));
          c.targetId=action.arguments.targetId;
          const found=element(c),current={frames:[{frame:frame===page.mainFrame()?0:1,url:frameRoute(frame),elements:[found]}]};
          target=recordTarget(found,current);
        }finally{await handle.dispose();}
      }
      return target?{target,page:address(page.url()),title:await page.title(),portable:!!candidate||['input','textarea','button','a','select'].includes(target.tag)}:undefined;
    },
    async buildCandidate(experience){
      // Reuse existing recorder; input values exist only in this host's run memory.
      const steps=[],inputs=[];let serial=0,omitted=0;const slot=()=>`v${++serial}`;
      for(const item of experience.trace){
        // A recorded action subprocedure is not a claim that the task's source reading is replayable.
        if(item.receipt.effect==='read')continue;
        if(!item.metadata?.target||!['browser_type','browser_click','browser_press_key'].includes(item.tool))return null;
        // Candidate induction only: a non-actionable exploratory click is not
        // portable. Omitting it requires host review and fresh-input qualification;
        // it is never skipped in an active user run on this evidence alone.
        if(item.tool==='browser_click'&&!item.metadata.portable){omitted++;continue;}
        const target=scrub(item.metadata.target),ref='learning-ref';
        const current={url:item.metadata.page,title:item.metadata.title,frames:[{frame:target.frame?1:0,url:target.frame??'https://nubi-frame.invalid/main',elements:[{...target,ref}]}]};
        const captured=recordStep(item.tool==='browser_type'?'fill_form':item.tool==='browser_press_key'?'press_key':'click_element',item.tool==='browser_type'?{fields:[{field_id:ref,value:item.arguments.text}]}:item.tool==='browser_press_key'?{ref,key:item.arguments.key}:{ref},current,{actionIssued:true,observation:{url:null}},slot);
        if(!captured?.step||captured.unreplayable)return null;
        if(item.tool==='browser_type')inputs.push({slot:captured.step.fields[0].slot,label:target.name||target.context?.[0]?.name||'입력값'});
        // Portable target is from host-observed metadata, not recorder's synthetic ref.
        if(captured.step.target)captured.step.target=target;
        for(const field of captured.step.fields??[])field.target=target;
        delete captured.step.formContract;delete captured.step.formTitle;
        steps.push(captured.step);
      }
      if(!steps.length)return null;
      return {schemaVersion:1,id:'learned-workflow',version:1,status:'draft',title,wikiRef:{id:'evaluation-wiki',version:revision,hash:digest(steps)},induction:{omittedNonportableClicks:omitted,requiresFreshInputQualification:true},inputs,steps};
    },
  });
  return {memory,drafts,cards,view,get captureCount(){return captureCount;},
    review(){if(drafts.length!==1)throw Error('one_candidate_required');const card={...structuredClone(drafts[0]),status:'reviewed'};cards.set(card.id,card);return card;},
    revoke(){enabled=false;revision++;},
  };
}

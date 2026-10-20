import {createHash} from 'node:crypto';
import {runReplay,recordTarget,recordStep} from '../../../extensions/aipro-chat/browser-replay.js';
import {createReplayMemory} from '../dist/memory.js';

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const address=value=>{const u=new URL(value);return u.origin+u.pathname;};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Evaluation host bridge: no task answers or site-specific selectors enter the core.
export function createProcedureHost({page:pageOption,origin,allowedOrigins=[origin],projectId='memory-evaluation',title='검증한 입력과 저장 절차',qualification=true}){
  // The page may be given as a function so one host can follow a fresh page per trial (browser teach plan T1).
  const page=typeof pageOption==='function'?new Proxy({},{get:(_,key)=>{const current=pageOption();const value=current[key];return typeof value==='function'?value.bind(current):value;}}):pageOption;
  const drafts=[],cards=new Map(),values=new Set(),captureErrors=[];let enabled=true,revision=1,captureCount=0,lastCandidate=null;
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
  const element=c=>scrub({ref:c.targetId,tag:c.tag,role:c.role||(c.tag==='input'&&c.type==='checkbox'?'checkbox':c.tag==='input'&&c.type==='radio'?'radio':c.tag==='input'||c.tag==='textarea'||c.editable?'textbox':c.tag==='button'?'button':c.tag==='a'?'link':c.tag==='select'?'combobox':'generic'),name:c.name,kind:c.editable?'field':'control',...(c.type?{type:c.type}:{}),context:c.context?[{role:'group',name:c.context}]:[],...(c.disabled||c.readOnly?{coveredBy:'disabled'}:{})});
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
     try{return await captureAction(context,action);}catch(error){captureErrors.push({tool:action.tool,error:String(error?.code??error?.message??error).slice(0,160)});throw error;}
    },
    async buildCandidate(experience){
      // Reuse existing recorder; input values exist only in this host's run memory.
      const steps=[],inputs=[];let serial=0,omitted=0;const slot=()=>`v${++serial}`;
      for(const item of experience.trace){
        // A recorded action subprocedure is not a claim that the task's source reading is replayable.
        if(item.receipt.effect==='read')continue;
        if(!item.metadata?.target||!['browser_type','browser_click','browser_press_key','browser_select_option'].includes(item.tool)){captureErrors.push({tool:item.tool,error:!item.metadata?.target?'candidate_missing_target':'candidate_tool_unsupported'});return null;}
        // Candidate induction only: a non-actionable exploratory click is not
        // portable. Omitting it requires host review and fresh-input qualification;
        // it is never skipped in an active user run on this evidence alone.
        if(item.tool==='browser_click'&&!item.metadata.portable){omitted++;continue;}
        const target=scrub(item.metadata.target),ref='learning-ref';
        const current={url:item.metadata.page,title:item.metadata.title,frames:[{frame:target.frame?1:0,url:target.frame??'https://nubi-frame.invalid/main',elements:[{...target,ref}]}]};
        // browser teach plan T2 (2026-10-21): a dropdown choice becomes a select_option step with its values in a slot.
        const captured=recordStep(item.tool==='browser_type'?'fill_form':item.tool==='browser_press_key'?'press_key':item.tool==='browser_select_option'?'select_option':'click_element',item.tool==='browser_type'?{fields:[{field_id:ref,value:item.arguments.text}]}:item.tool==='browser_press_key'?{ref,key:item.arguments.key}:item.tool==='browser_select_option'?{ref,values:item.arguments.values}:{ref},current,{actionIssued:true,observation:{url:null}},slot);
        if(!captured?.step||captured.unreplayable){captureErrors.push({tool:item.tool,error:'candidate_unreplayable:'+String(captured?.unreplayable??'no_step')});return null;}
        if(item.tool==='browser_type')inputs.push({slot:captured.step.fields[0].slot,label:target.name||target.context?.[0]?.name||'입력값'});
        if(item.tool==='browser_select_option')inputs.push({slot:captured.step.slot,label:target.name||'선택값',kind:'choice'});
        // Portable target is from host-observed metadata, not recorder's synthetic ref.
        if(captured.step.target)captured.step.target=target;
        for(const field of captured.step.fields??[])field.target=target;
        delete captured.step.formContract;delete captured.step.formTitle;
        steps.push(captured.step);
      }
      if(!steps.length){captureErrors.push({tool:'build',error:'candidate_no_steps:trace_'+experience.trace.length+':omitted_'+omitted});return null;}
      const candidate={schemaVersion:1,id:'learned-workflow',version:1,status:'draft',title,wikiRef:{id:'evaluation-wiki',version:revision,hash:digest(steps)},...(experience.trace[0]?.metadata?.page?{startPage:experience.trace[0].metadata.page}:{}),induction:{omittedNonportableClicks:omitted,requiresFreshInputQualification:true},inputs,steps};
      lastCandidate=candidate;return candidate;
    },
  });
  async function captureAction(context,action){
      if(typeof action.arguments.targetId!=='string'||!['browser_type','browser_click','browser_press_key','browser_select_option'].includes(action.tool))return;
      captureCount++;if(typeof action.arguments.text==='string')values.add(action.arguments.text);
      for(const value of Array.isArray(action.arguments.values)?action.arguments.values:[])if(typeof value==='string')values.add(value);
      const candidate=context.observation.data?.candidates?.find(x=>x.targetId===action.arguments.targetId);
      let target;
      if(candidate){const current=await view(context.observation),found=current.frames.flatMap(f=>f.elements).find(x=>x.ref===candidate.targetId);target=recordTarget(found,current);}
      else{
        const handle=await page.locator('aria-ref='+action.arguments.targetId).elementHandle();if(!handle)return;
        try{
          const frame=await handle.ownerFrame();if(!frame)return;
          // Every like control of the frame is listed with the pressed one, so recordTarget can keep its ordinal among
          // identical siblings (two unnamed checkboxes, a column of 삭제 buttons). Browser teach plan T2, 2026-10-21.
          const rows=await handle.evaluate(el=>{const label=e=>{const id=e.getAttribute('id');const forLabel=id?document.querySelector('label[for="'+id.replace(/"/g,'')+'"]'):null;return (forLabel?.innerText??e.closest('label')?.innerText??'').trim();};const info=e=>({tag:e.tagName.toLowerCase(),type:e instanceof HTMLInputElement?e.type:'',role:e.getAttribute('role')??'',name:(e.getAttribute('aria-label')??e.getAttribute('title')??(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement||e instanceof HTMLSelectElement?(label(e)||e.getAttribute('placeholder')||''):e.textContent)??'').trim().slice(0,120),context:(e.closest('tr')?.innerText??e.parentElement?.innerText??'').trim().slice(0,240),editable:e instanceof HTMLTextAreaElement||e instanceof HTMLInputElement||e.isContentEditable,disabled:e.disabled===true,readOnly:e.readOnly===true});const all=Array.from(document.querySelectorAll('input:not([type=hidden]),textarea,button,select,a[href],[contenteditable=true],[onclick],[tabindex]')).slice(0,400);return {at:all.indexOf(el),items:all.map(info),self:info(el)};});
          const items=rows.items.map((c,index)=>element({...c,targetId:index===rows.at?action.arguments.targetId:'sibling-'+index}));
          const found=rows.at>=0?items[rows.at]:element({...rows.self,targetId:action.arguments.targetId});
          const current={frames:[{frame:frame===page.mainFrame()?0:1,url:frameRoute(frame),elements:rows.at>=0?items:[found]}]};
          target=recordTarget(found,current);
        }finally{await handle.dispose();}
      }
      return target?{target,page:address(page.url()),title:await page.title(),portable:!!candidate||['input','textarea','button','a','select'].includes(target.tag)}:undefined;
  }
  return {memory,drafts,cards,view,captureErrors,get lastCandidate(){return lastCandidate;},get captureCount(){return captureCount;},
    review(){if(drafts.length!==1)throw Error('one_candidate_required');const card={...structuredClone(drafts[0]),status:'reviewed'};cards.set(card.id,card);return card;},
    // A demonstrated card (teach plan T3) enters the store as reviewed, as a person's test run would mark it.
    adopt(card){const reviewed={...structuredClone(card),status:'reviewed'};cards.set(reviewed.id,reviewed);return reviewed;},
    revoke(){enabled=false;revision++;},
  };
}

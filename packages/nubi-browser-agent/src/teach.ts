// Teach session (browser teach plan T4, 2026-10-21): from a procedure card the host builds a plan draft the person
// can read, asks only what it cannot infer (where, which value and its source, why), and offers a numbered board
// of the current page's controls. Answers extend the card with teach metadata; the card's steps stay as recorded.
import type {Json,JsonObject,Observation} from './types.js';

export type ValueSource={kind:'ask';label:string}|{kind:'literal';value:string}|{kind:'mail';field:string;filter?:string}|{kind:'wiki';page:string;section?:string};
export interface PlanStep {index:number;tool:string;target:string;summary:string;reason:string;reasonGuessed:boolean;slot?:string;valueSource?:ValueSource;guard:boolean;assert?:JsonObject|null}
export interface TeachQuestion {id:string;kind:'purpose'|'value'|'why'|'where';prompt:string;choices?:string[];stepIndex?:number;slot?:string}
export interface PlanDraft {title:string;purpose:string;steps:PlanStep[];questions:TeachQuestion[]}
export interface BoardRow {number:number;targetId:string;role:string;name:string;kind:string;context:string;box?:{x:number;y:number;width:number;height:number}}

const GUARD=/제출|저장|삭제|결제|전송|보내기|확정|승인|submit|save|delete|remove|pay|send|confirm|apply|purchase|order/i;
const name=(target:JsonObject|undefined)=>String(target?.name??'').trim();
const contextName=(target:JsonObject|undefined)=>{const context=target?.context;return Array.isArray(context)&&context.length?String((context[0] as JsonObject)?.name??'').trim():'';};
const label=(target:JsonObject|undefined)=>name(target)||contextName(target)||String(target?.role??'컨트롤');
const quote=(text:string)=>'‘'+text.slice(0,60)+'’';

function stepOf(step:JsonObject,index:number):PlanStep{
  const tool=String(step.tool);
  if(tool==='fill_form'){const field=(step.fields as JsonObject[]|undefined)?.[0];const target=field?.target as JsonObject|undefined;const what=label(target);return {index,tool,target:what,summary:quote(what)+' 칸에 값을 입력한다',reason:quote(what)+' 칸을 채운다',reasonGuessed:true,slot:String(field?.slot??''),valueSource:{kind:'ask',label:what},guard:false,assert:null};}
  if(tool==='select_option'){const target=step.target as JsonObject|undefined;const what=label(target);return {index,tool,target:what,summary:quote(what)+'에서 항목을 고른다',reason:quote(what)+'의 값을 정한다',reasonGuessed:true,slot:String(step.slot??''),valueSource:{kind:'ask',label:what},guard:false,assert:null};}
  if(tool==='press_key'){const target=step.target as JsonObject|undefined;const key=String((step.args as JsonObject|undefined)?.key??'');return {index,tool,target:label(target),summary:quote(label(target))+'에서 '+key+' 키를 누른다',reason:key==='Enter'?'입력을 확정한다':key==='Tab'?'다음 칸으로 옮긴다':key+' 키 동작',reasonGuessed:true,guard:key==='Enter',assert:null};}
  const target=step.target as JsonObject|undefined;const what=label(target);const guard=GUARD.test(what);
  return {index,tool,target:what,summary:quote(what)+(String(target?.role)==='link'?' 링크로 이동한다':' 버튼을 누른다'),reason:guard?quote(what)+'로 작업을 확정한다':quote(what)+'를 연다',reasonGuessed:true,guard,assert:null};
}

/** A readable plan from a card, with guesses marked so the person can correct them. */
export function draftPlan(card:JsonObject,input:{request?:string}={}):PlanDraft{
  const steps=((card.steps as JsonObject[]|undefined)??[]).map(stepOf);
  const purpose=String(input.request??'').trim()||String(card.title??'').trim();
  return {title:String(card.title??''),purpose,steps,questions:questionsFor({title:String(card.title??''),purpose,steps,questions:[]})};
}

/** Only what the draft cannot infer: the purpose once, each value and its source, and the reason for each guarded step. */
export function questionsFor(plan:PlanDraft):TeachQuestion[]{
  const questions:TeachQuestion[]=[];
  if(!plan.purpose)questions.push({id:'purpose',kind:'purpose',prompt:'이 절차는 무엇을 하기 위한 것인가요? 한 줄로 적어 주세요.'});
  for(const step of plan.steps){
    if(step.slot&&step.valueSource?.kind==='ask')questions.push({id:'value:'+step.index,kind:'value',stepIndex:step.index,slot:step.slot,prompt:quote(step.target)+' 칸의 값은 어디서 가져오나요?',choices:['실행 때 묻기','고정값','메일에서','위키에서']});
    if(step.guard&&step.reasonGuessed)questions.push({id:'why:'+step.index,kind:'why',stepIndex:step.index,prompt:quote(step.target)+'를 누르는 이유와, 성공했는지 확인하는 방법은 무엇인가요?'});
  }
  return questions;
}

/** Answers extend the card with teach metadata. Steps are never changed here. */
export function applyAnswers(card:JsonObject,plan:PlanDraft,answers:Record<string,Json>):JsonObject{
  const teach:JsonObject={purpose:String(answers.purpose??plan.purpose),steps:{}};
  const steps=teach.steps as JsonObject;
  for(const step of plan.steps){
    const entry:JsonObject={reason:step.reason,guard:step.guard};
    const why=answers['why:'+step.index];if(typeof why==='string'&&why.trim()){entry.reason=why.trim().slice(0,400);entry.assert={text:why.trim().slice(0,200)};}
    const value=answers['value:'+step.index];
    if(step.slot){
      if(value&&typeof value==='object'&&!Array.isArray(value)&&typeof (value as JsonObject).kind==='string')entry.valueSource=value;
      else if(typeof value==='string')entry.valueSource=value==='고정값'?{kind:'literal_pending'}:value==='메일에서'?{kind:'mail',field:''}:value==='위키에서'?{kind:'wiki',page:''}:{kind:'ask',label:step.target};
      else entry.valueSource={kind:'ask',label:step.target};
      // A literal value is kept apart from the card: the card holds only that the slot is literal.
      if((entry.valueSource as JsonObject).kind==='literal')entry.valueSource={kind:'literal_pending'};
    }
    steps[String(step.index)]=entry;
  }
  return {...card,teach};
}

/** The numbered board of the current page's controls, from a structural observation. */
export function annotationBoard(observation:Observation):BoardRow[]{
  const data=observation.data as JsonObject|null;const candidates=(data?.candidates as JsonObject[]|undefined)??[];
  return candidates.filter(c=>c.visible!==false).slice(0,120).map((c,k)=>({number:k+1,targetId:String(c.targetId),role:String(c.role||(c.tag==='a'?'link':c.tag==='button'?'button':c.editable?'textbox':c.tag==='select'?'combobox':'generic')),name:String(c.name??'').slice(0,80),kind:c.editable?'field':'control',context:String(c.context??'').slice(0,80),...(c.box&&typeof c.box==='object'?{box:c.box as BoardRow['box']}:{})}));
}

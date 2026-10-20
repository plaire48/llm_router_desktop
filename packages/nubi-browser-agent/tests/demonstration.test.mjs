import test from 'node:test';
import assert from 'node:assert/strict';
import {recordStep,recordTarget} from '../../../extensions/aipro-chat/browser-replay.js';
import {demonstrationCard,DEMONSTRATION_SCRIPT,INTERACTIVE_SELECTOR} from '../dist/demonstration.js';

// Browser teach plan T3: a demonstration becomes the same draft card a learned run produces.
const items=[
  {tag:'input',type:'text',role:'',name:'Full Name',context:'Full Name',editable:true,disabled:false,readOnly:false,sensitive:false},
  {tag:'input',type:'email',role:'',name:'name@example.com',context:'Email',editable:true,disabled:false,readOnly:false,sensitive:false},
  {tag:'input',type:'password',role:'',name:'Password',context:'Password',editable:true,disabled:false,readOnly:false,sensitive:true},
  {tag:'select',type:'',role:'',name:'Choose',context:'Choose',editable:false,disabled:false,readOnly:false,sensitive:false},
  {tag:'button',type:'submit',role:'',name:'Submit',context:'',editable:false,disabled:false,readOnly:false,sensitive:false},
];
const at=(kind,index,extra={})=>({kind,at:1,index,items,url:'https://demo.invalid/form',title:'Form',...extra});
const recorder={recordStep,recordTarget};

test('typing, a dropdown choice, a key and a click become slots and steps without any value in the card',()=>{
  const events=[at('input',0,{value:'홍'}),at('input',0,{value:'홍길동'}),at('input',1,{value:'hong@example.com'}),at('input',2,{value:'secret'}),at('select',3,{values:['2']}),at('key',0,{key:'Tab'}),at('key',0,{key:'x'}),at('click',4)];
  const card=demonstrationCard(events,{id:'demo',title:'양식 제출',wikiRef:{id:'wiki',version:1},recorder,route:'https://demo.invalid/form'});
  assert.ok(card);
  assert.deepEqual(card.steps.map(s=>s.tool),['fill_form','fill_form','select_option','press_key','click_element']);
  assert.deepEqual(card.inputs.map(i=>i.label),['Full Name','name@example.com','Choose']);
  assert.equal(JSON.stringify(card).includes('홍길동'),false,'typed values stay out of the card');
  assert.equal(JSON.stringify(card).includes('secret'),false,'the password field is never recorded');
  assert.equal(JSON.stringify(card).includes('"2"'),false,'chosen values stay out of the card');
  assert.equal(card.demonstration.skipped,2,'the password input and the unsupported key are skipped');
  assert.equal(card.steps[0].fields[0].target.name,'Full Name');
  assert.equal(card.steps[4].target.name,'Submit');
  assert.match(card.wikiRef.hash,/^[a-f0-9]{64}$/);
  assert.equal(card.startPage,'https://demo.invalid/form','the card remembers where the demonstration began');
});

test('an empty or unusable demonstration yields no card and the page script lists the same controls',()=>{
  assert.equal(demonstrationCard([],{id:'demo',title:'t',wikiRef:{id:'wiki',version:1},recorder,route:'r'}),null);
  assert.equal(demonstrationCard([at('click',-1)],{id:'demo',title:'t',wikiRef:{id:'wiki',version:1},recorder,route:'r'}),null);
  assert.ok(DEMONSTRATION_SCRIPT.includes(JSON.stringify(INTERACTIVE_SELECTOR)));
  assert.ok(DEMONSTRATION_SCRIPT.includes("'password'"),'the page script knows sensitive fields');
});

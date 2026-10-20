import {test} from 'node:test';
import assert from 'node:assert/strict';
import {complexBusiness,expected,variants,extraExpected,preservedPlanUnits} from '../eval/live-complex-cases.mjs';
test('sensitivity oracle varies with the frozen data and handles zero activity',()=>{
 const c=complexBusiness('excel'),base=expected(c),extra=extraExpected(c.datasets);
 assert(extra.discountScenario<base.total);assert.equal(extra.reducedBudgetGap,Math.round((c.datasets.settings[0].budget*.85-base.total)*100)/100);
 const [change,zero]=variants(c);assert.notEqual(extraExpected(change.datasets).discountScenario,extra.discountScenario);
 assert.equal(extraExpected(zero.datasets).discountScenario,0);assert.equal(extraExpected(zero.datasets).reducedBudgetGap,c.datasets.settings[0].budget*.85);
});
test('followup oracle rejects deletion, reordering, semantic or formatting changes outside appended content',()=>{
 const before={title:'A',header:'H',footer:'F',blocks:[{kind:'paragraph',text:'보존',fontSize:12},{kind:'table',rows:[['원천']]}]};
 const append={...structuredClone(before),blocks:[...structuredClone(before.blocks),{kind:'paragraph',text:'새 확인'}]};
 assert(preservedPlanUnits('word',before,append));
 for(const mutate of [p=>p.blocks.reverse(),p=>p.blocks[0].fontSize=10,p=>p.blocks[0].text='변경',p=>p.header='다른 머리글',p=>p.blocks.shift()]){const p=structuredClone(append);mutate(p);assert(!preservedPlanUnits('word',before,p));}
 const sheet={name:'원장',cells:[{address:'A1',value:1}]},book={title:'원본',sheets:[sheet],outputs:[{metric:'total',sheet:'원장',cell:'A1'}]};
 assert(preservedPlanUnits('excel',book,{...structuredClone(book),sheets:[structuredClone(sheet),{name:'추가'}]}));
 assert(!preservedPlanUnits('excel',book,{...structuredClone(book),sheets:[structuredClone(sheet),{name:'추가'}],outputs:[]}));
 const ppt={title:'원본',slides:[{elements:[{text:'원천'}]}]};assert(preservedPlanUnits('powerpoint',ppt,{...ppt,slides:[...ppt.slides,{elements:[{text:'추가'}]}]}));
 assert(!preservedPlanUnits('powerpoint',ppt,{...ppt,slides:[...ppt.slides,{elements:[]},{elements:[]}]}));
});

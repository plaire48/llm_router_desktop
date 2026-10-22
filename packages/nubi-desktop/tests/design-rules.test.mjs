import test from 'node:test';import assert from 'node:assert/strict';
const rules=await import('../scripts/design-rules.mjs').catch(()=>({}));
test('shared source rules reject local color and motion overrides rather than transition-all and literal timings',()=>{
 assert.equal(typeof rules.sourceDesignIssues,'function');const ids=rules.sourceDesignIssues('ui/synthetic.css','.card { color:#123456; transition:all 200ms; }',{colors:true}).map(x=>x.rule);assert(ids.includes('color_literal'));assert(ids.includes('motion_literal'));assert(ids.includes('transition_all'));
 assert.deepEqual(rules.sourceDesignIssues('ui/synthetic.css','.card {color:var(--nubi-text-primary);transition:opacity var(--nubi-motion-state) var(--nubi-ease-out);}'),[]);
});
test('shared motion validation also catches duration aliases outside the token owner',()=>{
 assert.equal(typeof rules.sourceDesignIssues,'function');assert(rules.sourceDesignIssues('ui/synthetic.css','.run {--workflow-state-duration:180ms;}').some(x=>x.rule==='motion_literal'));
 assert.deepEqual(rules.sourceDesignIssues('design/workspace-motion.css',':root {--nubi-motion-enter:280ms;}'),[]);
});
test('one decision grades primary actions, heading repetition and nested tint consistently',()=>{
 assert.equal(typeof rules.judgeDesignFacts,'function');const issues=rules.judgeDesignFacts({primaryActions:2,duplicateTitles:1,nestedTint:1,rawErrors:1,motion:{enter:280,exit:180,press:120,state:180},reduced:false});assert.deepEqual(issues.map(x=>x.rule).sort(),['duplicate_title','nested_tint','primary_actions','raw_error']);
});
test('reduced motion has a real upper bound and normal mode preserves the approved transition ceiling',()=>{
 assert.equal(typeof rules.judgeDesignFacts,'function');assert(rules.judgeDesignFacts({motion:{enter:280},reduced:true}).some(x=>x.rule==='reduced_motion'));assert(rules.judgeDesignFacts({motion:{enter:301},reduced:false}).some(x=>x.rule==='interaction_motion'));assert.deepEqual(rules.judgeDesignFacts({primaryActions:1,motion:{enter:120,state:120},reduced:true}),[]);
});
test('sidebar project and search overlap is a shared failure even while a modal owns the content scope',()=>{
 assert.equal(typeof rules.judgeDesignFacts,'function');assert(rules.judgeDesignFacts({sidebarOverlap:true}).some(x=>x.rule==='sidebar_overlap'));
});
// :has() made every DOM change recalculate the whole document's style (design light-flow §1.1); it is not allowed back.
test('has_selector reports every :has() selector with its line',async()=>{
 const rules=await import('../scripts/design-rules.mjs');
 const issues=rules.sourceDesignIssues('ui/x.css','.a{color:red}\n/* .c:has(.d) */\n.b:has(.c), .e{color:red}\n:root:has(.desktop-shell) .f{color:red}\n',{has:true});
 assert.deepEqual(issues.filter(i=>i.rule==='has_selector').map(i=>[i.line,i.selector]),[[3,'.b:has(.c)'],[4,':root:has(.desktop-shell) .f']]);
 assert.deepEqual(rules.sourceDesignIssues('ui/x.css','.b:has(.c){color:red}'),[],'the rule is opt-in for older callers');
});

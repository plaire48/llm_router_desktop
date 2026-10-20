import test from'node:test';import assert from'node:assert/strict';import*as bridge from'../eval/dual-cli-host.mjs';
test('the same required-action schema prevents prose-only completion until a draft was submitted',()=>{
 assert.equal(typeof bridge.schemaForHostActions,'function');const tools=[{function:{name:'read_word_sources'}},{function:{name:'submit_word_draft'}}],required=bridge.schemaForHostActions(tools,true);
 assert.equal(required.properties.calls.minItems,1);assert.deepEqual(required.properties.calls.items.properties.name.enum,['read_word_sources','submit_word_draft']);assert.equal(bridge.schemaForHostActions([],true).properties.calls.maxItems,0);assert.equal(bridge.schemaForHostActions(tools,false).properties.calls.minItems,undefined);assert.equal(bridge.envelopeSchema.properties.calls.minItems,undefined);
});

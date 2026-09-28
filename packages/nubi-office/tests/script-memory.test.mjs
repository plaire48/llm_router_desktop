import test from 'node:test';
import assert from 'node:assert/strict';
import {newQuickJSWASMModuleFromVariant,TestQuickJSWASMModule} from 'quickjs-emscripten-core';
import RELEASE_SYNC from '@jitl/quickjs-wasmfile-release-sync';
import DEBUG_SYNC from '@jitl/quickjs-wasmfile-debug-sync';
import {evaluateDocumentScript} from '../worker/script-vm.mjs';

// Upstream's instrumented variant checks allocations that a successful worker
// exit alone cannot establish. Use the same evaluator and lifecycle in both.
for(const [name,variant] of [['release',RELEASE_SYNC],['debug',DEBUG_SYNC]]){
  test(`QuickJS ${name} disposes handles and runtimes on every evaluated exit path`,async()=>{
    const module=new TestQuickJSWASMModule(await newQuickJSWASMModuleFromVariant(variant));
    const cases=[
      ['function transform(input){return {total:input.a+input.b}}',undefined],
      ['let noEntry=1','script_entry_missing'],
      ['function transform(', 'script_syntax_error'],
      ['function transform(){throw new Error("failed calculation")}', 'script_failed'],
      ['function transform(){return {missing:undefined}}','script_output_invalid'],
      ['function transform(){const v={};v.self=v;return v}','script_output_invalid'],
      ['function transform(){let v=null;for(let i=0;i<64;i++)v={next:v};return v}',undefined],
      ['function transform(){let v=null;for(let i=0;i<65;i++)v={next:v};return v}','script_output_invalid'],
      ['function transform(){Promise.resolve().then(()=>{});return 42}','script_async_unsupported'],
      ['function transform(){return {get n(){Promise.resolve().then(()=>{});return 42}}}','script_async_unsupported'],
      ['function transform(){return "a".repeat(24001)}','script_output_limit'],
      ['function transform(){return "a".repeat(100000000)}','script_memory_limit'],
      ['function transform(){while(true){}}','script_timeout'],
      ['function transform(){return 42}',undefined]
    ];
    for(const [code,error] of cases){
      const result=await evaluateDocumentScript(code,'{"a":12,"b":30}',{module});
      // In 0.32.0 newRuntime omits options.ownedLifetimes, so the upstream
      // wrapper retains disposed runtime references. Assert they are all dead
      // BEFORE clearing that bookkeeping; never dispose a live leak to pass.
      for(const runtime of module.runtimes)assert.equal(runtime.alive,false,code);
      for(const context of module.contexts)assert.equal(context.alive,false,code);
      module.disposeAll();
      module.assertNoMemoryAllocated();assert.equal(result.error,error,code);
    }
  });
}

for(const [name,variant] of [['release',RELEASE_SYNC],['debug',DEBUG_SYNC]]){
  test(`QuickJS ${name} compile-only diagnostics release bytecode and syntax errors without executing code`,async()=>{
    const module=new TestQuickJSWASMModule(await newQuickJSWASMModuleFromVariant(variant));
    for(const code of ['while(true){}','function transform(', 'throw new Error("must not execute")']){
      const result=await evaluateDocumentScript(code,null,{module,compileOnly:true});
      assert.equal(result.error,code==='function transform('? 'script_syntax_error':undefined);
      if(!result.error){assert.equal(result.compiled,true);assert.equal(result.executed,false);}
      for(const runtime of module.runtimes)assert.equal(runtime.alive,false);
      for(const context of module.contexts)assert.equal(context.alive,false);
      module.disposeAll();module.assertNoMemoryAllocated();
    }
  });
}

// Explicit synthetic-only factual rejection probes; run with ../openwiki/node_modules/.bin/tsx.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWorkspace} from './corpus.mjs';
import {createClaudeCode} from '../runtime/claude-code.mjs';
import {NubiOpenWikiModel} from '../generated/openwiki-update/index.mjs';
import {reviewRepositoryPage} from '../../openwiki/src/agent/repository-semantic-review.ts';
if(!process.argv.includes('--live'))throw Error('explicit_live_required');
const outputName=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'wiki-semantic-review-2026-10-16';
if(!/^wiki-[a-z0-9-]+$/.test(outputName))throw Error('invalid_evaluation_output');
const out=path.resolve('verification',outputName);await mkdir(out,{recursive:true});
const cases=[
  {id:'whole-order-page',corpus:'order-service',statement:'createOrder는 할인 후 금액을 shippingFee에 전달합니다.',pageFile:'verification/wiki-semantic-review-2026-10-16/order-service-3/openwiki/architecture.md',sources:['src/order.mjs','src/discount.mjs','src/shipping.mjs','src/status.mjs','src/legacy/export.mjs','package.json','README.md','AGENTS.md','test/order.test.mjs','test/discount.test.mjs','test/shipping.test.mjs'],expected:false},
  {id:'function-scoped-only',corpus:'order-service',statement:'applyDiscount 함수 내부에서 invalid_amount를 직접 던지는 조건은 amount가 정수가 아니거나 음수인 경우뿐입니다. 다른 함수에서 발생하는 오류를 설명하는 문장은 아닙니다.',sources:['src/order.mjs','src/discount.mjs','src/shipping.mjs'],expected:true},
  {id:'order-overflow',corpus:'order-service',statement:'applyDiscount가 소계를 검증하므로 실제 createOrder 흐름에서는 shippingFee의 invalid_amount에 도달하지 않습니다.',sources:['src/order.mjs','src/discount.mjs','src/shipping.mjs'],expected:false},
  {id:'order-fractional',corpus:'order-service',statement:'createOrder는 모든 상품의 가격과 수량이 정수인지 개별 검증하여 소수 가격을 항상 거절합니다.',sources:['src/order.mjs','src/discount.mjs'],expected:false},
  {id:'cache-overflow-cancel',corpus:'cache-retry',statement:'유한한 TTL을 받으므로 캐시는 반드시 만료됩니다. 취소되면 진행 중인 작업도 즉시 중단되고 결과를 반환하지 않습니다.',sources:['src/cache.mjs','src/retry.mjs'],expected:false},
  {id:'injected-clock-overclaim',corpus:'cache-retry',statement:'expiresAt이 Infinity라면 주입한 now()의 반환값과 관계없이 엔트리는 절대 만료되지 않습니다.',sources:['src/cache.mjs'],expected:false},
  {id:'injected-clock-qualified',corpus:'cache-retry',statement:'expiresAt이 Infinity인 경우 유한한 now() 값으로는 만료되지 않습니다. 하지만 now()도 Infinity를 반환하면 >= 비교가 참이 되어 삭제됩니다.',sources:['src/cache.mjs'],expected:true},
  {id:'state-before-failure',corpus:'cache-retry',statement:'lookup에서 withRetry가 실패하면 새 값을 쓰지 않으므로 이전 캐시 항목은 그대로 남는다.',sources:['src/cache.mjs','src/service.mjs','src/retry.mjs'],expected:false},
  {id:'state-before-failure-qualified',corpus:'cache-retry',statement:'lookup은 먼저 cache.get을 호출한다. 만료된 항목은 이 조회에서 삭제될 수 있으므로, 이후 fetchItem이 실패해도 이전 캐시 상태가 유지된다고 보장할 수 없다.',sources:['src/cache.mjs','src/service.mjs','src/retry.mjs'],expected:true},
  {id:'cache-supported',corpus:'cache-retry',statement:'캐시는 객체를 복제하지 않고 참조를 반환합니다. now()가 expiresAt 이상이면 삭제합니다. 기본 retries=2는 최대 3회 실행이며 취소는 다음 시도 전에 확인합니다.',sources:['src/cache.mjs','src/retry.mjs'],expected:true},
];
const report:any=process.argv.includes('--append')?JSON.parse(await readFile(path.join(out,'probes.json'),'utf8')):{model:null,results:[]},claude=createClaudeCode({contextWindows:null});
try{
  await claude.connect();claude.model('opus');claude.reasoning('medium');report.model={id:claude.status().model,effort:claude.status().reasoningEffort};
  for(const task of process.argv.includes('--state-only')?cases.filter(item=>item.id.startsWith('state-before-failure')):process.argv.includes('--scope-only')?cases.filter(item=>['whole-order-page','function-scoped-only'].includes(item.id)):process.argv.includes('--whole-only')?cases.filter(item=>item.id==='whole-order-page'):cases){
    const workspace=await createWorkspace({corpus:task.corpus}),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000),started=Date.now();
    const row:any={id:task.id,reviewSourceHash:createHash('sha256').update(await readFile('../../packages/openwiki/src/agent/repository-semantic-review.ts')).digest('hex'),expected:task.expected,corpusHash:workspace.corpusHash,transcript:[]};report.results.push(row);
    const model=new NubiOpenWikiModel({signal:controller.signal,modelId:claude.status().model,taskId:null,complete:async(messages:any,tools:any)=>{
      const response=await claude.complete(messages,tools,controller.signal);row.transcript.push({messages,response});return response;
    }});
    try{
      const result=await reviewRepositoryPage({model,page:'/openwiki/probe.md',claims:[{statement:task.statement,evidence:task.sources.map(source=>({resource:'repo://'+source}))}],read:async file=>{
        if(file==='/openwiki/probe.md')return 'pageFile' in task?readFile(path.resolve(task.pageFile),'utf8'):task.statement;
        if(!task.sources.includes(file.slice(1)))throw Error('probe_scope');
        return readFile(path.join(workspace.root,file.slice(1)),'utf8');
      },signal:controller.signal});
      row.accepted=result.accepted;row.feedback=result.feedback;row.passed=row.accepted===row.expected;if(task.id==='whole-order-page'){row.targetDetected=result.feedback.includes('때만');row.passed=row.passed&&row.targetDetected;}
    }catch(error:any){row.error=error.message;row.passed=false;}
    finally{clearTimeout(timer);row.elapsedMs=Date.now()-started;await workspace.dispose();}
    await writeFile(path.join(out,'probes.json'),JSON.stringify(report,null,2)+'\n');console.log(`${row.id} passed=${row.passed} ${row.elapsedMs}ms`);
  }
}finally{claude.disconnect();}

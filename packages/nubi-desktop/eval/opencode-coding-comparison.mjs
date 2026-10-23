// Real model comparison in new temporary repositories. The same host, model,
// approval policy, files and hidden oracle are used for both loop engines.
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createClaudeCode} from '../runtime/claude-code.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {runAgent} from '../../../extensions/aipro-chat/agent-runtime.js';
import {createUser,applyProposals} from './user.mjs';
import {settleCommand} from './driver.mjs';
const run=promisify(execFile),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),hash=text=>createHash('sha256').update(text).digest('hex');
installAgent(ProjectService);
const label=process.env.NUBI_CODING_EVAL_LABEL||'',output=path.resolve('verification/opencode-coding-comparison'+(label?'-'+label:'')+'-2026-10-23');await mkdir(output,{recursive:true});
const cases=[{
 id:'quantity-zero',request:'수량이 0인 항목이 1개로 계산되는 버그를 고쳐 주세요. 수량을 생략하면 1개로 계산하고, 음수나 숫자가 아닌 수량은 RangeError로 거절해야 합니다. 기존 호출자의 세금 계산은 유지해 주세요. 필요한 회귀 테스트를 추가하고 실제 테스트 결과까지 확인해 주세요. 위키 생성은 필요 없습니다.',
 files:{'package.json':'{"type":"module","scripts":{"test":"node --test"}}\n','src/billing.mjs':'export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);\n}\n','src/invoice.mjs':'import {subtotal} from "./billing.mjs";\nexport const invoice = items => Math.round(subtotal(items) * 1.1 * 100) / 100;\n','test/billing.test.mjs':'import test from "node:test";\nimport assert from "node:assert/strict";\nimport {subtotal} from "../src/billing.mjs";\ntest("ordinary quantity",()=>assert.equal(subtotal([{price:10,quantity:2}]),20));\n'},
 oracle:'import assert from "node:assert/strict";import {subtotal} from "./src/billing.mjs";import {invoice} from "./src/invoice.mjs";assert.equal(subtotal([{price:9,quantity:0}]),0);assert.equal(subtotal([{price:7}]),7);for(const quantity of [-1,NaN,"2"])assert.throws(()=>subtotal([{price:4,quantity}]),RangeError);assert.equal(invoice([{price:10,quantity:2}]),22);',
 unchanged:['src/invoice.mjs'],testCommand:['node','--test'],commands:['(?:npm (?:test|run test)|node --test(?: .*)?)'],
},{
 id:'python-header-contract',request:'HTTP 헤더 정리 함수 normalize_headers의 입력 경계를 고쳐 주세요. 키는 앞뒤 공백을 제거하고 소문자로 만들고, 값은 문자열인 경우에만 앞뒤 공백을 제거해야 합니다. 원본 사전은 바꾸지 마세요. 정리한 키가 빈 문자열이거나 키가 문자열이 아니면 ValueError여야 합니다. 기존 숫자 값과 None은 유지해 주세요. unittest 회귀 테스트를 추가하고 직접 실행해 결과를 확인해 주세요.',
 files:{'headers.py':'def normalize_headers(headers):\n    return {key.lower(): value.strip() for key, value in headers.items()}\n','tests/test_headers.py':'import unittest\nfrom headers import normalize_headers\n\nclass HeaderTests(unittest.TestCase):\n    def test_string(self):\n        self.assertEqual(normalize_headers({"X-Key": " value "}), {"x-key": "value"})\n'},
 oracle:String.raw`from headers import normalize_headers
source = {" X-ID ": 7, "X-Null": None, " X-Name ": " v "}
result = normalize_headers(source)
assert result == {"x-id": 7, "x-null": None, "x-name": "v"}
assert list(source) == [" X-ID ", "X-Null", " X-Name "]
for invalid in [{" ": 1}, {4: "v"}]:
    try:
        normalize_headers(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("ValueError required")
`,
 oracleLanguage:'python',testCommand:['python3','-m','unittest','discover','-s','tests'],commands:['python3? -m unittest(?: [A-Za-z0-9_. /-]+)?'],
},{
 id:'typed-callers-crlf',request:'lookupUser가 존재하지 않는 ID에도 User라고 선언해서 호출자가 잘못 사용합니다. 반환형을 User | undefined로 정확하게 고치고 사용자 표시 함수도 누락된 사용자는 "알 수 없음"으로 처리하게 해 주세요. 기존 사용자의 표시 이름은 유지해 주세요. 타입 검사와 동작 테스트를 모두 실행하고, 원본의 CRLF 줄바꿈과 unrelated.txt는 보존해 주세요. 의존성은 이미 준비돼 있으니 설치하지 마세요.',
 files:{'package.json':'{"type":"module","scripts":{"test":"node --test","typecheck":"tsc --noEmit"}}\n','tsconfig.json':'{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["src/**/*.ts"]}\n','src/users.ts':'export interface User { id: string; name: string; }\r\nconst users: User[] = [{id:"u1",name:"누비"}];\r\nexport function lookupUser(id: string): User {\r\n  return users.find(user => user.id === id)!;\r\n}\r\n','src/display.ts':'import {lookupUser} from "./users.ts";\r\nexport function displayName(id: string): string {\r\n  return lookupUser(id).name;\r\n}\r\n','test/display.test.mjs':'import test from "node:test";\nimport assert from "node:assert/strict";\nimport {displayName} from "../src/display.ts";\ntest("existing user",()=>assert.equal(displayName("u1"),"누비"));\n','unrelated.txt':'Keep this exact file.\r\n'},
 oracle:String.raw`import assert from "node:assert/strict";
import {lookupUser} from "./src/users.ts";
import {displayName} from "./src/display.ts";
import {readFileSync} from "node:fs";
assert.equal(lookupUser("missing"),undefined);
assert.equal(displayName("missing"),"알 수 없음");
assert.equal(displayName("u1"),"누비");
for(const name of ["src/users.ts","src/display.ts"]){
 const text=readFileSync(name,"utf8");
 assert(!/(?<!\r)\n/.test(text),name+" keeps CRLF");
}
assert.match(readFileSync("src/users.ts","utf8"),/User\s*\|\s*undefined/);
`,
 unchanged:['unrelated.txt'],typescript:true,testCommand:['node','--test'],commands:['npm (?:test|run (?:test|typecheck))','node --test(?: .*)?','(?:npx --no-install )?tsc --noEmit(?: -p tsconfig.json)?'],
}];

async function one(testCase,engine,provider){
 const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-coding-'+engine+'-')),root=path.join(temporary,'project');await mkdir(root);for(const [name,text] of Object.entries(testCase.files)){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),text);}await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Evaluation project\nCurrent code is the source of implementation behavior.\n');
 if(testCase.typescript)await symlink(path.resolve('node_modules'),path.join(root,'node_modules'),'dir');
 await run('git',['init','-q'],{cwd:root});await run('git',['add','.'],{cwd:root});await run('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','Initial fixture'],{cwd:root});
 const service=new ProjectService({storageRoot:path.join(temporary,'state')}),calls=[],began=Date.now(),user=createUser({approvals:['patch','new_file','command'],commands:testCase.commands});let taskId,error,interactions=0,expired=false;
 await service.open(root);if(engine==='pi')service.codingRunner=runAgent;service.runBudgetLimits={calls:24,wallMs:240000};
 service.providers={status:()=>provider.status(),dispose(){},complete:async(...args)=>{if(calls.length>=65)throw Error('evaluation_model_budget');const at=Date.now();try{const result=await provider.complete(...args);calls.push({purpose:args[6]?.purpose||'actor',elapsedMs:Date.now()-at,tools:result.calls?.map(c=>c.function.name)||[],usage:result.usage});return result;}catch(e){calls.push({purpose:args[6]?.purpose||'actor',elapsedMs:Date.now()-at,error:e.message});throw e;}}};
 const timer=setTimeout(()=>{expired=true;service.stopAgent({taskId}).catch(()=>{});},300000);
 try{
  taskId=(await service.createTask({request:testCase.request})).id;await service.startAgent({taskId});
  while(interactions++<14){
   await service.agent.promise;if(expired)throw Error('evaluation_timeout');const task=service.task(taskId);if(task.state!=='review'){error=task.error||task.state;break;}
   const applied=user.log.applied.length;await applyProposals({service,taskId,user,root});const command=await user.approveCommand({service,taskId,root});
   if(command?.refused){error='command_requires_human';break;}
   if(command?.processId){await settleCommand(service,command.processId,()=>expired);if(expired)throw Error('evaluation_timeout');continue;}
   if(user.log.applied.length>applied){await service.startAgent({taskId});continue;}
   break;
  }
 }catch(e){error=e.message;}finally{clearTimeout(timer);}
 const task=service.task(taskId),commands=service.store.list('process:').filter(p=>p.taskId===taskId).map(({script,state,exitCode,repairOf})=>({script,state,exitCode,repairOf}));
 const grade={oracle:false,repositoryTests:false,typecheck:!testCase.typescript,preserved:true,hostVerification:commands.some(c=>c.exitCode===0&&/(?:--test|npm (?:test|run test)|unittest)/.test(c.script))};let gradeError;
 try{const name=testCase.oracleLanguage==='python'?'.oracle.py':'.oracle.mjs';await writeFile(path.join(root,name),testCase.oracle);await run(testCase.oracleLanguage==='python'?'python3':'node',[name],{cwd:root,timeout:20000});await rm(path.join(root,name));grade.oracle=true;}catch(e){gradeError=String(e.stderr||e.message).slice(-1200);}
 try{await run(testCase.testCommand[0],testCase.testCommand.slice(1),{cwd:root,timeout:20000});grade.repositoryTests=true;}catch(e){gradeError ||=String(e.stderr||e.message).slice(-1200);}
 if(testCase.typescript)try{await run(process.execPath,[path.resolve('node_modules/typescript/bin/tsc'),'--noEmit','-p','tsconfig.json'],{cwd:root,timeout:20000});grade.typecheck=true;}catch(e){gradeError ||=String(e.stdout||e.message).slice(-1200);}
 for(const name of testCase.unchanged||[])if(hash(await readFile(path.join(root,name)))!==hash(testCase.files[name]))grade.preserved=false;
 const candidateFiles={};for(const name of new Set([...Object.keys(testCase.files),...user.log.applied.map(item=>item.path)])){try{candidateFiles[name]=await readFile(path.join(root,name),'utf8');}catch{}}
 const result={case:testCase.id,candidateFiles,engine,model:provider.status().model,elapsedMs:Date.now()-began,calls:calls.length,callDetails:calls,error:error||null,state:task.state,executionEngine:task.executionEngine||{id:'pi'},review:task.resultReview,answer:task.messages.findLast(m=>m.role==='assistant')?.content,user:user.log,commands,grade,gradeError,passed:!error&&Object.values(grade).every(Boolean)};
 await writeFile(path.join(output,testCase.id+'-'+engine+'.json'),JSON.stringify(result,null,2));await writeFile(path.join(output,testCase.id+'-'+engine+'-changes.patch'),(await run('git',['diff','--no-ext-diff'],{cwd:root})).stdout);
 service.dispose();for(let wait=0;wait<50&&service.processes.active.size;wait++)await pause(50);service.store.close();await rm(temporary,{recursive:true,force:true,maxRetries:3});return result;
}

const provider=createClaudeCode(),results=[];
try{await provider.connect();for(const testCase of cases.filter(item=>!process.argv.some(arg=>arg.startsWith('--case='))||process.argv.includes('--case='+item.id)))for(const engine of (process.argv.includes('--native-only')?['opencode']:['pi','opencode'])){console.log(JSON.stringify({state:'starting',case:testCase.id,engine,model:provider.status().model}));const result=await one(testCase,engine,provider);results.push(result);await writeFile(path.join(output,'results.json'),JSON.stringify({scope:'Real Claude Code host model, same model and temporary repositories for Pi and official OpenCode 1.19.4, host approvals simulated only for explicitly allowed fixture operations; not a public benchmark or Windows proof.',results},null,2));console.log(JSON.stringify({state:'finished',case:result.case,engine,passed:result.passed,error:result.error,calls:result.calls,elapsedMs:result.elapsedMs,grade:result.grade}));}}
finally{provider.dispose?.();}

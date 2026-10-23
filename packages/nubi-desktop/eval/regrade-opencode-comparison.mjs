// Preserve the initial reports. Re-run only the broken independent graders,
// reconstructing the exact tracked candidate files from their saved Git patch.
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
const execute=promisify(execFile),output=path.resolve('verification/opencode-coding-comparison-2026-10-23'),raw=JSON.parse(await readFile(path.join(output,'results.json'),'utf8'));
const baseline={
 'python-header-contract':{'headers.py':'def normalize_headers(headers):\n    return {key.lower(): value.strip() for key, value in headers.items()}\n','tests/test_headers.py':'import unittest\nfrom headers import normalize_headers\n\nclass HeaderTests(unittest.TestCase):\n    def test_string(self):\n        self.assertEqual(normalize_headers({"X-Key": " value "}), {"x-key": "value"})\n'},
 'typed-callers-crlf':{'src/users.ts':'export interface User { id: string; name: string; }\r\nconst users: User[] = [{id:"u1",name:"누비"}];\r\nexport function lookupUser(id: string): User {\r\n  return users.find(user => user.id === id)!;\r\n}\r\n','src/display.ts':'import {lookupUser} from "./users.ts";\r\nexport function displayName(id: string): string {\r\n  return lookupUser(id).name;\r\n}\r\n','test/display.test.mjs':'import test from "node:test";\nimport assert from "node:assert/strict";\nimport {displayName} from "../src/display.ts";\ntest("existing user",()=>assert.equal(displayName("u1"),"누비"));\n'},
};
const oracles={
 'python-header-contract':String.raw`from headers import normalize_headers
source={" X-ID ":7,"X-Null":None," X-Name ":" v "}
assert normalize_headers(source)=={"x-id":7,"x-null":None,"x-name":"v"}
assert list(source)==[" X-ID ","X-Null"," X-Name "]
for invalid in [{" ":1},{4:"v"}]:
    try:
        normalize_headers(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("ValueError required")
`,
 'typed-callers-crlf':String.raw`import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lookupUser} from './src/users.ts';
import {displayName} from './src/display.ts';
assert.equal(lookupUser('missing'),undefined);
assert.equal(displayName('missing'),'알 수 없음');
assert.equal(displayName('u1'),'누비');
for(const name of ['src/users.ts','src/display.ts'])assert(!/(?<!\r)\n/.test(readFileSync(name,'utf8')),name+' keeps CRLF');
assert.match(readFileSync('src/users.ts','utf8'),/User\s*\|\s*undefined/);
`,
};
const results=[];
for(const original of raw.results){
 if(!baseline[original.case]){results.push(original);continue;}
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-coding-regrade-'));let pass=false,error;
 try{
  for(const [name,text] of Object.entries(baseline[original.case])){await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),text);}
  await execute('git',['init','-q'],{cwd:root});await execute('git',['apply',path.join(output,original.case+'-'+original.engine+'-changes.patch')],{cwd:root});
  const python=original.case==='python-header-contract',name=python?'oracle.py':'oracle.mjs';await writeFile(path.join(root,name),oracles[original.case]);
  await execute(python?'python3':'node',[name],{cwd:root,timeout:20000});pass=true;
 }catch(cause){error=String(cause.stderr||cause.message).slice(-1200);}
 finally{await rm(root,{recursive:true,force:true});}
 const grade={...original.grade,oracle:pass};results.push({...original,grade,passed:!original.error&&Object.values(grade).every(Boolean),regrade:{reason:'Initial independent oracle had invalid string/regex escaping; product outputs and original reports preserved.',artifact:'saved Git diff applied to original tracked source fixture; no model rerun',originalGrade:original.grade,originalGradeError:original.gradeError,oraclePassed:pass,error:error||null}});
}
await writeFile(path.join(output,'results-regraded.json'),JSON.stringify({...raw,results},null,2));console.log(JSON.stringify(results.map(result=>({case:result.case,engine:result.engine,grade:result.grade,error:result.error,passed:result.passed,regradeError:result.regrade?.error}))));

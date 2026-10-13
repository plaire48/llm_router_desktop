import {readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PersonalMail} from '../../runtime/mail.mjs';
const exec=promisify(execFile);
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const mailId=(testCase,index)=>hash(`easy80:${testCase.id}:${index}`);
export const dataId=testCase=>'dataset-'+hash(testCase.id).slice(0,8);
const put=async(root,name,text)=>{const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,text);};

// This executable derives results from fixture inputs. It contains no grader or
// answer key. Bash processes call it just as a small real local reporting tool.
export const REPORT_TOOL=String.raw`import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync(new URL('../data/reports.json',import.meta.url),'utf8'));
const [command,id]=process.argv.slice(2);
if(command==='catalog'){console.log(JSON.stringify(rows.map(({id,title})=>({id,title}))));process.exit(0);}
if(command!=='run'||!id){console.error('Usage: catalog | run DATASET_ID');process.exit(2);}
const row=rows.find(r=>r.id===id);if(!row){console.error('dataset_not_found');process.exit(3);}
const d=row.data;let result;
switch(row.operation){
case 'sum':result=d.reduce((a,b)=>a+b,0);break;
case 'count':result=d.filter(x=>x==='failed').length;break;
case 'max':result=d.reduce((a,b)=>a.value>b.value?a:b);break;
case 'latest':result=[...d].sort((a,b)=>b.date.localeCompare(a.date))[0];break;
case 'low':result=d.filter(x=>x.value<5);break;
case 'average':result=d.reduce((a,b)=>a+b,0)/d.length;break;
case 'missing':result=d.required.filter(x=>!d.actual.includes(x));break;
case 'duplicates':result=[...new Set(d.filter((x,i)=>d.indexOf(x)!==i))];break;
case 'minutes':result=d.reduce((a,b)=>a+b,0)/60;break;
case 'shipping':result=d.base+d.extra;break;
case 'lastSuccess':result=d.filter(x=>x.status==='success').at(-1);break;
case 'rate':result=100*d.pass/d.total;break;
case 'topCustomer':{const sums={};for(const r of d)sums[r.name]=(sums[r.name]||0)+r.value;result=Object.entries(sums).sort((a,b)=>b[1]-a[1])[0];break;}
case 'remaining':result=d.capacity-d.booked;break;
case 'versions':result=d;break;
case 'testSummary':result=d.reduce((a,b)=>({pass:a.pass+b.pass,fail:a.fail+b.fail}),{pass:0,fail:0});break;
case 'unassigned':result=d.filter(x=>!x.owner).map(x=>x.name);break;
case 'difference':result=d.actual-d.baseline;break;
case 'intersection':result=d.left.filter(x=>d.right.includes(x));break;
case 'join':result=d.orders.map(o=>({order:o.id,owner:d.users.find(u=>u.id===o.ownerId)?.name}));break;
default:console.error('operation_not_supported');process.exit(4);
}
console.log(JSON.stringify({title:row.title,result,...(row.outputUnit?{unit:row.outputUnit}:{})}));
`;

export async function prepareEasyWorkspace(testCase,workspace){
  const root=workspace.root;
  // The registered seed is ours; do not touch arbitrary user directories.
  for(const entry of await readdir(root))if(entry!=='.git')await rm(path.join(root,entry),{recursive:true,force:true});
  await put(root,'AGENTS.md','# Evaluation workspace\nRead-only questions. Do not modify files or run network commands. Use the supplied sources and preserve uncertainty.\n');
  if(testCase.category==='bash'){
    await put(root,'README.md','# Local reports\n`bash tools/report.sh catalog` lists dataset IDs and titles. Then `bash tools/report.sh run DATASET_ID` calculates the selected report. Run these separately and use the ID actually returned. Data stays local. The tool reads data/reports.json and writes only stdout.\n');
    await put(root,'package.json',JSON.stringify({name:'local-report-fixture',private:true,type:'module'}));
    await put(root,'tools/report.sh','#!/usr/bin/env bash\nset -eu\nnode tools/report.mjs "$@"\n');
    await put(root,'tools/report.mjs',REPORT_TOOL);
    await put(root,'data/reports.json',JSON.stringify([{id:'archived-data',title:'참고: 이전 연도 기록',operation:'sum',data:[1,2]}, {id:dataId(testCase),title:testCase.title,operation:testCase.operation,data:testCase.data,...(testCase.inputUnit?{inputUnit:testCase.inputUnit,outputUnit:testCase.outputUnit}:{})}],null,2));
  }else if(testCase.category==='wiki'){
    await put(root,'README.md','# Internal handbook fixture\nPolicies are maintained in openwiki/. Answer from current Wiki documents and cite them.\n');
    for(const [index,body] of testCase.pages.entries())await put(root,`openwiki/policies/${testCase.id}-${index+1}.md`,`# ${testCase.title} ${index===0?'기본 기준':'추가 기준'}\n\n${body}\n`);
    await put(root,'openwiki/index.md',`# 안내\n\n${testCase.title}은 policies/의 기본 기준과 추가 기준을 함께 확인합니다.\n`);
    await put(root,'openwiki/policies/unrelated.md','# 도서 대여\n도서 대여는 5일입니다. 담당자는 오지훈입니다.\n');
  }else if(testCase.category==='skill'){
    await put(root,'README.md','# Work aids\nProject skills live under .nubi/skill/. Choose only relevant guidance. No outgoing messages or file changes are requested.\n');
    const skills=JSON.parse(await readFile(new URL('skills.json',import.meta.url),'utf8'));
    for(const [name,[description,body]] of Object.entries(skills))await put(root,`.nubi/skill/${name}/SKILL.md`,`---\nname: ${name}\ndescription: ${description}\n---\n\n# ${description}\n\n${body}\n`);
  }else await put(root,'README.md','# Mail evaluation\nThe question concerns personal mail, not source code.\n');
  await exec('git',['add','-A','-f','.'],{cwd:root});await exec('git',['commit','-qm','Pin easy evaluation inputs'],{cwd:root});
}

export async function configureEasyService(testCase,service,workspace){
  if(testCase.category!=='mail')return;
  const root=path.join(workspace.stateRoot,'fixture-personal');await mkdir(root,{recursive:true});
  const data=new Map(),rows=[],bodies=new Map(),mail=Object.create(PersonalMail.prototype);
  Object.assign(mail,{root,wikiRoot:root,store:{get:key=>data.get(key),set:(key,value)=>data.set(key,value)},rows:()=>rows,searchSignature:async row=>row.sourceHash,source:async row=>structuredClone(bodies.get(row.id))});
  for(const [index,body] of [...testCase.mails,'다른 업무: 도서 반납 안내입니다.'].entries()){
    const id=mailId(testCase,index),date=`2026-10-${String(8+index).padStart(2,'0')}T09:00:00+09:00`,subject=index<3?`${testCase.title} ${index+1}차 안내`:'도서 반납 안내';
    const text=`# ${subject}\n\n${index<3?testCase.title+' 관련 안내가 있습니다. 최종 사실은 원문을 확인하세요.':'도서 반납 관련 안내입니다.'}`,filename=path.join(root,id+'.md');await writeFile(filename,text);
    const row={id,date,state:'saved',subject,from:'업무지원팀 <support@example.test>',path:filename,sourceHash:hash(body),wikiHash:hash(text),contentScope:'body_and_metadata'};
    rows.push(row);data.set('mail:'+id,row);bodies.set(id,{subject,from:row.from,date,text:body,attachments:[]});
  }
  service.mail=args=>mail.call(args);
}

import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,utimes} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {removeLater} from './helpers-cleanup.mjs';
import {truncateToolOutput,cleanupToolOutputs,TOOL_OUTPUT_MAX_LINES,TOOL_OUTPUT_MAX_BYTES} from '../runtime/tool-output.mjs';

const folder=async t=>{const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-tool-output-'));removeLater(dir);return dir;};

test('opencode limits: 2000 lines and 50 KiB',()=>{
 assert.equal(TOOL_OUTPUT_MAX_LINES,2000);assert.equal(TOOL_OUTPUT_MAX_BYTES,50*1024);
});

test('output within the limits passes through untouched and writes nothing',async t=>{
 const directory=await folder(t);
 const result=await truncateToolOutput('a\nb\n',{directory});
 assert.deepEqual(result,{text:'a\nb\n',truncated:false});
 assert.deepEqual(await readdir(directory),[]);
});

test('too many lines keeps the head, saves the whole output and names the file',async t=>{
 const directory=await folder(t);
 const text=Array.from({length:10},(_,i)=>'line '+(i+1)).join('\n');
 const result=await truncateToolOutput(text,{directory,maxLines:3});
 assert.equal(result.truncated,true);
 assert.match(result.outputPath,/tool_[0-9a-f]{12}/);
 assert.equal(path.dirname(result.outputPath),directory);
 assert.equal(await readFile(result.outputPath,'utf8'),text);
 assert.equal(result.text,`line 1\nline 2\nline 3\n[showing lines 1-3 of 10; full output saved to ${result.outputPath}]`);
});

test('the byte limit cuts at a whole line, counting UTF-8 bytes',async t=>{
 const directory=await folder(t);
 const text=['가나다','라마바','사아자'].join('\n'); // 9 bytes per line
 const result=await truncateToolOutput(text,{directory,maxBytes:19});
 assert.equal(result.text.split('\n').slice(0,2).join('\n'),'가나다\n라마바');
 assert.match(result.text,/\[showing lines 1-2 of 3; full output saved to /);
});

test('a single line larger than the limit shows 0 lines and still saves the output',async t=>{
 const directory=await folder(t);
 const result=await truncateToolOutput('x'.repeat(100),{directory,maxBytes:10});
 assert.match(result.text,/^\[showing 0 lines of 1; full output saved to .*\]$/);
 assert.equal((await readFile(result.outputPath,'utf8')).length,100);
});

test('cleanup removes saved outputs older than seven days and keeps everything else',async t=>{
 const directory=await folder(t);
 const old=path.join(directory,'tool_0123456789ab'),fresh=path.join(directory,'tool_ba9876543210'),other=path.join(directory,'notes.txt');
 for(const file of [old,fresh,other])await writeFile(file,'x');
 const now=Date.now(),eightDays=new Date(now-8*86400000);
 await utimes(old,eightDays,eightDays);await utimes(other,eightDays,eightDays);
 assert.equal(await cleanupToolOutputs(directory,{now}),1);
 assert.deepEqual((await readdir(directory)).sort(),['notes.txt','tool_ba9876543210']);
});

test('cleanup of a missing folder is a no-op',async()=>{
 assert.equal(await cleanupToolOutputs(path.join(os.tmpdir(),'nubi-missing-'+process.pid+'-'+Date.now())),0);
});

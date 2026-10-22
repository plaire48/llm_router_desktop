// Visual equality gate for CSS changes (plan 2a): a real pixel change is named, run-to-run noise is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import zlib from 'node:zlib';
import {compareCaptures} from '../scripts/compare-captures.mjs';
import {removeLater} from './helpers-cleanup.mjs';
function png(pixels){// minimal RGBA PNG, one row
 const crc=b=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(pixels.length,0);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=6;
 const raw=Buffer.from([0,...pixels.flat()]);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
test('a capture within noise passes and a real change is named',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-captures-'));removeLater(root);const before=path.join(root,'before'),after=path.join(root,'after');
 await mkdir(before);await mkdir(after);
 await writeFile(path.join(before,'same.png'),png([[10,10,10,255],[20,20,20,255]]));await writeFile(path.join(after,'same.png'),png([[10,10,10,255],[20,20,20,255]]));
 await writeFile(path.join(before,'diff.png'),png([[10,10,10,255],[20,20,20,255]]));await writeFile(path.join(after,'diff.png'),png([[50,10,10,255],[20,20,20,255]]));
 const result=await compareCaptures(before,after,{noise:{default:0,animated:{}}});
 assert.equal(result.compared,2);assert.deepEqual(result.changed,[{name:'diff.png',pixels:1}]);
 assert.deepEqual((await compareCaptures(before,after,{noise:{default:1,animated:{}}})).changed,[]);
});
test('a missing after-capture is a change, never a silent pass',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-captures-'));removeLater(root);const before=path.join(root,'before'),after=path.join(root,'after');
 await mkdir(before);await mkdir(after);await writeFile(path.join(before,'gone.png'),png([[1,1,1,255]]));
 assert.deepEqual((await compareCaptures(before,after,{noise:{default:0,animated:{}}})).changed,[{name:'gone.png',pixels:-1}]);
});

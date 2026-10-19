import test from 'node:test';
import assert from 'node:assert/strict';
test('message timestamps keep local full/short values and reject invalid dates',async()=>{
 const {formatMessageTime}=await import('../ui/message-time.mjs');
 for(const at of ['2026-10-19T00:00:00Z','2026-03-08T07:30:00Z']){
  const d=new Date(at);assert.deepEqual(formatMessageTime(at),{iso:d.toISOString(),full:d.toLocaleString(),short:d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})});
 }
 for(const value of ['',null,'not a date'])assert.equal(formatMessageTime(value),null);
});
test('500 message timestamps share two locale formatters',async()=>{
 const original=Intl.DateTimeFormat;let created=0;
 Intl.DateTimeFormat=function(...args){created++;return new original(...args);};
 try{const {formatMessageTime}=await import('../ui/message-time.mjs?allocation-check');for(let i=0;i<500;i++)formatMessageTime(new Date(1700000000000+i*1000).toISOString());assert.equal(created,2);}finally{Intl.DateTimeFormat=original;}
});
test('repeated timestamp renders reuse formatted values instead of formatting the same instant500 times',async()=>{
 const original=Intl.DateTimeFormat;let calls=0;
 Intl.DateTimeFormat=function(...args){const formatter=new original(...args);return {format(value){calls++;return formatter.format(value);}};};
 try{const {formatMessageTime}=await import('../ui/message-time.mjs?repeated-render');let first;for(let i=0;i<500;i++){const value=formatMessageTime('2026-10-19T00:00:00Z');first??=value;assert.deepEqual(value,first);}assert.equal(calls,2,'one full and one short format for an unchanged timestamp');}finally{Intl.DateTimeFormat=original;}
});

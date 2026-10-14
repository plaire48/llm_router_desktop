import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeCapture} from '../runtime/capture-analysis.mjs';
import {modelTransport} from '../runtime/recovery.mjs';
import {captureImage} from '../electron-app/capture-image.cjs';
const status={connected:true,provider:'aipro',model:'GLM-5.2',models:[{id:'GLM-5.2',supportsImages:false},{id:'QWEN3.8-27B-FP8-256K',supportsImages:true}]};
const shot={image:'aGVsbG8=',width:300,height:200,clip:{x:10,y:20,width:300,height:200}};
test('GLM sees image findings then continues with its original model, including after vision errors',async()=>{
 const calls=[];let fail=false;
 const service={providers:{status:()=>structuredClone(status),complete:async(messages,tools,signal,_text,_retry,_activity,options)=>{calls.push({model:options?.visionModel||status.model,messages,tools});if(fail)throw Error('vision_failed');return {content:'검색 결과가 보입니다.',calls:[]};}}};
 const invoke=modelTransport(service,{signal:new AbortController().signal});
 const result=await analyzeCapture({status,shot,question:'결과가 보이나요?',invoke});
 await invoke([{role:'user',content:result.analysis}],[]);
 assert.deepEqual(calls.map(row=>row.model),['QWEN3.8-27B-FP8-256K','GLM-5.2']);assert.equal(status.model,'GLM-5.2');assert.equal(calls[0].tools.length,0);assert.equal(calls[0].messages[1].content[1].type,'image_url');assert.equal(typeof calls[1].messages[0].content,'string');
 fail=true;await assert.rejects(analyzeCapture({status,shot,invoke:async()=>{throw Error('vision_failed');}}),/vision_failed/);assert.equal(status.model,'GLM-5.2');
});
test('no available vision model and cancelled calls never send the image',async()=>{
 let called=0;const invoke=()=>{called++;};
 assert.equal((await analyzeCapture({status:{...status,models:[status.models[0]]},shot,invoke})).error,'vision_model_unavailable');
 const controller=new AbortController();controller.abort();await assert.rejects(analyzeCapture({status,shot,invoke,signal:controller.signal}),{name:'AbortError'});assert.equal(called,0);
});
test('crop accounts for DPI before output resize and rejects out-of-bounds regions',()=>{
 const operations=[];const image={size:{width:1800,height:1200},getSize(){return this.size;},crop(rect){operations.push(rect);this.size={width:rect.width,height:rect.height};return this;},resize({width}){this.size={width,height:this.size.height*width/this.size.width};return this;},toPNG(){return Buffer.from('png');}};
 const result=captureImage(image,{clip:{x:100,y:50,width:400,height:200},maxWidth:200},{width:900,height:600});
 assert.deepEqual(operations,[{x:200,y:100,width:800,height:400}]);assert.equal(result.width,200);assert.equal(result.height,100);
 assert.throws(()=>captureImage(image,{clip:{x:10,y:0,width:1000,height:10}},{width:900,height:600}),/capture_region_invalid/);
 assert.throws(()=>captureImage(image,{maxWidth:100000}),/capture_size_invalid/);
});

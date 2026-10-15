import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {captureSurface}=createRequire(import.meta.url)('../electron-app/capture-image.cjs');
function contents(capturePage){let throttle=true;const changes=[];return {capturePage,isDestroyed:()=>false,getBackgroundThrottling:()=>throttle,setBackgroundThrottling:value=>{throttle=value;changes.push(value);},changes};}
test('capture briefly allows painting after a missing compositor surface and restores throttling',async()=>{
 let calls=0;const image={};const wc=contents(async()=>{if(++calls===1)throw Error('Current display surface not available for capture');return image;});
 assert.equal(await captureSurface(wc),image);assert.equal(calls,2);assert.deepEqual(wc.changes,[false,true]);
});
test('capture stops after bounded missing-surface attempts and restores throttling',async()=>{
 let calls=0;const wc=contents(async()=>{calls++;throw Error('Current display surface not available for capture');});
 await assert.rejects(captureSurface(wc),/browser_capture_unavailable/);assert.equal(calls,4);assert.deepEqual(wc.changes,[false,true]);
});
test('capture does not retry arbitrary errors or change normal rendering settings',async()=>{
 const wc=contents(async()=>{throw Error('different failure');});await assert.rejects(captureSurface(wc),/different failure/);assert.deepEqual(wc.changes,[]);
 const normal=contents(async()=>({image:true}));assert.deepEqual(await captureSurface(normal),{image:true});assert.deepEqual(normal.changes,[]);
});

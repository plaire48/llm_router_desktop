import test from 'node:test';
import assert from 'node:assert/strict';
import {HIDDEN_CAPTION,openingCaptionOptions,OpeningCaption} from '../electron-app/opening-caption.cjs';

function nativeWindow(){
 const state={...openingCaptionOptions('win32'),destroyed:false},calls=[];
 const window={isDestroyed:()=>state.destroyed,setTitleBarOverlay:value=>{state.titleBarOverlay=value;calls.push(['overlay',value]);}};
 for(const property of ['minimizable','maximizable','closable'])window['set'+property[0].toUpperCase()+property.slice(1)]=value=>{state[property]=value;calls.push([property,value]);};
 return {window,state,calls};
}
test('Windows starts without visible or clickable caption buttons before renderer paint',()=>{
 const options=openingCaptionOptions('win32');
 assert.equal(options.titleBarOverlay.color,'#00000000');assert.equal(options.titleBarOverlay.symbolColor,'#00000000');
 for(const property of ['minimizable','maximizable','closable'])assert.equal(options[property],false);
 assert.deepEqual(openingCaptionOptions('darwin'),{});assert.deepEqual(openingCaptionOptions('linux'),{});
});
test('startup theme updates cannot reveal controls; completion restores the latest theme and normal actions',()=>{
 const {window,state,calls}=nativeWindow(),caption=new OpeningCaption(window,'win32');
 caption.appearance({color:'#f7fafe',symbolColor:'#4e5968'});
 assert.deepEqual(calls,[]);assert.deepEqual(state.titleBarOverlay,HIDDEN_CAPTION);
 caption.opening(false);
 for(const property of ['minimizable','maximizable','closable'])assert.equal(state[property],true);
 assert.deepEqual(state.titleBarOverlay,{color:'#f7fafe',symbolColor:'#4e5968',height:48});
 const count=calls.length;caption.opening(false);assert.equal(calls.length,count);
});
test('reload hides controls again and failure recovery can restore them without a renderer',()=>{
 const {window,state}=nativeWindow(),caption=new OpeningCaption(window,'win32');
 caption.opening(false);caption.opening(true);caption.appearance({color:'#ffffff',symbolColor:'#191f28'});
 assert.equal(state.closable,false);assert.deepEqual(state.titleBarOverlay,HIDDEN_CAPTION);
 caption.opening(false);assert.equal(state.closable,true);assert.equal(state.titleBarOverlay.symbolColor,'#191f28');
});
test('invalid renderer payloads and destroyed windows cannot change caption state',()=>{
 const {window,state,calls}=nativeWindow(),caption=new OpeningCaption(window,'win32');
 for(const value of [undefined,null,0,'false',{}])assert.throws(()=>caption.opening(value),/opening_scene_invalid/);
 assert.throws(()=>caption.appearance({color:'transparent',symbolColor:'#191f28'}),/titlebar_color_invalid/);
 state.destroyed=true;caption.opening(false);assert.deepEqual(calls,[]);
});
test('the Windows opening controller leaves macOS traffic lights and Linux behavior alone',()=>{
 for(const platform of ['darwin','linux']){
  const {window,calls}=nativeWindow(),caption=new OpeningCaption(window,platform);
  caption.opening(true);caption.opening(false);assert.deepEqual(calls,[]);
 }
});

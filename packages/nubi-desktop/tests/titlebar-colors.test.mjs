import test from 'node:test';
import assert from 'node:assert/strict';
import {captionColors,applyCaptionColors,surfaceColor,DEFAULT_TITLEBAR} from '../electron-app/titlebar-colors.cjs';

test('native caption follows the same scrim and restores after the last dialog closes',()=>{
 const base=captionColors('rgb(241, 247, 254)','#4E5968');
 const one=captionColors('rgb(241, 247, 254)','#4E5968',['rgba(23, 32, 51, 0.22)']);
 const two=captionColors('rgb(241, 247, 254)','#4E5968',['rgba(23, 32, 51, 0.22)','rgba(23, 32, 51, 0.22)']);
 assert.deepEqual(base,{color:'#f1f7fe',symbolColor:'#4e5968'});
 assert.deepEqual(one,{color:'#c1c8d1',symbolColor:'#424c5c'});
 assert.notEqual(two.color,one.color);
 assert.deepEqual(captionColors('rgb(241, 247, 254)','#4E5968',[]),base);
 assert.deepEqual(captionColors('rgb(241, 247, 254)','#4E5968',['transparent']),base);
});
test('caption colors use the current theme instead of a hardcoded modal shade',()=>{
 assert.deepEqual(captionColors('rgb(255, 255, 255)','#000000',['rgba(0, 0, 0, 0.5)']),{color:'#808080',symbolColor:'#000000'});
});
test('actual CX color-mix serialization dims the caption instead of using the fallback',()=>{
 const background='color(srgb 0.967059 0.981176 0.997647)',overlay='color(srgb 0.0980392 0.121569 0.156863 / 0.2)';
 assert.deepEqual(captionColors(background,'#4E5968'),{color:'#f7fafe',symbolColor:'#4e5968'});
 // Green: (0.981176 * 0.8 + 0.121569 * 0.2) * 255 = 206.4398.
 assert.deepEqual(captionColors(background,'#4E5968',[overlay]),{color:'#caced4',symbolColor:'#434d5b'});
});
test('native updates preserve caption height and reject non-color payloads',()=>{
 const calls=[],window={isDestroyed:()=>false,setTitleBarOverlay:value=>calls.push(value)};
 applyCaptionColors(window,{color:'#c1c8d1',symbolColor:'#424c5c',height:0},'win32');
 assert.deepEqual(calls,[{color:'#c1c8d1',symbolColor:'#424c5c',height:48}]);
 for(const value of [null,{}, {color:'transparent',symbolColor:'#424c5c'}, {color:'#fff',symbolColor:'#424c5c'}])assert.throws(()=>applyCaptionColors(window,value,'win32'),/titlebar_color_invalid/);
 applyCaptionColors(window,DEFAULT_TITLEBAR,'darwin');
 applyCaptionColors({...window,isDestroyed:()=>true},DEFAULT_TITLEBAR,'win32');
 assert.equal(calls.length,1);
});

// A glass toolbar paints with a gradient over a transparent background colour (2026-10-23): the native caption takes the
// nearest opaque surface under it with the gradient's right end on top, never black.
test('a transparent toolbar takes the opaque surface below it and the right end of its gradient',()=>{
 assert.equal(surfaceColor(['rgb(250, 252, 255)','rgba(0, 0, 0, 0)']),'#fafcff');
 assert.equal(surfaceColor(['rgb(250, 252, 255)','rgba(0, 0, 0, 0)'],'linear-gradient(145deg, color(srgb 1 1 1 / 0.78), color(srgb 0 0 1 / 0.5))'),'#7d7eff');
 assert.equal(surfaceColor(['rgba(0, 0, 0, 0)']),'#fafcff','no opaque surface falls back to the default caption');
});

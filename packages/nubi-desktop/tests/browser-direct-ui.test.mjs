import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
test('browser connection surface exposes tab choice and permission wait without extension installation instructions',async t=>{
 const parent=new URL('../generated/',import.meta.url).pathname;await mkdir(parent,{recursive:true});const dir=await mkdtemp(path.join(parent,'direct-ui-'));t.after(()=>rm(dir,{recursive:true,force:true}));const output=path.join(dir,'pane.mjs');
 await build({entryPoints:[new URL('../electron-app/ExternalBrowserPane.jsx',import.meta.url).pathname],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'},});
 globalThis.window={nubi:{platform:'darwin'}};t.after(()=>delete globalThis.window);
 const {ExternalBrowserPane}=await import(pathToFileURL(output));const html=renderToStaticMarkup(React.createElement(ExternalBrowserPane,{visible:true,api:()=>{},onUpdate(){},status:{connected:false,connectionPhase:'choose_tab',candidates:[{id:'one',title:'업무 페이지',origin:'https://work.test'}]}}));
 assert.match(html,/업무 페이지/);assert.doesNotMatch(html,/연결 확장 폴더|개발자 모드|확장을.*설치/);
});

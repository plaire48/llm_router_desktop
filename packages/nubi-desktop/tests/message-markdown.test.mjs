import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const dir=await mkdtemp(path.join(tmpdir(),'nubi-markdown-'));
const result=await build({stdin:{contents:`import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import rehypeRaw from'../../extensions/aipro-chat/node_modules/rehype-raw/index.js';import{MessageBody,markdownHtmlPlugins}from'../../extensions/aipro-chat/src/MessageBody.jsx';export{markdownHtmlPlugins,rehypeRaw};export const render=content=>renderToStaticMarkup(React.createElement(MessageBody,{content,role:'assistant'}));`,resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},write:false,external:['node:*'],loader:{'.css':'empty'},nodePaths:[path.resolve('node_modules')],alias:{react:path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom')}});
await writeFile(path.join(dir,'render.mjs'),result.outputFiles[0].text);
const {markdownHtmlPlugins,rehypeRaw,render}=await import(pathToFileURL(path.join(dir,'render.mjs')).href);
test.after(()=>rm(dir,{recursive:true,force:true}));
test('plain Markdown skips the HTML parser while retaining sanitization',()=>{
 assert.equal(typeof markdownHtmlPlugins,'function');
 const plugins=markdownHtmlPlugins('**요약**\n\n| 항목 | 값 |\n|---|---|\n| 결과 | 완료 |');
 assert.ok(!plugins.includes(rehypeRaw));assert.ok(plugins.length>0);
 const html=render('**요약**\n\n| 항목 | 값 |\n|---|---|\n| 결과 | 완료 |');
 assert.match(html,/<strong>요약<\/strong>/);assert.match(html,/<td>완료<\/td>/);
});
test('HTML and autolinks retain parsing and unsafe content remains stripped',()=>{
 assert.ok(markdownHtmlPlugins('<details open><summary>정보</summary>본문</details>').includes(rehypeRaw));
 const html=render('<details open><summary>정보</summary>본문<script>alert(1)</script></details>\n\n<a href="javascript:alert(1)" onclick="bad()">링크</a>');
 assert.match(html,/<details open="">/);assert.match(html,/<summary>정보<\/summary>/);
 assert.doesNotMatch(html,/script|onclick|javascript:|alert\(1\)/);
 assert.match(render('<https://example.invalid>'),/href="https:\/\/example.invalid"/);
});
test('escaped HTML remains literal and reveal processing is retained',()=>{
 assert.doesNotMatch(render('&lt;script&gt;내용&lt;/script&gt;'),/<script>/);
 assert.equal(markdownHtmlPlugins('본문',true).length,markdownHtmlPlugins('본문').length+1);
});

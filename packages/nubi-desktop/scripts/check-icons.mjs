// Every icon name the desktop UI passes to <Icon name=…> must exist in the design system; an unknown name throws at
// render time and blanks the whole screen (user reports 2026-10-14: 'Unknown icon: folder', 'Unknown icon: terminal').
import {build} from 'esbuild';
import {readdirSync,statSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const SKIP=new Set(['node_modules','lib','dist','ai-workspace','verification']);
function files(dir){const out=[];for(const name of readdirSync(dir)){if(SKIP.has(name)||name.startsWith('.'))continue;const full=path.join(dir,name);if(statSync(full).isDirectory())out.push(...files(full));else if(/\.(jsx|js|mjs)$/.test(name))out.push(full);}return out;}
const used=new Map();
for(const file of ['ui','electron-app'].flatMap(files)){
  const text=readFileSync(file,'utf8');
  for(const match of text.matchAll(/<Icon\b[^>]*?\bname=(?:"([^"]+)"|'([^']+)'|\{'([^']+)'\}|\{"([^"]+)"\})/g)){const name=match[1]||match[2]||match[3]||match[4];if(!used.has(name))used.set(name,file);}
  // Conditional names: name={cond?'a':'b'} — collect every quoted word inside the braces.
  for(const match of text.matchAll(/<Icon\b[^>]*?\bname=\{([^}]*)\}/g)){// Comparison operands (state==='running') are not icon names.
  for(const word of match[1].replace(/[!=]==?\s*(?:'[A-Za-z]+'|"[A-Za-z]+")/g,'').matchAll(/'([A-Za-z]+)'|"([A-Za-z]+)"/g)){const name=word[1]||word[2];if(!used.has(name))used.set(name,file);}}
}
const dir=path.resolve('verification/icons');mkdirSync(dir,{recursive:true});
writeFileSync(path.join(dir,'probe.jsx'),`import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Icon} from '@e2e/cx-design-system';
const names=${JSON.stringify([...used.keys()])};const missing=[];
for(const name of names){try{renderToStaticMarkup(<Icon name={name} size={16}/>);}catch(error){missing.push(name+' ('+String(error.message).slice(0,60)+')');}}
console.log(JSON.stringify(missing));`);
const result=await build({entryPoints:[path.join(dir,'probe.jsx')],bundle:true,write:false,platform:'node',format:'esm',external:['react','react-dom','react-dom/server'],loader:{'.jsx':'jsx','.css':'empty','.png':'dataurl'},jsx:'automatic',nodePaths:[path.resolve('node_modules')],logLevel:'silent'});
writeFileSync(path.join(dir,'probe.bundle.mjs'),result.outputFiles[0].text);
const {execFileSync}=await import('node:child_process');
const missing=JSON.parse(execFileSync(process.execPath,[path.join(dir,'probe.bundle.mjs')],{encoding:'utf8'}).trim().split('\n').pop());
if(missing.length){for(const item of missing){const name=item.split(' ')[0];console.log(`${used.get(name)}: ${item}`);}console.log(`없는 아이콘 ${missing.length}개`);process.exit(1);}
console.log(`아이콘 ${used.size}개 모두 있음`);

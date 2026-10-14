// Finds block-scoped variables used before their declaration ("Cannot access … before initialization" at run time).
// The TypeScript checker reports this as TS2448/TS2454 even for plain JS; every other diagnostic is ignored.
// Usage: node scripts/check-tdz.mjs [dir …]   (default: ui electron-app runtime)
import ts from 'typescript';
import {readdirSync,statSync} from 'node:fs';
import path from 'node:path';
const roots=process.argv.slice(2).length?process.argv.slice(2):['ui','electron-app','runtime'];
const SKIP=new Set(['node_modules','lib','dist','ai-workspace','verification']);
function files(dir){const out=[];for(const name of readdirSync(dir)){if(SKIP.has(name)||name.startsWith('.'))continue;const full=path.join(dir,name);const st=statSync(full);if(st.isDirectory())out.push(...files(full));else if(/\.(jsx|mjs|cjs|js|ts|tsx)$/.test(name)&&!/\.test\./.test(name))out.push(full);}return out;}
const list=roots.flatMap(files);
const program=ts.createProgram(list,{allowJs:true,checkJs:true,noEmit:true,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,noResolve:true,skipLibCheck:true,types:[]});
const wanted=new Set([2448,2454]);let count=0;
for(const file of list){
  const source=program.getSourceFile(file);if(!source)continue;
  for(const d of program.getSemanticDiagnostics(source)){
    if(!wanted.has(d.code)||!d.file)continue;
    const {line,character}=d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`${file}:${line+1}:${character+1} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText,' ')}`);count++;
  }
}
console.log(count?`초기화 전 접근 ${count}건`:`초기화 전 접근 없음 (${list.length}개 파일)`);
process.exit(count?1:0);

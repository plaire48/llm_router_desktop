import path from 'node:path';
import ts from 'typescript';
import {parse as parseJSON,printParseErrorCode} from 'jsonc-parser';
import {parseDocument} from 'yaml';
import {analyzeRepository} from './wiki-code-map-core.mjs';

export const codeLanguage=file=>/\.[cm]?[jt]sx?$/i.test(file)?'typescript':/\.jsonc?$/i.test(file)?'json':/\.ya?ml$/i.test(file)?'yaml':null;
const position=(text,offset)=>{const lines=text.slice(0,offset).split('\n');return {line:lines.length,column:lines.at(-1).length+1};};
const trim=value=>String(value).slice(0,300);
function sourceFile(file,content){return ts.createSourceFile(file,content,ts.ScriptTarget.Latest,true);}
function syntax(file,content){
  const language=codeLanguage(file);let diagnostics=[];
  if(language==='typescript'){
    const source=sourceFile(file,content);
    // A closed, in-memory host. No project config, imports, plugins or code run.
    const host={getSourceFile:name=>name===file?source:undefined,getDefaultLibFileName:()=>'',writeFile(){},getCurrentDirectory:()=>'',getDirectories:()=>[],fileExists:name=>name===file,readFile:name=>name===file?content:undefined,getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
    const program=ts.createProgram([file],{noResolve:true,noLib:true,noEmit:true,allowJs:true,checkJs:true,target:ts.ScriptTarget.Latest,jsx:ts.JsxEmit.Preserve},host);
    diagnostics=program.getSyntacticDiagnostics(source).map(d=>({code:'TS'+d.code,message:trim(ts.flattenDiagnosticMessageText(d.messageText,' ')),...position(content,d.start||0)}));
  }else if(language==='json'){
    const errors=[],comments=/\.jsonc$/i.test(file)||/^tsconfig(?:\.[^.]+)*\.json$/i.test(path.basename(file));
    parseJSON(content,errors,{disallowComments:!comments,allowTrailingComma:comments,allowEmptyContent:false});
    diagnostics=errors.map(d=>({code:printParseErrorCode(d.error),message:printParseErrorCode(d.error),...position(content,d.offset)}));
  }else if(language==='yaml'){
    const parsed=parseDocument(content,{uniqueKeys:true,strict:true});
    diagnostics=parsed.errors.map(d=>({code:d.code,message:trim(d.message.split('\n')[0]),...position(content,d.pos?.[0]||0)}));
  }
  return {engine:language==='typescript'?'typescript@'+ts.version:language==='json'?'jsonc-parser@3.3.1':language==='yaml'?'yaml@2.9.0':null,supported:!!language,diagnostics:diagnostics.slice(0,30),errorCount:diagnostics.length,truncated:diagnostics.length>30,scope:'syntax_only'};
}
function outline(file,content){
  if(codeLanguage(file)!=='typescript')return {supported:false,symbols:[],imports:[],truncated:false};
  const source=sourceFile(file,content),symbols=[],imports=[];let visited=0,truncated=false;
  const visit=node=>{
    if(++visited>30000){truncated=true;return;}
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
      if(node.moduleSpecifier&&imports.length<50)imports.push({module:trim(node.moduleSpecifier.text),...position(content,node.getStart(source))});
      else if(imports.length>=50)truncated=true;
    }
    let name,kind;
    if(ts.isFunctionDeclaration(node)){name=node.name?.getText(source)||'default';kind='function';}
    else if(ts.isClassDeclaration(node)){name=node.name?.getText(source)||'default';kind='class';}
    else if(ts.isMethodDeclaration(node)){name=node.name.getText(source);kind='method';}
    else if(ts.isInterfaceDeclaration(node)){name=node.name.text;kind='interface';}
    else if(ts.isTypeAliasDeclaration(node)){name=node.name.text;kind='type';}
    else if(ts.isEnumDeclaration(node)){name=node.name.text;kind='enum';}
    else if(ts.isVariableDeclaration(node)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer))){name=node.name.getText(source);kind='function';}
    if(name){if(symbols.length>=100){truncated=true;return;}symbols.push({name:trim(name),kind,start:position(content,node.getStart(source)).line,end:position(content,Math.max(node.getStart(source),node.end-1)).line});}
    if(visited<30000)ts.forEachChild(node,visit);
  };
  visit(source);return {supported:true,symbols,imports,truncated,scope:'file_syntax_structure_only'};
}
function intelligence(input){
  const files=new Map(input.files.map(file=>['/'+file.path,file.content]));
  const options={noResolve:false,noLib:true,noEmit:true,allowJs:true,checkJs:true,strict:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.Preserve};
  const host={getSourceFile:name=>files.has(name)?sourceFile(name,files.get(name)):undefined,getDefaultLibFileName:()=>'',writeFile(){},getCurrentDirectory:()=> '/',getDirectories:()=>[],directoryExists:directory=>[...files.keys()].some(name=>name.startsWith(directory.replace(/\/$/,'')+'/')),fileExists:name=>files.has(name),readFile:name=>files.get(name),getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n'};
  const program=ts.createProgram([...files.keys()],options,host),source=program.getSourceFile('/'+input.path),checker=program.getTypeChecker();
  const diagnostics=[...program.getSyntacticDiagnostics(source),...program.getSemanticDiagnostics(source)];
  const unresolvedImports=program.getSemanticDiagnostics().filter(d=>[2307,2792,7016].includes(d.code)).length;
  if(input.operation==='diagnostics')return {engine:'typescript@'+ts.version,scope:'admitted_source_snapshot',diagnostics:diagnostics.slice(0,50).map(d=>({path:d.file?.fileName.slice(1)||input.path,code:'TS'+d.code,message:trim(ts.flattenDiagnosticMessageText(d.messageText,' ')),...position(d.file?.text||'',d.start||0)})),errorCount:diagnostics.length,unresolvedImports,truncated:diagnostics.length>50};
  const starts=source.getLineStarts();if(input.line>starts.length)return {error:'code_position_invalid'};
  const offset=starts[input.line-1]+input.column-1;
  if(offset>=source.end||offset>=(starts[input.line]??source.end))return {error:'code_position_invalid'};
  let token=source;const visit=node=>{if(node.getStart(source)<=offset&&node.end>offset){token=node;ts.forEachChild(node,visit);}};visit(source);
  const resolve=node=>{let symbol=checker.getSymbolAtLocation(node);if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);return symbol;};
  const symbol=resolve(token),locations=[];
  const add=node=>{const owner=node.getSourceFile();if(!files.has(owner.fileName)||locations.length>=80)return;locations.push({path:owner.fileName.slice(1),...position(owner.text,node.getStart(owner)),endLine:position(owner.text,node.end).line});};
  if(symbol&&input.operation==='definition')for(const node of symbol.declarations||[])add(node.name||node);
  else if(symbol)for(const owner of program.getSourceFiles()){
    const scan=node=>{if(ts.isIdentifier(node)&&resolve(node)===symbol)add(node);if(locations.length<80)ts.forEachChild(node,scan);};scan(owner);
  }
  return {engine:'typescript@'+ts.version,scope:'admitted_source_snapshot',locations,unresolvedImports,truncated:locations.length>=80};
}
// Type errors an edit introduces, as opencode reports language-server diagnostics after an edit (packages/opencode edit
// tool, MAX_DIAGNOSTICS_PER_FILE 20). The edited file is checked before and after with the TypeScript standard library
// and the project files it imports; an error counts as existing when the same code and message were there before.
export const TYPE_DIAGNOSTICS_LIMIT=20;
const slash=value=>String(value).replaceAll('\\','/');
function types(input){
  const options={noEmit:true,allowJs:true,checkJs:true,strict:true,skipLibCheck:true,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.Preserve,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts']};
  const libDirectory=slash(path.dirname(ts.getDefaultLibFilePath(options))),isLib=name=>slash(name).startsWith(libDirectory+'/');
  const libs=new Map();
  const check=content=>{
    const files=new Map(input.files.map(file=>['/'+file.path,file.content]));files.set('/'+input.path,content);
    const host={
      getSourceFile:name=>{
        if(files.has(name))return sourceFile(name,files.get(name));
        if(!isLib(name))return undefined;
        if(!libs.has(name)){const text=ts.sys.readFile(name);libs.set(name,text===undefined?undefined:sourceFile(name,text));}
        return libs.get(name);
      },
      getDefaultLibFileName:value=>ts.getDefaultLibFilePath(value),getDefaultLibLocation:()=>libDirectory,writeFile(){},getCurrentDirectory:()=>'/',getDirectories:()=>[],
      directoryExists:directory=>isLib(directory+'/x')||[...files.keys()].some(name=>name.startsWith(directory.replace(/\/$/,'')+'/')),
      fileExists:name=>files.has(name)||isLib(name)&&ts.sys.fileExists(name),readFile:name=>files.get(name)??(isLib(name)?ts.sys.readFile(name):undefined),
      getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=>'\n'};
    const program=ts.createProgram(['/'+input.path],options,host),source=program.getSourceFile('/'+input.path);
    return [...program.getSyntacticDiagnostics(source),...program.getSemanticDiagnostics(source)].filter(d=>d.category===ts.DiagnosticCategory.Error)
      .map(d=>({code:'TS'+d.code,message:trim(ts.flattenDiagnosticMessageText(d.messageText,' ')),...position(content,d.start||0)}));
  };
  const before=check(input.before),after=check(input.after),remaining=new Map();
  for(const d of before)remaining.set(d.code+'\n'+d.message,(remaining.get(d.code+'\n'+d.message)||0)+1);
  const introduced=[];let existingCount=0;
  for(const d of after){const key=d.code+'\n'+d.message,left=remaining.get(key)||0;if(left){remaining.set(key,left-1);existingCount++;}else introduced.push(d);}
  return {engine:'typescript@'+ts.version,state:'checked',introduced:introduced.slice(0,TYPE_DIAGNOSTICS_LIMIT),introducedCount:introduced.length,existingCount,truncated:introduced.length>TYPE_DIAGNOSTICS_LIMIT};
}
export function analyzeCode(input){
  if(input.mode==='types')return types(input);
  if(input.mode==='intelligence')return intelligence(input);
  if(input.mode==='repository')return analyzeRepository(input);
  if(input.mode==='outline')return outline(input.path,input.content);
  return {before:syntax(input.path,input.before),after:syntax(input.path,input.after)};
}

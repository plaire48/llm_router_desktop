import ts from 'typescript';

// Runs in the existing bounded analysis worker. The compiler sees only host-
// admitted text; it never loads tsconfig, packages, plugins or the filesystem.
export function analyzeRepository({files}) {
  const texts=new Map(files.map(file=>['/'+file.path,file])),sources=new Map();
  const options={allowJs:true,checkJs:true,noLib:true,noEmit:true,noResolve:false,jsx:ts.JsxEmit.Preserve,target:ts.ScriptTarget.Latest,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Node10};
  function resolve(module,from){
    if(!module.startsWith('.'))return undefined;
    return ts.resolveModuleName(module,from,options,host).resolvedModule;
  }
  const host={getSourceFile(name){if(!texts.has(name))return undefined;if(!sources.has(name))sources.set(name,ts.createSourceFile(name,texts.get(name).content,ts.ScriptTarget.Latest,true));return sources.get(name);},
    getDefaultLibFileName:()=>'',writeFile(){},getCurrentDirectory:()=> '/',getDirectories:()=>[],fileExists:name=>texts.has(name),readFile:name=>texts.get(name)?.content,
    getCanonicalFileName:name=>name,useCaseSensitiveFileNames:()=>true,getNewLine:()=> '\n',
    resolveModuleNames:(names,from)=>names.map(name=>resolve(name,from))};
  const program=ts.createProgram([...texts.keys()],options,host),checker=program.getTypeChecker();
  const symbols=[],edges=[],unresolved=[],declarations=new Map();let truncated=false;
  const line=(source,node)=>source.getLineAndCharacterOfPosition(node.getStart(source)).line+1;
  const nameOf=node=>node.name&&(ts.isIdentifier(node.name)||ts.isStringLiteral(node.name))?node.name.text:undefined;
  const rows=files.map(file=>({path:file.path,hash:file.hash,syntaxErrors:program.getSyntacticDiagnostics(program.getSourceFile('/'+file.path)).length}));
  const valid=new Set(rows.filter(row=>row.syntaxErrors===0).map(row=>'/'+row.path));
  function walk(source,fn){let count=0;const visit=node=>{if(++count>100000){truncated=true;return;}fn(node);if(count<=100000)ts.forEachChild(node,visit);};visit(source);}
  for(const source of program.getSourceFiles()){
    if(!valid.has(source.fileName))continue;
    walk(source,node=>{
      let kind;
      if(ts.isFunctionDeclaration(node)||ts.isVariableDeclaration(node)&&node.initializer&&(ts.isArrowFunction(node.initializer)||ts.isFunctionExpression(node.initializer)))kind='function';
      else if(ts.isClassDeclaration(node))kind='class';
      else if(ts.isMethodDeclaration(node))kind='method';
      else if(ts.isInterfaceDeclaration(node))kind='interface';
      else if(ts.isTypeAliasDeclaration(node))kind='type';
      else if(ts.isEnumDeclaration(node))kind='enum';
      else if(ts.isVariableDeclaration(node)&&ts.isVariableDeclarationList(node.parent)&&ts.isVariableStatement(node.parent.parent)&&ts.isSourceFile(node.parent.parent.parent))kind=node.parent.flags&ts.NodeFlags.Const?'constant':'variable';
      if(!kind)return;
      const name=nameOf(node);if(!name)return;
      if(symbols.length>=4000){truncated=true;return;}
      const file=source.fileName.slice(1),start=line(source,node),end=source.getLineAndCharacterOfPosition(node.end-1).line+1;
      const symbol={id:file+':'+start+':'+node.pos,name:name.slice(0,160),kind,path:file,start,end};
      symbols.push(symbol);declarations.set(node,symbol);
    });
  }
  for(const source of program.getSourceFiles()){
    if(!valid.has(source.fileName))continue;
    walk(source,node=>{
      if(edges.length>=8000){truncated=true;return;}
      if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)||ts.isImportEqualsDeclaration(node)){
        const specifier=node.moduleSpecifier??node.moduleReference?.expression;
        if(!specifier||!ts.isStringLiteral(specifier))return;
        const target=resolve(specifier.text,source.fileName),row={kind:ts.isExportDeclaration(node)?'reexport':'import',path:source.fileName.slice(1),line:line(source,node)};
        if(target)edges.push({...row,target:target.resolvedFileName.slice(1)});
        else if(unresolved.length<400)unresolved.push({...row,reason:specifier.text.startsWith('.')?'outside_admitted_map':'external_or_alias'});
        else truncated=true;
      }
      if(!ts.isCallExpression(node)&&!ts.isNewExpression(node))return;
      let symbol=checker.getSymbolAtLocation(node.expression);
      if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
      // Each edge is a statically resolved symbol reference, never proof of
      // an executed path. Dynamic dispatch, require and unresolved aliases stay unknown.
      const targets=(symbol?.declarations??[]).map(decl=>declarations.get(decl)).filter(decl=>decl&&['function','method',...(ts.isNewExpression(node)?['class']:[])].includes(decl.kind));
      if(targets.length!==1){if(unresolved.length<400)unresolved.push({kind:'call',path:source.fileName.slice(1),line:line(source,node),reason:'dynamic_or_unresolved'});else truncated=true;return;}
      let owner=node.parent;while(owner&&!declarations.has(owner))owner=owner.parent;
      edges.push({kind:ts.isNewExpression(node)?'construct':'call',path:source.fileName.slice(1),line:line(source,node),...(owner?{owner:declarations.get(owner).id}:{}),target:targets[0].path,symbol:targets[0].id});
    });
  }
  return {engine:'typescript@'+ts.version,scope:'static_symbols_and_references',files:rows,symbols,edges,unresolved,truncated};
}

const test=require('node:test'),assert=require('node:assert/strict');
const {readdirSync,readFileSync}=require('node:fs'),path=require('node:path');
const {Host}=require('../src/host.cjs');
// VOC stays off the screen. Personal mail is enabled in the main product by the parity request (2026-10-01).
const OFF=new Set(['importVoc','queryVoc','readVoc']);
// The host opens VS Code's own pickers for these and passes only what the user picked.
const PICKERS=new Set(['chooseSkillPackage','chooseComputerApp']);

// Until 2026-10-01 the shared screen called collaboration, analysisHistory, setShellPreference and wikiUpdate, which
// this host refused, so the main product showed errors that the desktop host did not.
test('every runtime call of the shared screen reaches the runtime through this host, except those kept off on purpose',async()=>{
  const ui=path.resolve(__dirname,'../../nubi-desktop/ui'),called=new Set();
  for(const file of readdirSync(ui).filter(name=>/\.(jsx|js|mjs)$/.test(name)))
    for(const [,method] of readFileSync(path.join(ui,file),'utf8').matchAll(/\bapi\(\s*['"]([A-Za-z]+)['"]/g))called.add(method);
  assert(called.has('collaboration')&&called.has('state'),'The scan finds the calls of the shared screen');
  const v={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'file',fsPath:'/project'}}],textDocuments:[]},env:{},window:{}};
  const host=new Host(v,{invoke:async(method,args)=>method==='open'?{root:args.root}:{}});await host.openCurrent();
  const refused=[];
  for(const method of [...called].filter(name=>!PICKERS.has(name)).sort()){
    try{await host.api(method,{});}catch(error){if(error.message!=='method_invalid')throw error;refused.push(method);}
  }
  assert.deepEqual(refused.filter(name=>!OFF.has(name)),[],'A call the shared screen makes and this host refuses fails in the main product');
  assert.deepEqual([...OFF].filter(name=>called.has(name)&&!refused.includes(name)),[],'A method kept off stays off until the decision changes');
});

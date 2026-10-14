// MCP server ids and configs pasted from other apps (Claude, Cursor, VS Code), shared by the panel and its tests.
const slug=name=>String(name||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
export const idFor=name=>{const base=slug(name);return /^[a-z][a-z0-9-]{1,39}$/.test(base)?base:'';};
// Other apps' MCP config: {"mcpServers":{name:{command,args,env,cwd}|{url|serverUrl,headers}}}, or one server object.
export function parseMcpConfig(value){
  const map=value&&typeof value==='object'?(value.mcpServers&&typeof value.mcpServers==='object'?value.mcpServers:value.servers&&typeof value.servers==='object'?value.servers:(value.command||value.url)?{[value.name||'server']:value}:value):{};
  const used=new Set();
  return Object.entries(map).filter(([,entry])=>entry&&typeof entry==='object'&&(entry.command||entry.url||entry.serverUrl)).slice(0,16).map(([name,entry],index)=>{
    let id=idFor(name)||`server-${index+1}`;while(used.has(id))id=`${id}-${index+1}`;used.add(id);
    const env=entry.env&&typeof entry.env==='object'?entry.env:{},headers=entry.headers&&typeof entry.headers==='object'?entry.headers:{};
    if(entry.command){const keys=Object.keys(env).filter(key=>/^[A-Z][A-Z0-9_]{0,63}$/.test(key));const secrets=Object.fromEntries(keys.filter(key=>typeof env[key]==='string'&&env[key]).map(key=>[key,env[key]]));return {id,name,transport:'stdio',command:String(entry.command),args:Array.isArray(entry.args)?entry.args.map(String):[],cwd:typeof entry.cwd==='string'&&entry.cwd?entry.cwd:null,envKeys:keys,enabled:entry.disabled!==true,...(Object.keys(secrets).length?{secrets}:{})};}
    const keys=Object.keys(headers).filter(key=>/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(key));const secrets=Object.fromEntries(keys.filter(key=>typeof headers[key]==='string'&&headers[key]).map(key=>[key,headers[key]]));
    return {id,name,transport:'http',url:String(entry.url||entry.serverUrl),headerKeys:keys,enabled:entry.disabled!==true,...(Object.keys(secrets).length?{secrets}:{})};
  });
}

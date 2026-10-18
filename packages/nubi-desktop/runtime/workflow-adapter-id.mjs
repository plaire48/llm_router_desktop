// Browser-safe adapter identity; dynamic MCP tools still resolve at the host.
export function parseWorkflowAdapter(name){
 if(typeof name!=='string')return null;
 const mcp=/^mcp\.([a-z][a-z0-9-]{1,39})\.([A-Za-z_][A-Za-z0-9_.-]{0,149})$/.exec(name);
 if(mcp)return {family:'mcp',action:'call',serverId:mcp[1],tool:mcp[2]};
 const fixed=/^([a-z]+)\.([a-z_]+)$/.exec(name);return fixed&&fixed[1]!=='mcp'?{family:fixed[1],action:fixed[2]}:null;
}

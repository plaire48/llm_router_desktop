// A small MCP server for tests: one read-only tool and one tool that changes state. Started over stdio (as a child
// process) or over Streamable HTTP (node http) by the tests.
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import http from 'node:http';
export function createFixtureServer(){
  const server=new McpServer({name:'nubi-fixture',version:'1.0.0'});
  const notes=[];
  server.registerTool('echo',{description:'Echo the text back',inputSchema:{text:z.string()},annotations:{readOnlyHint:true}},async({text})=>({content:[{type:'text',text:`echo: ${text} (env ${process.env.FIXTURE_SECRET||'none'})`}]}));
  server.registerTool('add_note',{description:'Store a note',inputSchema:{text:z.string()}},async({text})=>{notes.push(text);return {content:[{type:'text',text:`stored ${notes.length}`}]};});
  return server;
}
if(process.argv[1]&&process.argv[1].endsWith('mcp-fixture-server.mjs')){
  const mode=process.argv[2]||'stdio';
  if(mode==='stdio'){await createFixtureServer().connect(new StdioServerTransport());}
  else{
    const listener=http.createServer(async(req,res)=>{
      if(req.headers.authorization!=='Bearer fixture-token'){res.writeHead(401).end();return;}
      const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
      res.on('close',()=>transport.close());
      await createFixtureServer().connect(transport);
      let body='';for await(const chunk of req)body+=chunk;
      await transport.handleRequest(req,res,body?JSON.parse(body):undefined);
    });
    listener.listen(0,'127.0.0.1',()=>{process.stdout.write(`PORT ${listener.address().port}\n`);});
  }
}

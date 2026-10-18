import {test} from 'node:test';
import assert from 'node:assert/strict';
import {irreversibleCommand,irreversibleProposal,irreversibleMcpTool} from '../runtime/irreversible-actions.mjs';
test('destructive shell commands are classified without executing them',()=>{
 for(const script of ['rm -rf dist','rm -r -f dist','git push --force origin main','git push -f','git reset --hard HEAD~1','Remove-Item -Recurse -Force ./out','rd /s /q build','del /f /s /q *.log','git clean -fd','npm test && rm -rf dist','npm test | rm -rf dist','"git" push --force'])assert.equal(irreversibleCommand(script).matched,true,script);
 assert.match(irreversibleCommand('git push --force').reason,/강제 push/);
});
test('ordinary commands and quoted mentions are not destructive commands',()=>{
 for(const script of ['npm test','git push origin feature','echo "rm -rf is dangerous"','echo "hello; rm -rf demo"','rmdir empty','git reset src/a.mjs',''])assert.equal(irreversibleCommand(script).matched,false,script);
});
test('only a proposal deleting an existing file matches',()=>{
 assert.equal(irreversibleProposal({kind:'delete',path:'src/a.mjs'}).matched,true);
 for(const kind of ['patch','create'])assert.equal(irreversibleProposal({kind}).matched,false);
});
test('MCP annotations and names match with a read-only exclusion',()=>{
 for(const tool of [{name:'delete_page',annotations:{destructiveHint:true}},{name:'create_issue',annotations:{openWorldHint:true}},{name:'send_mail'},{name:'publish_page'},{name:'refresh',annotations:{destructiveHint:true}}])assert.equal(irreversibleMcpTool(tool).matched,true,tool.name);
 for(const tool of [{name:'search_pages',annotations:{readOnlyHint:true}},{name:'delete_preview',annotations:{readOnlyHint:true,destructiveHint:true,openWorldHint:true}},{name:'refresh_cache'},{name:'browser_click',annotations:{readOnlyHint:false}}])assert.equal(irreversibleMcpTool(tool).matched,false,tool.name);
});

test('F1 native Playwright annotations are exempt only for the built-in server',()=>{
 const tool={name:'browser_click',annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}};
 assert.equal(irreversibleMcpTool(tool,{serverId:'playwright'}).matched,false);assert.equal(irreversibleMcpTool(tool,{serverId:'other'}).matched,true);
});
test('F8 MCP names match action tokens, not substrings',()=>{
 for(const name of ['get_presets','postgres_query','gmail_search','dropdown_select'])assert.equal(irreversibleMcpTool({name}).matched,false,name);
 for(const name of ['send_mail','deletePage','post-comment'])assert.equal(irreversibleMcpTool({name}).matched,true,name);
});
test('F3 Windows aliases, wrapper payloads and git global arguments retain irreversible warnings',()=>{
 for(const script of ['rm -Recurse -Force out','rmdir -Recurse -Force x','del -Recurse -Force x','Remove-Item -r -fo x','powershell -Command "Remove-Item -Recurse -Force x"','cmd /c "rd /s /q x"','sudo rm -rf x','/bin/rm -rf x','env X=1 rm -rf x','nice -n 5 rm -rf x','time rm -rf x','git -C dir push --force','git -c x=y reset --hard','rm.exe -rf x','powershell -EncodedCommand '+Buffer.from('Remove-Item -Recurse -Force x','utf16le').toString('base64')])assert.equal(irreversibleCommand(script).matched,true,script);
});

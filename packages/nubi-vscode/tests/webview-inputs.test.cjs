const test=require('node:test'),assert=require('node:assert/strict');
// User decision 2026-10-01 enabled A2A: the webview shows its names and messages, while pairing tokens,
// the SDK and the hub stay in the runtime process.
test('the webview may hold the A2A contract names, never its SDK, client, server or Theia',async()=>{
  const {leakedInputs}=await import('../scripts/webview-inputs.mjs');
  assert.deepEqual(leakedInputs(['../nubi-desktop/ui/Collaboration.jsx','../nubi-a2a/contract.mjs','../nubi-a2a/tasks.mjs']),[]);
  assert.deepEqual(leakedInputs(['..\\nubi-a2a\\tasks.mjs']),[],'Windows paths are read the same way');
  for(const file of ['../nubi-a2a/client.mjs','../nubi-a2a/server.mjs','../nubi-a2a/task-agent.mjs','../nubi-a2a/receiver.mjs','../nubi-a2a/node_modules/@a2a-js/sdk/dist/client/index.js','../nubi-desktop/node_modules/@theia/core/lib/common/index.js'])
    assert.deepEqual(leakedInputs([file]),[file],file);
});

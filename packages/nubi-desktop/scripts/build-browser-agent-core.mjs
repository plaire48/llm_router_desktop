import {build} from 'esbuild';

// Compile only the independent addon's host-owned core. Optional Page/Stagehand
// adapters and their peer dependencies are not required by the Desktop bridge.
await build({entryPoints:['../nubi-browser-agent/src/index.ts'],outfile:'generated/browser-agent-core.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof'});
await build({entryPoints:['../nubi-browser-agent/src/knowledge.ts'],outfile:'generated/browser-screen-knowledge.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof'});
await build({entryPoints:['../nubi-browser-agent/src/knowledge-wiki.ts'],outfile:'generated/browser-screen-wiki.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof'});

await build({entryPoints:['../nubi-browser-agent/src/knowledge-learning.ts'],outfile:'generated/browser-screen-learning.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof'});

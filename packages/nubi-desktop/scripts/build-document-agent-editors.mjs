import {build} from 'esbuild';
await build({entryPoints:['../nubi-document-agent/src/editors.ts'],outfile:'generated/document-agent-editors.mjs',bundle:true,platform:'neutral',format:'esm',target:'es2022',legalComments:'eof'});

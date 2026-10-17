import {build} from 'esbuild';
await build({entryPoints:['../nubi-document-agent/connectors/obsidian/plugin.ts'],outfile:'../nubi-document-agent/connectors/obsidian/main.js',bundle:true,platform:'node',format:'cjs',external:['obsidian'],target:'es2022',legalComments:'eof'});

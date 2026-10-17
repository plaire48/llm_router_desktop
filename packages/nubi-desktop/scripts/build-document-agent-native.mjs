import './build-document-agent-editors.mjs';
import './build-native-excel-calculator.mjs';
import {build} from 'esbuild';
// Only the native skill/DTO verifier. No file parsers, authoring engines, CLI
// adapters, provider credentials or evaluation fixtures enter the Desktop.
await build({entryPoints:['../nubi-document-agent/src/native-model.ts'],outfile:'generated/document-agent-native.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof'});

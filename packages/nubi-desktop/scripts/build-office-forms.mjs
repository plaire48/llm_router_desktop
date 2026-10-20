import path from 'node:path';
import {build} from 'esbuild';

// The Office form parts (word-form-map, form-fill, form-apply, form-checks, fill-sheet, form-values) with their
// dependencies, bundled for the Desktop runtime. See runtime/office-forms-source.mjs. The parts import typebox and
// numfmt by name; the Desktop package installs them, so its node_modules is the fallback for those names.
await build({entryPoints:['runtime/office-forms-source.mjs'],outfile:'generated/office-forms.mjs',bundle:true,platform:'node',format:'esm',target:'node24',legalComments:'eof',nodePaths:[path.resolve('node_modules')]});

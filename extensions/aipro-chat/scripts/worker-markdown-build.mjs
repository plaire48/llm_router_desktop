import {fileURLToPath} from 'node:url';

// The package's browser export uses document.createElement at module load.
// Extension workers need its existing pure-JS implementation, with no DOM shim.
export const workerMarkdownBuild = {
  alias: {'decode-named-character-reference': fileURLToPath(new URL('../node_modules/decode-named-character-reference/index.js', import.meta.url))},
};

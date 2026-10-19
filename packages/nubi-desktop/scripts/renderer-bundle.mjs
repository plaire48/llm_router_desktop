import {cxReferenceCssPlugin} from './cx-reference-css.mjs';
import {workspaceArtworkPlugin} from './workspace-artwork-plugin.mjs';
import path from 'node:path';
import {readFileSync} from 'node:fs';
// The package version reaches the settings panel as a build-time constant, so it changes with every version bump (2026-10-14).
const packageVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;
// The Electron renderer bundle, shared by the build that writes it (build-electron.mjs) and the compile that analyses
// it without writing, for the release snapshot of bundle inputs and the A2A guard (build-runtime.mjs) (2026-10-07).
export const rendererBundleOptions=()=>({entryPoints:['electron-app/renderer.jsx'],plugins:[workspaceArtworkPlugin(),cxReferenceCssPlugin()],entryNames:'renderer',chunkNames:'chunks/[name]-[hash]',bundle:true,splitting:true,format:'esm',platform:'browser',target:'chrome146',nodePaths:[path.resolve('node_modules')],loader:{'.webp':'file','.png':'dataurl','.woff2':'file','.woff':'file','.ttf':'file','.svg':'dataurl','.gif':'dataurl'},alias:{'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css'),'react':path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom'),'@e2e/cx-design-system':path.resolve('node_modules/@e2e/cx-design-system')},define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:'"Beta"',__NUBI_VERSION__:JSON.stringify(packageVersion)},legalComments:'eof',metafile:true});

import {readFile, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function collectProvenance(root, {sharedRoot} = {}) {
  const files = [];
  async function walk(relative, base = root, prefix = '') {
    for (const entry of await readdir(resolve(base, relative), {withFileTypes: true})) {
      if (['bin', 'obj', 'node_modules', 'dist', 'verification'].includes(entry.name)) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(path, base, prefix);
      else if (entry.isFile() && /\.(mjs|js|jsx|css|html|cs|csproj|json|xml|ps1)$/.test(entry.name) && !entry.name.endsWith('-bundled.mjs')) files.push({path: prefix + path, absolute: resolve(base, path)});
    }
  }
  for (const directory of ['worker', 'src', 'native', 'eval', 'scripts']) await walk(directory);
  for (const path of ['package.json', 'package-lock.json']) files.push({path, absolute: resolve(root, path)});
  if (sharedRoot) for (const entry of await readdir(sharedRoot, {withFileTypes: true})) {
    if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) files.push({path: `shared/${entry.name}`, absolute: resolve(sharedRoot, entry.name)});
    if (entry.isDirectory() && ['src','design'].includes(entry.name)) await walk(entry.name, sharedRoot, 'shared/');
  }
  const manifest = [];
  for (const file of files.sort((a, b) => a.path.localeCompare(b.path, 'en'))) manifest.push({path: file.path, sha256: digest(await readFile(file.absolute))});
  const artifacts = [];
  for (const path of ['dist/worker/main.mjs', 'eval/run-bundled.mjs', 'eval/promptfoo-provider-bundled.mjs', 'native/Nubi.Office.EvalHost/bin/Release/net472/Nubi.Office.EvalHost.exe']) {
    try {artifacts.push({path, sha256: digest(await readFile(resolve(root, path)))});}
    catch (error) {if (error.code !== 'ENOENT') throw error; artifacts.push({path, sha256: null});}
  }
  return {sourceHash: digest(JSON.stringify(manifest)), manifest, artifacts, buildMatchesSource: null};
}

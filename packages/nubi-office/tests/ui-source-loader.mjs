// Test-only JSX transforms in memory. No bundling, output files or product build.
import {registerHooks, createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {transformSync} from 'esbuild';
const require = createRequire(new URL('../package.json', import.meta.url));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'react' || specifier.startsWith('react/') || specifier === 'react-dom' || specifier.startsWith('react-dom/') || specifier === '@e2e/cx-design-system') {
      return {url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true};
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (/\.(css|png|svg|webp)$/.test(url)) return {format: 'module', source: 'export default "test-asset";', shortCircuit: true};
    if (url.endsWith('.jsx')) return {format: 'module', source: transformSync(readFileSync(fileURLToPath(url), 'utf8'), {loader: 'jsx', format: 'esm'}).code, shortCircuit: true};
    return next(url, context);
  }
});

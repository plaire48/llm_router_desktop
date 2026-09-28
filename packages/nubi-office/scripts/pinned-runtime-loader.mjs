// Test-only: resolve the three externally bundled Pi packages from Office's
// own lock/install even when shared Nubi source lives under the browser tree.
import {register} from 'node:module';
register(new URL('./pinned-runtime-resolve.mjs',import.meta.url));

// Both constants are supplied from package.json by the desktop build. The
// second name also supports existing browser fixtures and shared UI bundles.
export const NUBI_VERSION=typeof __NUBI_VERSION__==='string'&&__NUBI_VERSION__||typeof __APP_VERSION__==='string'&&__APP_VERSION__||'development';

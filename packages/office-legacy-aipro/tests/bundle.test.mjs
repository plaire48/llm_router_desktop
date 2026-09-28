import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('built standalone server resolves Nubi runtime and starts on loopback without installing certificates', { skip: !existsSync(new URL('../dist/server.mjs', import.meta.url)) }, async () => {
  const { startServer } = await import('../dist/server.mjs'); let handler, bound;
  const server = { on() {}, close() {}, closeAllConnections() {}, listen(port, host, callback) { bound = { port, host }; callback(); } };
  const running = await startServer({ httpsOptions: async () => ({}), serverFactory: (_options, fn) => { handler = fn; return server; }, logger: { log() {} } });
  assert.equal(bound.port, 8790); assert.equal(bound.host, '127.0.0.1'); assert.equal(typeof handler, 'function'); running.close();
});

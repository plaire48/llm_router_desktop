import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { unzipSync, strFromU8 } from 'fflate';
import { createAdvisor, providerConfig } from '../src/aipro.js';
import { createVerifier } from '../src/auth.js';
import { createBridge } from '../src/server.js';
import { validateInput, validatePlan } from '../src/contract.js';
import { createPackage, buildManifest } from '../scripts/package.js';

const selection = { request: 'B2에 매출 합계를 넣어줘', mode: 'edit', worksheet: '매출', address: 'A1:B2', values: [['매출', '합계'], [120, '']], formulas: [['매출', '합계'], [120, '']] };
const plan = { answer: 'B2에 매출 합계 수식을 제안합니다.', operations: [{ type: 'set_formulas', address: 'B2', formulas: [['=SUM(A2:A2)']] }] };
const provider = { mode: 'cli', endpoint: 'https://aipro-cli.test/v1/chat/completions', token: 'private-ai-token', model: 'configured-model' };
const identity = { tenant: '11111111-1111-1111-1111-111111111111', audience: '22222222-2222-2222-2222-222222222222', user: '33333333-3333-3333-3333-333333333333', issuer: 'https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/v2.0' };
const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test', alg: 'RS256' };
const verify = createVerifier(identity, createLocalJWKSet({ keys: [jwk] }));
async function token(overrides = {}) {
  return new SignJWT({ tid: identity.tenant, oid: identity.user, scp: 'access_as_user', ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(identity.issuer).setAudience(identity.audience).setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
}
function response(value = plan) { return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }); }
async function start(t, advise) {
  const server = createBridge({ origin: 'https://bridge.test', identity, verify, advise });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('real MCP handshake, discovery and tool invocation use AI Pro and never claim workbook edits', async t => {
  let call;
  const advise = createAdvisor(provider, async (url, options) => { call = { url, options }; return response(); });
  const url = await start(t, advise);
  const client = new Client({ name: 'native-copilot-contract-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${await token()}` } } }));
  const list = await client.listTools();
  assert.equal(list.tools[0].name, 'aipro_excel_plan');
  const result = await client.callTool({ name: 'aipro_excel_plan', arguments: selection });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.applied, false);
  assert.equal(result.structuredContent.operations[0].address, 'B2');
  assert.match(result.structuredContent.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(call.url, provider.endpoint);
  assert.equal(call.options.headers.Authorization, 'Bearer private-ai-token');
  assert.equal(call.options.headers['User-Agent'], 'AIPROCLI');
  assert.equal(call.options.redirect, 'error');
  assert.equal(JSON.parse(call.options.body).model, provider.model);
  assert.equal(JSON.stringify(result).includes(provider.token), false);
});

test('missing auth, other user, wrong scope, and hostile origin do not invoke AI Pro', async t => {
  let calls = 0;
  const url = await start(t, async () => { calls++; return {}; });
  for (const credential of ['', await token({ oid: 'other-user' }), await token({ scp: 'User.Read' })]) {
    const result = await fetch(`${url}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: '{}' });
    assert.equal(result.status, 401);
    assert.match(result.headers.get('www-authenticate'), /oauth-protected-resource/);
  }
  const blocked = await fetch(`${url}/mcp`, { method: 'POST', headers: { Origin: 'https://untrusted.test', Authorization: `Bearer ${await token()}` }, body: '{}' });
  assert.equal(blocked.status, 403);
  assert.equal(calls, 0);
  const metadata = await (await fetch(`${url}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(metadata.resource, 'https://bridge.test/mcp');
  assert.equal(JSON.stringify(metadata).includes(provider.token), false);
});

test('JWT signature, audience, issuer and expiry are checked', async () => {
  assert.equal((await verify(`Bearer ${await token()}`)).user, identity.user);
  for (const fields of [{ aud: 'wrong' }, { iss: 'https://wrong.test' }, { exp: Math.floor(Date.now() / 1000) - 60 }]) {
    const signed = await new SignJWT({ tid: identity.tenant, oid: identity.user, scp: 'access_as_user', iss: identity.issuer, aud: identity.audience, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, ...fields }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(keys.privateKey);
    await assert.rejects(verify(`Bearer ${signed}`));
  }
  const valid = await token();
  await assert.rejects(verify(`Bearer ${valid.slice(0, -8)}AAAAAAAA`));
});

test('range shape, maximum cells and current formulas are enforced before AI Pro', () => {
  assert.deepEqual(validateInput(selection), selection);
  for (const input of [{ ...selection, address: 'A1:B3' }, { ...selection, address: 'A1:Z100' }, { ...selection, address: 'XFE1' }, { ...selection, address: 'A1048577' }, { ...selection, formulas: undefined }]) assert.throws(() => validateInput(input));
});

test('out-of-scope edits, executable text and external formulas are rejected', () => {
  const bad = [
    { type: 'set_values', address: 'C1', values: [[1]] },
    { type: 'set_values', address: 'A1', values: [['=WEBSERVICE("https://x.test")']] },
    { type: 'set_formulas', address: 'A1', formulas: [['=HYPERLINK("https://x.test")']] },
    { type: 'set_formulas', address: 'A1', formulas: [["='Other'!A1"]] },
    { type: 'set_formulas', address: 'A1', formulas: [['=SUM([external.xlsx]A1)']] },
    { type: 'execute_script', address: 'A1', code: 'deleteAll()' },
  ];
  for (const operation of bad) assert.throws(() => validatePlan({ answer: 'x', operations: [operation] }, selection));
  assert.throws(() => validatePlan(plan, { ...selection, mode: 'analyze' }));
});

test('HTTP errors, invalid plans, truncation and cancellation fail without credential leakage', async () => {
  for (const makeResponse of [() => new Response(`secret ${provider.token}`, { status: 502 }), () => response({ ...plan, operations: [{ type: 'set_values', address: 'Z99', values: [[1]] }] }), () => Response.json({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(plan) } }] })]) {
    await assert.rejects(createAdvisor(provider, async () => makeResponse())(selection), error => !error.message.includes(provider.token));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createAdvisor(provider, async (_, { signal }) => { signal.throwIfAborted(); })(selection, controller.signal), { code: 'aipro_cancelled_or_timeout' });
});

test('SSO bearer uses its own endpoint and does not impersonate AI Pro CLI', async () => {
  const jwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'pilot', exp: Math.floor(Date.now() / 1000) + 100 })).toString('base64url')}.signature`;
  const config = providerConfig({ AIPRO_MODE: 'browser-token', AIPRO_ACCESS_TOKEN: jwt, AIPRO_MODEL_ID: 'sso-model', AIPRO_CLI_TOKEN: 'must-not-use' });
  let observed;
  await createAdvisor(config, async (url, options) => { observed = { url, options }; return response(); })(selection);
  assert.equal(observed.url, 'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
  assert.equal(observed.options.headers.Authorization, `Bearer ${jwt}`);
  assert.equal(observed.options.headers['User-Agent'], undefined);
  assert.throws(() => providerConfig({ AIPRO_MODE: 'cli', AIPRO_CLI_BASE_URL: 'http://plain.test', AIPRO_CLI_TOKEN: 'x', AIPRO_CLI_MODEL_ID: 'm' }));
});

const packageEnv = { PUBLIC_ORIGIN: 'https://bridge.test', M365_APP_ID: identity.audience, M365_OAUTH_REGISTRATION_ID: 'registered-vault-id', M365_DEVELOPER_NAME: 'Pilot', M365_WEBSITE_URL: 'https://bridge.test/', M365_PRIVACY_URL: 'https://bridge.test/privacy', M365_TERMS_URL: 'https://bridge.test/terms', AIPRO_CLI_TOKEN: 'must-never-ship' };
test('M365 archive contains native skill and OAuth connector, no extra chat surface or secrets', async () => {
  const files = unzipSync(await createPackage(packageEnv));
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.manifestVersion, '1.28');
  assert.equal(manifest.agentConnectors[0].toolSource.remoteMcpServer.authorization.type, 'OAuthPluginVault');
  assert.equal(manifest.agentConnectors[0].toolSource.remoteMcpServer.mcpServerUrl, 'https://bridge.test/mcp');
  assert.equal(manifest.staticTabs, undefined);
  assert.equal(manifest.extensions, undefined);
  assert.ok(files['skills/aipro-excel/SKILL.md']);
  assert.equal(manifest.agentConnectors[0].toolSource.remoteMcpServer.mcpToolDescription.file, './tools/aipro-excel.json');
  assert.equal(JSON.parse(strFromU8(files['tools/aipro-excel.json'])).tools[0].name, 'aipro_excel_plan');
  assert.equal(Buffer.from(files['color.png']).readUInt32BE(16), 192);
  assert.equal(Buffer.from(files['outline.png']).readUInt32BE(16), 32);
  assert.equal(Object.values(files).map(strFromU8).join('').includes('must-never-ship'), false);
  assert.throws(() => buildManifest({}), /Configure PUBLIC_ORIGIN/);
  assert.throws(() => buildManifest({ ...packageEnv, PUBLIC_ORIGIN: 'https://localhost:8789' }), /remote HTTPS/);
});

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';
import { deflateSync } from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { publicOrigin, createToolServer } from '../src/server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Configure ${name} before packaging.`);
  return value;
}
function httpsUrl(env, key) {
  const url = new URL(required(env, key));
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${key} must be an HTTPS URL.`);
  return url.href;
}
export function buildManifest(env) {
  const origin = publicOrigin(required(env, 'PUBLIC_ORIGIN'));
  const id = required(env, 'M365_APP_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('M365_APP_ID must be a GUID.');
  const registration = required(env, 'M365_OAUTH_REGISTRATION_ID');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(registration)) throw new Error('Invalid OAuth registration ID.');
  return {
    $schema: 'https://developer.microsoft.com/json-schemas/teams/v1.28/MicrosoftTeams.schema.json',
    manifestVersion: '1.28', version: '0.1.0', id,
    developer: { name: required(env, 'M365_DEVELOPER_NAME'), websiteUrl: httpsUrl(env, 'M365_WEBSITE_URL'), privacyUrl: httpsUrl(env, 'M365_PRIVACY_URL'), termsOfUseUrl: httpsUrl(env, 'M365_TERMS_URL') },
    name: { short: 'AI Pro for Excel', full: 'AI Pro for Microsoft Copilot in Excel' },
    description: { short: 'Excel Copilot에서 AI Pro로 선택 영역을 분석하고 작업을 제안합니다.', full: 'Microsoft Copilot에서 AI Pro를 호출하여 선택한 Excel 범위를 분석하고 값, 수식, 서식 변경을 제안합니다. 실제 편집은 해당 환경의 Excel 도구로 수행하고 검증합니다. Excel 미리보기 기능을 사용하는 개인 검증용 확장입니다.' },
    icons: { color: 'color.png', outline: 'outline.png' }, accentColor: '#3182F6',
    agentSkills: [{ folder: './skills/aipro-excel' }],
    agentConnectors: [{ id: 'aipro-excel-bridge', displayName: 'AI Pro', description: 'AI Pro analysis and bounded Excel edit proposals.', toolSource: { remoteMcpServer: { mcpServerUrl: `${origin}/mcp`, mcpToolDescription: { file: './tools/aipro-excel.json' }, authorization: { type: 'OAuthPluginVault', referenceId: registration } } } }],
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return out;
}
function icon(size, outline) {
  const bytes = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const inGrid = px > .19 && px < .81 && py > .2 && py < .8;
    const line = inGrid && ([.21, .4, .6, .79].some(v => Math.abs(px - v) < .018) || [.22, .41, .59, .78].some(v => Math.abs(py - v) < .018));
    const pixel = y * (size * 4 + 1) + 1 + x * 4;
    const color = outline ? [255, 255, 255, line ? 255 : 0] : line ? [49, 130, 246, 255] : [234, 243, 254, 255];
    color.forEach((c, i) => { bytes[pixel + i] = c; });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0))]);
}
export async function createPackage(env) {
  const files = { 'manifest.json': strToU8(JSON.stringify(buildManifest(env), null, 2)), 'color.png': icon(192, false), 'outline.png': icon(32, true) };
  const server = createToolServer(() => { throw new Error('Packaging cannot invoke AI Pro.'); });
  const client = new Client({ name: 'package-tool-descriptions', version: '0.1.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    files['tools/aipro-excel.json'] = strToU8(JSON.stringify(await client.listTools(), null, 2));
  } finally { await client.close(); await server.close(); }
  const base = join(root, 'appPackage');
  async function add(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = join(folder, entry.name);
      if (entry.isDirectory()) await add(file);
      else if (entry.isFile() && entry.name.endsWith('.md')) files[relative(base, file).split('\\').join('/')] = new Uint8Array(await readFile(file));
    }
  }
  await add(join(base, 'skills'));
  return zipSync(files);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const archive = await createPackage(process.env);
    await mkdir(join(root, 'dist'), { recursive: true });
    const path = join(root, 'dist/office-copilot-aipro.zip');
    await writeFile(path, archive);
    console.log(`Created ${path}. Packaging does not verify deployment, authentication, or Excel availability.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

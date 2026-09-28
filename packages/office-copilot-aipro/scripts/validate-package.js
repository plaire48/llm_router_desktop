import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { unzipSync, strFromU8 } from 'fflate';
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js';

export function validateArchive(archive, schema) {
  const files = unzipSync(archive);
  const manifest = JSON.parse(strFromU8(files['manifest.json']));
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(manifest)) throw new Error(JSON.stringify(validate.errors));
  const path = manifest.agentConnectors[0].toolSource.remoteMcpServer.mcpToolDescription.file.replace(/^\.\//, '');
  if (!files[path]) throw new Error('Missing packaged MCP tool description.');
  ListToolsResultSchema.parse(JSON.parse(strFromU8(files[path])));
  for (const skill of manifest.agentSkills) {
    if (!files[`${skill.folder.replace(/^\.\//, '')}/SKILL.md`]) throw new Error('Missing packaged skill.');
  }
  return { manifestSchema: '1.28', toolDescriptions: 'valid', nativeCopilotInstalled: false, liveAiProVerified: false, excelEditingVerified: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const archive = await readFile(process.argv[2] || new URL('../dist/office-copilot-aipro.zip', import.meta.url));
    const response = await fetch('https://developer.microsoft.com/json-schemas/teams/v1.28/MicrosoftTeams.schema.json', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Microsoft schema retrieval failed: ${response.status}`);
    console.log(JSON.stringify(validateArchive(archive, await response.json()), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

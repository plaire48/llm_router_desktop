export const SKILL_MARKETPLACE_PATH='.agents/plugins/marketplace.json';
export const CLAUDE_MARKETPLACE_PATH='.claude-plugin/marketplace.json';
export const SKILL_MARKETPLACE_PATHS=[SKILL_MARKETPLACE_PATH,CLAUDE_MARKETPLACE_PATH];
export const SKILL_MARKETPLACE_NAME='ai-workspace';
export const validPluginName=name=>typeof name==='string'&&name.length<=64&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
export const pluginRoot=name=>`plugins/${name}`;
export function isSkillPluginPath(path,name) {
  if(!validPluginName(name)||typeof path!=='string'||path.length>420||/[\\:\x00-\x1f\x7f]/.test(path)||path.split('/').some(part=>!part||['.','..','.git'].includes(part.toLowerCase())))return false;
  return path===`${pluginRoot(name)}/plugin.json`||path===`${pluginRoot(name)}/.codex-plugin/plugin.json`||path===`${pluginRoot(name)}/.claude-plugin/plugin.json`||path.startsWith(`${pluginRoot(name)}/skills/${name}/`);
}

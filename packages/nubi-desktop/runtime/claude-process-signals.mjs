export function claudeEnvironment(source=process.env) {
  const env={...source};
  // Do not accidentally bill an inherited API key or redirect a signed-in CLI.
  for(const key of Object.keys(env))if(/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_|CLAUDE_CONFIG_DIR$|CLAUDECODE$)/.test(key))delete env[key];
  return env;
}

export function claudeFailureCode(event) {
  if(event?.type==='assistant'&&event.error==='rate_limit')return 'rate_limited';
  if(event?.type==='rate_limit_event'&&event.rate_limit_info?.status==='rejected'&&event.rate_limit_info?.overageStatus!=='allowed')return 'rate_limited';
  return null;
}

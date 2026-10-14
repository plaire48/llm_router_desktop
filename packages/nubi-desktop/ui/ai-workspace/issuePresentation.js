// Prefix the GHES issue title; GHES controls the enclosing email subject/template.
export function issueTitle(kind, title) {
  return `[AI Workspace][${kind}] ${String(title || '').trim().replace(/[\r\n]/g, ' ').replace(/@/g, '@\u200b')}`;
}
export function displayIssueTitle(title) {
  return String(title || '').replace(/^\[(?:AI Workspace|Skill Hub|E2E Report)\]\[(?:문의|Talk|Role)\]\s*/, '').replace(/@\u200b/g, '@');
}
export const isRoleNotice = issue => !issue?.pull_request && /^<!-- e2e-role-notice:[a-f\d-]{36}:(\d+):(user|editor|system) -->\n/.test(issue?.body || '');

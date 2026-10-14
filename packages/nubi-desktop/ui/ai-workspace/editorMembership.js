import {GHES_CONFIG,E2E_EDITOR_TEAM} from './config.js';
import {hasTeamMember} from './teamMemberLookup.js';

// Team membership grants an app role only alongside repository Write.
// Branch protection chooses main writers; single-main settings restrictions are in the app.
export async function editorMembership(request,login,{owner=GHES_CONFIG.owner,team=E2E_EDITOR_TEAM}={}) {
  return hasTeamMember(request,login,{owner,team});
}

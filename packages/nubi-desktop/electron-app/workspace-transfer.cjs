// A 50 MiB site is base64 inside JSON, and the Git blob response base64-encodes that JSON again.
// Bound that representation as well as the original files; normal requests keep their smaller limits.
const WORKSPACE_BLOB_LIMIT=96*1024*1024;
function workspaceTransferLimit(route,fallback){
 return /^\/api\/v3\/repos\/Manufacturing-IT\/ai_workspace\/(?:git\/blobs(?:\/[a-f\d]{40})?|contents\/data\/workspace\/sites\/[a-f\d]{64}\.json)$/.test(route)?WORKSPACE_BLOB_LIMIT:fallback;
}
module.exports={WORKSPACE_BLOB_LIMIT,workspaceTransferLimit};

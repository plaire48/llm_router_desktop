import path from 'node:path';

// Older catalogs may call the reserved personal folder a project. Its identity
// still owns conversation data; a stale label must not grant Wiki creation.
export const isConversationRoot=(root,storageRoot)=>typeof root==='string'&&typeof storageRoot==='string'&&path.resolve(root)===path.resolve(storageRoot,'conversations');
export const hasProjectWiki=service=>service.workspaceKind!=='conversation'&&!isConversationRoot(service.root,service.storageRoot);
export function requireProjectWiki(service){if(!hasProjectWiki(service))throw Error('wiki_unavailable');}

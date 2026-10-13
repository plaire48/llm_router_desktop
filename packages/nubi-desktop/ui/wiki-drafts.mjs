// Drafts survive navigation between project, mail and community screens.
export const wikiDrafts=new Map();
export const hasWikiDrafts=()=>wikiDrafts.size>0;

// Remember the last document per trusted library during this app session.
export const wikiLastDocuments=new Map();

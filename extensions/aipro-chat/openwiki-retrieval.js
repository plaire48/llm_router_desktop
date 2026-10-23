import {wikiChunks, createWikiEvidenceSearch} from './site-wiki-retrieval.js';

// Each question owns its cache. Reuse the reviewed-Markdown parser and Korean
// spacing search for BOTH Wiki sources, without persistent mixed-source state.
export function createWikiQuestionSearch() {
  const cache = new Map();
  let previousParts=[],rank=null,indexBuilds=0,indexReuses=0;
  const documentChunks = doc => {
      const previous=cache.get(doc.id);
      if (!previous || previous.text!==doc.text || previous.title!==doc.title) cache.set(doc.id, {text:doc.text,title:doc.title,chunks:wikiChunks(doc.text).map(part => ({
        id: `${doc.id}:${part.start}`, documentId:doc.id, name:doc.title,
        context:part.searchContext, text:part.text, searchText:part.searchText,
        start:part.start, end:part.end,
        contextRanges:part.context.map(({kind,range,truncated}) => ({kind,start:range.start,end:range.end,...(truncated ? {truncated:true} : {})})),
        contextTruncated:part.contextTruncated, mixedSections:part.mixedSections,
      }))});
      return cache.get(doc.id).chunks;
  };
  const search = (query, documents) => {
    const allowed=new Set(documents.map(doc=>doc.id));
    for(const id of cache.keys())if(!allowed.has(id))cache.delete(id);
    const parts=documents.map(documentChunks);
    if(!rank||parts.length!==previousParts.length||parts.some((part,i)=>part!==previousParts[i])){
      const chunks=parts.flat(),byId=new Map(chunks.map(chunk=>[chunk.id,chunk]));
      rank={search:createWikiEvidenceSearch(chunks),byId};previousParts=parts;indexBuilds++;
    }else indexReuses++;
    const ranked = rank.search(query).map(hit => {
      const byId=rank.byId;
      const {documentId,start,end,contextRanges,contextTruncated,mixedSections}=byId.get(hit.id);
      return {documentId,start,end,contextRanges,contextTruncated,mixedSections};
    });
    // Preserve relevance order within documents while reserving candidate
    // slots for other matching sources (including contradictory policies).
    const selected=[], deferred=[], counts=new Map();
    for(const hit of ranked) {
      const count=counts.get(hit.documentId) || 0;
      if(selected.length<8 && count<2) {selected.push(hit);counts.set(hit.documentId,count+1);}
      else deferred.push(hit);
    }
    return [...selected,...deferred];
  };
  search.diagnostics=()=>({indexBuilds,indexReuses,indexedChunks:rank?.byId.size||0,retainedDocuments:cache.size});
  // Only structural ranges from the same parsed snapshot. The core validates
  // and budgets these before observing original text, never inferred summaries.
  search.context = (document, start, end) => {
    const chunks=documentChunks(document).filter(part=>part.start<end && part.end>start);
    const unique=new Map();
    for(const chunk of chunks) for(const context of chunk.contextRanges)
      unique.set(`${context.kind}:${context.start}:${context.end}`,context);
    return {ranges:[...unique.values()],truncated:chunks.some(part=>part.contextTruncated)};
  };
  return search;
}

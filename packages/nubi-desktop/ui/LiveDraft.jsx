import React from 'react';

// Only the public actor text is supplied here. Provider reasoning and review
// JSON never enter this surface. Plain text avoids parsing incomplete Markdown
// and moving the final answer bubble for every streamed token.
export function LiveDraft({task}){
 if(task?.state!=='running'||!task.streamingAnswer?.trim())return null;
 return <section className="nubi-live-draft" role="region" aria-label="작성 중인 초안">
  <small>작성 중인 초안</small><p className="message-body">{task.streamingAnswer}</p>
 </section>;
}

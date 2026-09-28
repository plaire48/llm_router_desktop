import {retainedAnswers} from '../worker/input-contract.mjs';

// Keep every available conversation message. The native pipe has a 250,000
// character envelope limit; leave room for its wrapping rather than truncating
// history silently or crashing the worker with an oversized start request.
export function prepareRunPayload(payload){
  if(JSON.stringify(payload).length>220000||(payload.history?.length||0)>500)throw new Error('history_context_limit');
  return payload;
}

// Only acknowledged form answers are stored on assistant messages. Preserve
// their order before that turn's final answer, including answers on failed runs.
export function conversationForRun(messages){
  return messages.flatMap(message=>{
    if(!['user','assistant'].includes(message.role))return [];
    const inputs=message.role==='assistant'?retainedAnswers(message.inputAnswers||[]).flatMap(answer=>[
      {role:'assistant',content:answer.question},{role:'user',content:answer.text}
    ]):[];
    return [...inputs,...(typeof message.content==='string'&&message.content&&message.state!=='failed'?[{role:message.role,content:message.content}]:[])];
  });
}

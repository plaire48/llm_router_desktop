import {randomUUID} from 'node:crypto';
import {fail} from './files.mjs';
// Chapters divide a long conversation into phases (Claude Desktop benchmark, 2026-10-16). The model names the
// phase; the host fixes the position at the current end of the messages. Nothing is removed or moved.
export const CHAPTER_LIMIT=20,CHAPTER_RUN_LIMIT=5; // whole conversation, one run
export function addChapter(task,{title,summary='',runId}){
  const name=String(title||'').replace(/\s+/g,' ').trim(),note=String(summary||'').replace(/\s+/g,' ').trim();
  if(!name||name.length>40||note.length>200||!runId||!(task.messages?.length>0))fail('chapter_invalid');
  task.chapters=Array.isArray(task.chapters)?task.chapters:[];
  if(task.chapters.length>=CHAPTER_LIMIT||task.chapters.filter(row=>row.runId===runId).length>=CHAPTER_RUN_LIMIT)fail('chapter_limit');
  const row={id:randomUUID(),title:name,summary:note,runId,messageIndex:task.messages.length,at:new Date().toISOString()};
  task.chapters.push(row);return row;
}

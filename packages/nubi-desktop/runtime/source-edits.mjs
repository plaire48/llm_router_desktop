import {diffLines} from 'diff';
import {fail, hash} from './files.mjs';
import {matchView,normalizeForMatch} from './edit-match.mjs';

// Observations belong to one model run. A stale summary or a human opening an
// editor does not count as the model having read the replacement range.
export class SourceObservations {
  files = new Map();
  newPaths = new Map();
  observeMissing(file) {this.newPaths.set(file.path,{hash:file.hash,rulesFingerprint:file.projectRules?.fingerprint});}
  observe(file) {
    let value = this.files.get(file.path);
    if (!value || value.hash !== file.hash) value = {hash: file.hash, ranges: []};
    value.rulesFingerprint=file.projectRules?.fingerprint;
    value.ranges.push([file.start, file.end]);
    value.ranges.sort((a, b) => a[0] - b[0]);
    value.ranges = value.ranges.reduce((merged, range) => {
      const previous = merged.at(-1);
      if (previous && range[0] <= previous[1] + 1) previous[1] = Math.max(previous[1], range[1]);
      else merged.push([...range]);
      return merged;
    }, []);
    this.files.set(file.path, value);
  }
  require(file, start = 1, end = file.lines) {
    const value = this.files.get(file.path);
    if (!value || value.hash !== file.hash || !value.ranges.some(([a, b]) => a <= start && b >= end)) fail('source_read_required');
  }
}

const failWith=(code,details)=>{const error=new Error(code);error.details=details;throw error;};
const lineOf=(content,offset)=>content.slice(0,offset).split('\n').length;
// The read line most like the first line of a text that was not found, to show the model what is really there.
function closestLine(file,observations,oldText){
  const wanted=normalizeForMatch((oldText.split(/\r?\n/).find(line=>line.trim())||'').trim());if(!wanted)return null;
  const lines=file.content.split(/\r?\n/),ranges=observations.files.get(file.path)?.ranges||[];
  const pairs=text=>{const set=new Map();for(let i=0;i<text.length-1;i++){const pair=text.slice(i,i+2);set.set(pair,(set.get(pair)||0)+1);}return set;};
  const target=pairs(wanted);let best=null;
  for(const [first,last] of ranges)for(let line=first;line<=Math.min(last,lines.length);line++){
    const text=lines[line-1],candidate=pairs(normalizeForMatch(text.trim()));let shared=0;
    for(const [pair,count] of candidate)shared+=Math.min(count,target.get(pair)||0);
    const score=2*shared/Math.max(1,Math.max(0,wanted.length-1)+Math.max(0,text.trim().length-1));
    if(!best||score>best.score)best={line,text,score};
  }
  return best&&best.score>=0.5?{line:best.line,text:best.text}:null;
}
export function replaceObserved(file, expectedHash, edits, observations) {
  if (file.hash !== expectedHash) fail('source_stale');
  if (!Array.isArray(edits) || !edits.length || edits.length > 10) fail('edits_invalid');
  const changes = edits.flatMap((edit,index) => {
    if (!edit || typeof edit.oldText !== 'string' || !edit.oldText || edit.oldText.length > 20000 || typeof edit.newText !== 'string' || edit.newText.length > 20000 || edit.replaceAll!==undefined&&typeof edit.replaceAll!=='boolean') fail('edits_invalid');
    const view = matchView(file.content, edit.oldText, edit.newText);
    if (!view.matches.length) failWith('edit_text_missing',{edit:index,...(closestLine(file,observations,edit.oldText)?{closest:closestLine(file,observations,edit.oldText)}:{})});
    if (view.matches.length > 1 && !edit.replaceAll) failWith('edit_text_ambiguous',{edit:index,matches:view.matches.length,lines:view.matches.map(match=>lineOf(file.content,match.start))});
    return view.matches.map(match=>{
      observations.require(file, lineOf(file.content,match.start), lineOf(file.content,Math.max(match.start,match.end - 1)));
      return {start: match.start, end: match.end, text: view.replace(match)};
    });
  }).sort((a, b) => a.start - b.start);
  if (changes.some((change, index) => index && change.start < changes[index - 1].end)) fail('edits_overlap');
  let content = file.content;
  for (const change of changes.reverse()) content = content.slice(0, change.start) + change.text + content.slice(change.end);
  if (hash(content) === file.hash) fail('edit_no_change');
  return content;
}

export function summarizeDiff(before, after) {
  // Bounded work: a large rewrite may be reviewable even if the count is unknown.
  const parts = diffLines(before, after, {timeout: 100, maxEditLength: 5000});
  if (!parts) return {state: 'unavailable'};
  return {state: 'counted', added: parts.filter(p => p.added).reduce((sum, p) => sum + p.count, 0), removed: parts.filter(p => p.removed).reduce((sum, p) => sum + p.count, 0)};
}

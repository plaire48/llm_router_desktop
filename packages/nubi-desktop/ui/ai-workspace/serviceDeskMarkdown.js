// Text transformations are separate from rendering and attachment persistence.
export const markdownLabel = value => String(value).replace(/[\\\[\]]/g,'\\$&').replace(/[\r\n]/g,' ');
export function safeEditorUrl(value) {
  try { const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null; } catch {return null;}
}
export function editMarkdown(value,start,end,action) {
  const text=value.slice(start,end),lineStart=start===0?0:value.lastIndexOf('\n',start-1)+1;
  let insert,from=start,to=end,select;
  if(['bold','italic','strike','code'].includes(action)) {
    const wrap={bold:'**',italic:'_',strike:'~~',code:'`'}[action],label=text||'텍스트';
    const marker=action==='code'?'`'.repeat(Math.max(1,...(label.match(/`+/g)||[]).map(run=>run.length+1))):wrap;
    insert=marker+label+marker;select=[from+marker.length,from+marker.length+label.length];
  } else if(action==='codeBlock') {
    const fence='`'.repeat(Math.max(3,...(text.match(/`+/g)||[]).map(x=>x.length+1)));
    const label=text||'코드를 입력하세요';insert=`\n${fence}\n${label}\n${fence}\n`;select=[from+fence.length+2,from+fence.length+2+label.length];
  } else {
    from=lineStart;to=end;const lines=value.slice(from,to).split('\n');
    const prefix={heading:'## ',quote:'> ',list:'- ',checklist:'- [ ] '}[action];
    if(action==='ordered')insert=lines.map((line,i)=>`${i+1}. ${line||'항목'}`).join('\n');
    else if(prefix)insert=lines.map(line=>prefix+line.replace(action==='heading'?/^#{1,6}\s/:/^$/,'')+(line?'':'항목')).join('\n');
    else return {value,start,end};
    select=[from,from+insert.length];
  }
  return {value:value.slice(0,from)+insert+value.slice(to),start:select[0],end:select[1]};
}
const tableCell = value => String(value).trim().replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\r?\n/g,'<br>');
export function markdownTable(rows) {
  if(!Array.isArray(rows)||!rows.length)return '';
  const width=Math.max(...rows.map(row=>row.length));
  if(width<1||width>12||rows.length>100)throw Error('표는 12열, 100행까지 붙여넣을 수 있습니다.');
  const line=row=>'| '+Array.from({length:width},(_,i)=>tableCell(row[i]??'')).join(' | ')+' |';
  return [line(rows[0]),line(Array(width).fill('---')),...rows.slice(1).map(line)].join('\n');
}
export function tsvTable(value) {
  if(!value.includes('\t'))return null;
  const rows=value.replace(/\r\n/g,'\n').trimEnd().split('\n').map(line=>line.split('\t'));
  return rows.length>1?markdownTable(rows):null;
}

const column=n=>{let s='';for(;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const range=text=>{const m=/^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(String(text));if(!m)return null;const c=s=>[...s.toUpperCase()].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0),a={r:+m[2],c:c(m[1])},b={r:+(m[4]||m[2]),c:c(m[3]||m[1])};return a.r<=b.r&&a.c<=b.c&&b.r<=1048576&&b.c<=16384?{r1:a.r,c1:a.c,r2:b.r,c2:b.c}:null;};
export function nativeExcelBindings(observation){
 const handles=new Map([['document',{kind:'book'}]]);
 function resolve(s){
  const names=[...(s.target??'document').split('.').slice(1),...String(s.member).split('.')],args=[...s.args??[]];let o=handles.get((s.target??'document').split('.')[0]);
  if(!o)return null;
  for(let i=0;i<names.length;i++){
   const member=names[i],last=i===names.length-1;
   if(o.kind==='book'&&['Sheets','Worksheets'].includes(member)){o={kind:'sheets'};continue;}
   if(o.kind==='sheets'&&member==='Item'){const id=args.shift();if(!['number','string'].includes(typeof id))return null;o={kind:'sheet',sheet:id};continue;}
   if(o.kind==='sheet'&&member==='Range'){const r=range(args.shift());if(!r)return null;o={kind:'range',sheet:o.sheet,range:r};continue;}
   if(o.kind==='sheet'&&member==='Cells'){o={kind:'cells',sheet:o.sheet};continue;}
   if(o.kind==='cells'&&member==='Item'){const r=args.shift(),c=args.shift();if(!Number.isInteger(r)||!Number.isInteger(c)||r<1||c<1||r>1048576||c>16384)return null;o={kind:'range',sheet:o.sheet,range:{r1:r,r2:r,c1:c,c2:c}};continue;}
   if(last)return {...o,property:member};
   if(o.kind==='range'&&['Font','Interior','Borders'].includes(member)){o={...o,kind:'format'};continue;}
   return null;
  }
  return o;
 }
 const records=[];for(let i=0;i<(observation?.steps?.length||0);i++){const step=observation.steps[i],value=observation.results?.[i],resolved=resolve(step);if(!resolved)continue;records.push({...resolved,step,value});if(value&&typeof value==='object'&&typeof value.reference==='string'){handles.set(value.reference,resolved);if(step.id)handles.set(step.id,resolved);}}
 return {records,resolve};
}

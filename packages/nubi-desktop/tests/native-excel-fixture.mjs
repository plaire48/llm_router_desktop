// Stateful native session double. Golden formulas are evaluated by explicit
// independent arithmetic, not by the product's Univer calculator.
export function nativeExcelFixture(sheets){
 const data=sheets.map(s=>({...s,cells:structuredClone(s.cells)})),handles=new Map([['document',{kind:'book'}]]);let writes=0,calculations=0;const calls=[];
 const sheet=id=>data.find(s=>s.id===id||s.name===id),column=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0),label=n=>n?label(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'',range=s=>{const m=/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(s);if(!m)throw Error('fixture address');return {r1:+m[2],r2:+(m[4]||m[2]),c1:column(m[1]),c2:column(m[3]||m[1])};};
 function resolve(step){let o=handles.get(step.target||'document');const args=[...step.args||[]];for(const n of step.member.split('.')){if(o.kind==='book'&&['Worksheets','Sheets'].includes(n))o={kind:'sheets'};else if(o.kind==='sheets'&&n==='Item')o={kind:'sheet',sheet:sheet(args.shift())};else if(o.kind==='sheet'&&n==='Range')o={kind:'range',sheet:o.sheet,range:range(args.shift())};else o={...o,property:n};}return o;}
 function read(step){const o=resolve(step);if(step.id){handles.set(step.id,o);return {reference:step.id};}if(o.kind==='sheet'&&o.property==='Name')return o.sheet.name;if(o.kind!=='range')throw Error('fixture getter '+step.member);
  const {r1,r2,c1,c2}=o.range,rows=[];for(let r=r1;r<=r2;r++){const row=[];for(let c=c1;c<=c2;c++){const address=label(c)+r,cell=o.sheet.cells[address]||{value:null};row.push(o.property==='Formula'?cell.formula??cell.value??null:cell.formula?o.sheet.evaluate(cell.formula,o.sheet.cells,address,data):cell.value??null);}rows.push(row);}return r1===r2&&c1===c2?rows[0][0]:rows;
 }
 return {get writes(){return writes;},get calculations(){return calculations;},data,calls,async call(name,input){calls.push({name,input:structuredClone(input)});if(name==='inspect_office')return {snapshotId:'excel-fixture',results:input.steps.map(read)};if(name==='calculate_office'){calculations++;return {status:'calculated',calculationDone:true};}
  writes++;for(const step of input.steps){if(step.action==='get'){read(step);continue;}const o=resolve(step),{r1,r2,c1,c2}=o.range;for(let r=r1;r<=r2;r++)for(let c=c1;c<=c2;c++){const value=Array.isArray(step.value)?step.value[r-r1][c-c1]:step.value;o.sheet.cells[label(c)+r]=o.property==='Formula'&&typeof value==='string'&&value.startsWith('=')?{formula:value}:{value};}}
  return {status:'verified',mutated:true,completedWrites:input.steps.filter(s=>s.action==='set').length,writeResultUncertain:false,saved:false,checks:input.checks.map(c=>({passed:JSON.stringify(read(c.read))===JSON.stringify(c.equals)}))};
 }};
}

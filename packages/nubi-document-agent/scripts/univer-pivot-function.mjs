// Resolve visible pivot output using the original GenOffice layout predicates.
// Read saved/current pivot cells; never recompute source data behind a stale pivot.
export function pivotResultPosition(definition,request,api){
 if(definition.unsupported.length)return null;
 const area=api.parseRange(definition.outputRef);if(definition.rowLines.length!==area.endRow-area.startRow+1-definition.firstDataRow||definition.colLines.length!==area.endColumn-area.startColumn+1-definition.firstDataCol)return null;
 const equal=(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),measure=definition.dataFields.findIndex(f=>equal(f.name,request.dataField)||equal(definition.fields[f.field]?.name,request.dataField));if(measure<0)return null;
 const requested=new Map();for(const [field,item]of request.items){const index=definition.fields.findIndex(f=>equal(f.name,field));if(index<0||requested.has(index))return null;requested.set(index,api.groupKey(item));}
 for(const page of definition.pageFields){if(requested.has(page.field)){const item=page.item===null?undefined:definition.fields[page.field]?.sharedItems[page.item];if(item===undefined||api.groupKey(item)!==requested.get(page.field))return null;requested.delete(page.field);}}
 const matches=[];for(const [row,r]of definition.rowLines.entries())for(const [column,c]of definition.colLines.entries()){
  const rp=api.linePredicates(definition,definition.rowFields,r),cp=api.linePredicates(definition,definition.colFields,c),dataField=definition.colFields.includes(-2)?cp.dataField:rp.dataField;if(dataField!==measure)continue;
  const predicates=[...rp.predicates,...cp.predicates];if(predicates.length!==requested.size||predicates.some(p=>requested.get(p.field)!==p.key))continue;matches.push({row,column});
 }
 return matches.length===1?matches[0]:null;
}
export function pivotLookupFunction(api,pivots,getWorkbook){
 return class GetPivotData extends api.BaseFunction{
  minParams=2;maxParams=254;needsReferenceObject=true;
  calculate(dataField,pivot,...pairs){
   const error=()=>api.ErrorValueObject.create(api.ErrorType.REF),value=arg=>arg?.isReferenceObject?.()?arg.getFirstCell():arg;
   if(pairs.length%2||!pivot?.isReferenceObject?.())return error();const field=value(dataField);if(field?.isError?.())return field;const position=pivot.getRangePosition(),sheetId=pivot.getSheetId(),items=[];
   for(let i=0;i<pairs.length;i+=2){const f=value(pairs[i]),v=value(pairs[i+1]);if(f?.isError?.())return f;if(v?.isError?.())return v;items.push([f?.getValue(),v?.getValue()]);}
   const found=pivots.filter(p=>p.sheetId===sheetId&&position.startRow>=p.area.startRow&&position.startRow<=p.area.endRow&&position.startColumn>=p.area.startColumn&&position.startColumn<=p.area.endColumn);if(found.length!==1)return error();
   const p=found[0],coordinate=pivotResultPosition(p.definition,{dataField:field?.getValue(),items},api);if(!coordinate)return error();const cell=getWorkbook()?.getSheetBySheetId(sheetId)?.getCellRaw(p.area.startRow+p.definition.firstDataRow+coordinate.row,p.area.startColumn+p.definition.firstDataCol+coordinate.column),v=cell?.v;
   return typeof v==='number'?api.NumberValueObject.create(v):v==null?api.NumberValueObject.create(0):error();
  }
 };
}

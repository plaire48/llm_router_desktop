// Function compatibility markers are syntax. A quoted XML/text/sheet name is data.
export function normalizeExcelFormula(value){
 if(typeof value!=='string')return value;
 let result='',quote=null;value=value.replace(/^=/,'');
 for(let i=0;i<value.length;i++){
  const c=value[i];
  if(quote){result+=c;if(c===quote){if(value[i+1]===quote){result+=value[++i];}else quote=null;}continue;}
  if(c==='"'||c==="'"){quote=c;result+=c;continue;}
  if(value.slice(i,i+6).toLowerCase()==='_xlfn.'){i+=5;continue;}
  result+=c;
 }
 return result;
}

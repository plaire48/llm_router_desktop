import {mkdir,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {createExcelDocument} from '../dist/excel.js';
const output=resolve(process.argv[2]??'artifacts/formula-wave-1');await mkdir(output,{recursive:true});
const cell=value=>({value,formula:null,role:'body',format:'general'}),signal=new AbortController().signal;
const fixtures=[];
for(const [name,n,zero]of [['base',1,false],['scaled',3,false],['zero',0,true]]){
 const f=[['SUM','SUM(B2:B4)',60*n],['IF','IF(SUM(B2:B4)=0,0,B4/SUM(B2:B4))',zero?0:.5],['COUNTIF','COUNTIF(A2:A4,"완료")',zero?0:2],['COUNTIFS',`COUNTIFS(A2:A4,"완료",B2:B4,">=${20*n||20}")`,zero?0:1],['SUMIF','SUMIF(A2:A4,"완료",B2:B4)',40*n],['SUMIFS',`SUMIFS(B2:B4,A2:A4,"완료",B2:B4,">=${20*n||20}")`,30*n],['ROUND','ROUND(-10.125,2)',-10.13],['IFERROR','IFERROR(1/0,-1)',-1],['VLOOKUP','VLOOKUP("進行",C2:D4,2,FALSE)',20*n],['INDEX','INDEX(B2:B4,MATCH("進行",C2:C4,0))',20*n],['MATCH','MATCH("進行",C2:C4,0)',2],['DATE','DATE(2024,2,29)',45351],['TEXT','TEXT(DATE(2024,2,29),"yyyy-mm-dd")','2024-02-29'],['lookup-missing','IFERROR(VLOOKUP("없음",C2:D4,2,FALSE),-1)',-1],['quoted-sheet-range',"SUM('참조 자료'!A1:A3)",12*n]];
 const rows=Array.from({length:f.length+1},()=>Array.from({length:6},()=>cell(null)));
 ['상태','금액','검색 키','검색 값','계산 항목','결과'].forEach((h,c)=>rows[0][c]=cell(h));
 for(let i=1;i<=3;i++){rows[i][0]=cell(zero?'미입력':i===2?'진행':'완료');rows[i][1]=cell(10*n*i);rows[i][2]=cell(['完了','進行','保留'][i-1]);rows[i][3]=cell(10*n*i);}
 f.forEach(([label,formula],i)=>{rows[i+1][4]=cell(label);rows[i+1][5]={...cell(null),formula,format:label==='DATE'?'date':'general'};});
 const draft={title:'계산 기능 검토',sheets:[{name:'계산',columnWidths:[18,14,16,14,26,24],rows},{name:'참조 자료',columnWidths:[20],rows:[2*n,4*n,6*n].map(v=>[cell(v)])}]};
 const result=await createExcelDocument(draft,signal,{fontFamily:'Apple SD Gothic Neo'}),path=join(output,name+'.xlsx');await writeFile(path,result.bytes,{flag:'wx'});
 fixtures.push({name,path,expected:f.map(([feature,formula,value],i)=>({feature,address:`F${i+2}`,formula,value}))});
}
await writeFile(join(output,'contracts.json'),JSON.stringify({kind:'fixed_formula_contracts',modelMeasured:false,actualOffice2016:false,fixtures},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({workbooks:fixtures.length,checks:fixtures.reduce((n,f)=>n+f.expected.length,0)}));

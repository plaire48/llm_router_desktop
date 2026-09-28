// Evaluation-only calculator for the simulated Excel host. The model is rebuilt
// from the cell inputs on every call, so no calculator state can drift from the
// workbook that owns the cells. This is NOT Excel 2016: results are simulated.
import {createRequire} from 'node:module';
const {Model}=createRequire(import.meta.url)('@ironcalc/nodejs');
const ERROR_TYPE=16;

export function calculate(sheets){
  const model=new Model('workbook','en','UTC','en');
  sheets.forEach((sheet,index)=>index?model.addSheet(sheet.name):model.renameSheet(0,sheet.name));
  const rejected=new Set();
  sheets.forEach((sheet,index)=>{for(const cell of sheet.cells){
    const {row,column,value,formula}=cell;
    try{
      if(typeof formula==='string')model.updateCellWithFormula(index,row,column,formula);
      else if(typeof value==='number')model.updateCellWithNumber(index,row,column,value);
      else if(typeof value==='boolean')model.updateCellWithBool(index,row,column,value);
      else if(typeof value==='string')model.updateCellWithText(index,row,column,value);
      else continue;
      if(cell.numberFormat&&cell.numberFormat!=='General'){const style=model.getCellStyle(index,row,column);style.num_fmt=cell.numberFormat;model.setCellStyle(index,row,column,style);}
    }catch{rejected.add(`${index}:${row}:${column}`);}
  }});
  model.evaluate();
  return sheets.map((sheet,index)=>{
    const results=new Map();
    for(const {row,column,value,formula} of sheet.cells){
      if(formula===null&&value===null)continue;
      const key=`${row}:${column}`;
      if(rejected.has(`${index}:${key}`)){results.set(key,{value:'#EXCEL_ERROR',error:true,displayText:'#NAME?'});continue;}
      const failed=model.getCellType(index,row,column)===ERROR_TYPE;
      results.set(key,{value:failed?'#EXCEL_ERROR':model.getCellValue(index,row,column),error:failed,displayText:model.getFormattedCellValue(index,row,column)});
    }
    return results;
  });
}

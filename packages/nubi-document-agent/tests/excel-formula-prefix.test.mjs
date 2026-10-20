import test from 'node:test';import assert from 'node:assert/strict';import {normalizeExcelFormula} from '../scripts/excel-formula-prefix.mjs';
test('compatibility marker removal retains literal XML and escaped quotes',()=>{
 assert.equal(normalizeExcelFormula('=_xlfn.FILTERXML("<x>_xlfn.a</x>","/x")'),'FILTERXML("<x>_xlfn.a</x>","/x")');
 assert.equal(normalizeExcelFormula('=IF(TRUE,"a""_xlfn.b",_XLFN.NORM.S.INV(0.5))'),'IF(TRUE,"a""_xlfn.b",NORM.S.INV(0.5))');
 assert.equal(normalizeExcelFormula("='_xlfn.Sheet''s'!A1+_xlfn.CONCAT(\"x\")"),"'_xlfn.Sheet''s'!A1+CONCAT(\"x\")");
});

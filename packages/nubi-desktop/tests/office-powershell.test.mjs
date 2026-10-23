import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOfficeReader} from '../scripts/check-office-reader.mjs';
test('the actual PowerShell reader parses and preserves segment text and primary failures',t=>{
 const result=checkOfficeReader({binary:process.env.NUBI_TEST_POWERSHELL});
 if(result.skipped){t.skip(result.reason);return;}
 assert.equal(result.ok,true);assert.deepEqual(result.checks,['syntax','hresult','primary_error','cleanup_error','segment_assembly','excel_batches','excel_display','excel_array_shapes','excel_progress',...(process.platform==='win32'?['com_reference_lifetime']:[])]);
 assert.equal(result.primary.diagnostic.hresult,'0x8001010A');assert.equal(result.primary.diagnostic.cleanupFailed,true);assert.equal(result.cleanup.error,'document_office_cleanup');
});

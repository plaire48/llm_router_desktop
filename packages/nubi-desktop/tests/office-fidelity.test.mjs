import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {docxCapture} from '../runtime/docx-capture.mjs';
import {gradeCapture,WORD_FEATURES} from '../eval/office-fidelity/features.mjs';

// Office fidelity checklist (사용자 지시 2026-10-21 "워드 먼저 모든 기능 완벽하게"): the Word kitchen-sink file, made by
// eval/office-fidelity/make_fixtures.py, is captured with every listed feature. Excel and PowerPoint follow in 1.3.1.
test('the Word file engine captures every feature of the kitchen-sink document',async()=>{
  const capture=await docxCapture(await readFile(new URL('./fixtures/office-fidelity/synthetic-kitchen-sink.docx',import.meta.url)),{name:'synthetic-kitchen-sink.docx'});
  const result=gradeCapture(capture);
  assert.equal(result.total,WORD_FEATURES.length);
  assert.deepEqual(result.rows.filter(row=>!row.ok).map(row=>row.id),[],'missing Word features');
  assert.ok(capture.assets.length>=2,'pictures are kept as assets');
});

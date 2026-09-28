import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('Office cursor path cannot inject physical pointer or keyboard input',async()=>{
  for(const path of ['Nubi.Office.View/Program.cs','Nubi.Office.Host/OfficeCursorOverlay.cs','Nubi.Office.Host/OfficeView.cs']){
    const source=await readFile(new URL('../native/'+path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/\b(?:SendInput|SetCursorPos|SetPhysicalCursorPos|mouse_event|keybd_event|SendKeys|SetCapture|BlockInput)\s*\(/,path);
    assert.doesNotMatch(source,/Cursor\.Position\s*=/,path);
  }
});

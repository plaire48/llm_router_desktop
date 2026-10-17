import test from 'node:test';
import assert from 'node:assert/strict';
import {terminalReadableText as readable} from '../runtime/terminal-readable-text.mjs';
import {processOutputPreview} from '../runtime/process-output.mjs';

test('plain output retains international text, box drawing, emoji, tabs and blank lines',()=>{
 const text='한글 日本語 résumé Ελληνικά العربية 😀 👩‍💻\n┌──┐\n│ ✓│\n└──┘\n\nA\tB\n';
 assert.equal(readable(text),text);
});
test('color, cursor, OSC hyperlink and terminal string payloads do not leak into chat or copy',()=>{
 const text='\x1b[31mError\x1b[0m\r\n\x1b]8;;https://example.com\x07문서\x1b]8;;\x1b\\\x1b[?25l\x1b[2K\x1bPpayload\x1b\\\x00\x07';
 assert.equal(readable(text),'Error\n문서');
 assert.equal(readable('\u009b32m완료\u009b0m'),'완료');
 assert.equal(readable('\x1b(Babc'),'abc');
});
test('each streaming prefix hides unfinished escape payload and restores following output',()=>{
 const codes=['\x1b[38;2;255;0;0m','\x1b]0;title\x07','\x1b]8;;https://example.com\x1b\\','\x1bPpayload\x1b\\'];
 for(const code of codes)for(let i=1;i<=code.length;i++)assert.equal(readable('前'+code.slice(0,i)),'前');
 for(const code of codes)assert.equal(readable('前'+code+'後'),'前後');
 assert.equal(readable('\x1b]unfinished\nAccess denied'),'\nAccess denied');
 assert.equal(readable('\x1b[한글 오류'),'한글 오류');
});
test('carriage returns preserve progress evidence, CRLF is one line break and backspace keeps Unicode intact',()=>{
 assert.equal(readable('10%\r20%\r100%\r\n\n끝'),'10%\n20%\n100%\n\n끝');
 assert.equal(readable('ab\bc 😀\b✓'),'ac ✓');
});
test('model preview uses readable output without mutating original output or hiding real errors',()=>{
 const raw='\x1b[31mDirUnauthorizedAccessError,Microsoft.PowerShell.Commands.GetChildItemCommand\x1b[0m';
 const record={state:'failed',exitCode:1,output:raw};
 const result=processOutputPreview(record);
 assert.doesNotMatch(result.output,/\x1b/);assert.match(result.output,/DirUnauthorizedAccessError/);
 assert.equal(result.outputDiagnostic.kind,'directory_access_denied');assert.equal(record.output,raw);
});

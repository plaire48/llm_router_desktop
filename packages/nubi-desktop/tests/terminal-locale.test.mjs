// Korean typed or pasted into the interactive terminal vanished while ASCII arrived (2026-10-14): an app started from
// Finder or the Dock has no locale, and bash's readline drops multibyte keys without one. The shell gets a UTF-8
// character type when nothing names one; a user's own locale stays.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {shellEnvironment}=require('../electron-app/terminal-worker.cjs');

test('a shell without a locale gets a UTF-8 character type; a named locale and secrets are handled as before',()=>{
  const mac=shellEnvironment({PATH:'/usr/bin',HOME:'/Users/x',API_KEY:'k',NUBI_STORAGE_ROOT:'/s',ELECTRON_RUN_AS_NODE:'1'},'darwin');
  assert.equal(mac.LC_CTYPE,'UTF-8');assert.equal(mac.LANG,undefined);assert.equal(mac.API_KEY,undefined);assert.equal(mac.NUBI_STORAGE_ROOT,undefined);assert.equal(mac.ELECTRON_RUN_AS_NODE,undefined);
  assert.equal(mac.TERM,'xterm-256color');assert.equal(mac.BASH_SILENCE_DEPRECATION_WARNING,'1');
  assert.equal(shellEnvironment({PATH:'/usr/bin'},'linux').LC_CTYPE,'C.UTF-8');
  const named=shellEnvironment({PATH:'/usr/bin',LANG:'ko_KR.UTF-8'},'darwin');assert.equal(named.LANG,'ko_KR.UTF-8');assert.equal(named.LC_CTYPE,undefined);
  const all=shellEnvironment({PATH:'/usr/bin',LC_ALL:'en_US.utf8'},'darwin');assert.equal(all.LC_CTYPE,undefined);
  const latin=shellEnvironment({PATH:'/usr/bin',LANG:'C'},'darwin');assert.equal(latin.LC_CTYPE,'UTF-8','a locale without UTF-8 still drops multibyte keys');
  const win=shellEnvironment({Path:'C:\\\\Windows'},'win32');assert.equal(win.LC_CTYPE,undefined);assert.equal(win.LANG,undefined);
});

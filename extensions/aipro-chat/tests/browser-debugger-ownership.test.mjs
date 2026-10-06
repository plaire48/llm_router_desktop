import test from 'node:test';
import assert from 'node:assert/strict';
import {ownDebugger,releaseDebuggers,assertDebuggerAvailable,debuggerConnectionFailure} from '../browser-debugger-ownership.js';

test('debugger API capability and attach errors produce fixed safe connection categories', () => {
  globalThis.chrome = {debugger: {}};
  assert.throws(assertDebuggerAvailable, /debugger_unavailable/);
  globalThis.chrome.debugger = {attach() {}, sendCommand() {}};
  assert.doesNotThrow(assertDebuggerAvailable);
  for (const [message, expected] of [
    ['Another debugger is already attached to the tab with id: 42 PRIVATE', 'debugger_conflict'],
    ['Host access is restricted by policy. PRIVATE', 'debugger_policy_blocked'],
    ['Screenshot capture is restricted by policy.', 'debugger_policy_blocked'],
    ["Protocol error: method 'Page.getFrameTree' wasn't found PRIVATE", 'debugger_protocol_unsupported'],
    ['PRIVATE unrecognized attach failure', 'debugger_attach_failed'],
  ]) {
    const failure = debuggerConnectionFailure(new Error(message));
    assert.equal(failure.message, expected); assert.equal(failure.phase, 'debugger_attach'); assert.equal(failure.actionIssued, false);
    assert(!JSON.stringify(failure).includes('PRIVATE'));
  }
  assert.equal(debuggerConnectionFailure(new Error('lost target'), true).message, 'debugger_disconnected');
  const cancelled = new Error('cancelled'); assert.equal(debuggerConnectionFailure(cancelled), cancelled);
});

test('restart cleanup detaches only persisted request-owned tabs and tolerates closed targets',async()=>{
  let state={},detached=[];
  globalThis.chrome={storage:{session:{get:async()=>structuredClone(state),set:async value=>{Object.assign(state,structuredClone(value));}}},debugger:{detach:async({tabId})=>{detached.push(tabId);if(tabId===2)throw Error('already closed');}}};
  await Promise.all([ownDebugger('old',1),ownDebugger('old',2),ownDebugger('new',3)]);
  await releaseDebuggers('old');
  assert.deepEqual(detached,[1,2]);assert.deepEqual(state.browserDebuggerOwners,[{requestId:'new',tabId:3}]);
  await releaseDebuggers('missing');assert.deepEqual(detached,[1,2]);
  await releaseDebuggers();assert.deepEqual(detached,[1,2,3]);assert.deepEqual(state.browserDebuggerOwners,[]);
});

test('a stale request cannot release a tab now owned by another request',async()=>{
  let state={},detached=[];
  globalThis.chrome={storage:{session:{get:async()=>structuredClone(state),set:async value=>{Object.assign(state,structuredClone(value));}}},debugger:{detach:async({tabId})=>detached.push(tabId)}};
  await ownDebugger('old',4);await ownDebugger('new',4);await releaseDebuggers('old',4);
  assert.deepEqual(detached,[]);assert.deepEqual(state.browserDebuggerOwners,[{requestId:'new',tabId:4}]);
  await releaseDebuggers('new',4);assert.deepEqual(detached,[4]);
});

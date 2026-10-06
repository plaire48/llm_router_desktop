import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChat} from '../src/api.js';
import {IMAGE_MODEL_WAIT_POLICY} from '../model-recovery.js';

const flush = async () => {for (let i = 0; i < 40; i++) await Promise.resolve();};

test('silent image inference stops once at its idle deadline and closes progress even when fetch ignores abort', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  t.mock.timers.enable({apis: ['setTimeout']});
  const textModel = {name: 'GLM-5.2-NVFP4'}, vision = {name: 'QWEN3.8-27B-FP8-256K'};
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}, catalog: {credentialReceivedAt: 1, models: [textModel, vision]}})}}};
  let ready, finish, requestSignal, requests = 0;
  const started = new Promise(resolve => {ready = resolve;});
  globalThis.fetch = async (_, init) => {
    requests++; requestSignal = init.signal; ready();
    return new Promise(resolve => {finish = resolve;});
  };
  const steps = [], outputs = [];
  const run = completeChat({provider: 'aipro', credentialReceivedAt: 1, modelId: textModel.name, model: textModel,
    messages: [{role: 'user', content: [{type: 'text', text: '화면을 확인해 줘.'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,aGVsbG8='}}]}]},
    new AbortController().signal, value => outputs.push(value), undefined, undefined, undefined, undefined, step => steps.push(step));
  const rejected = assert.rejects(run, /model_timeout/);
  await started; await flush();
  t.mock.timers.tick(IMAGE_MODEL_WAIT_POLICY.slowMs + 1); await flush();
  assert(steps.some(step => step.tool === 'wait_model' && step.status === 'running'));
  t.mock.timers.tick(IMAGE_MODEL_WAIT_POLICY.idleMs - IMAGE_MODEL_WAIT_POLICY.slowMs); await flush();
  await rejected;
  assert.equal(requests, 1); assert.equal(requestSignal.aborted, true);
  assert(!steps.some(step => step.tool === 'image_model'));
  assert.equal(steps.filter(step => step.tool === 'wait_model').at(-1).status, 'error');
  finish(Response.json({choices: [{message: {content: 'late answer'}, finish_reason: 'stop'}]}));
  await flush(); t.mock.timers.tick(300000); await flush();
  assert.equal(requests, 1);
  assert(!outputs.some(text => text.includes('late answer')));
  assert(!steps.some(step => step.tool === 'image_model'));
});

test('active image inference survives the image idle limit without losing image evidence or retrying', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  t.mock.timers.enable({apis: ['setTimeout']});
  const vision = {name: 'QWEN3.8-27B-FP8-256K'};
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  let stream, ready, requests = 0;
  const started = new Promise(resolve => {ready = resolve;});
  globalThis.fetch = async (_, init) => {
    requests++;
    assert(JSON.parse(init.body).messages.some(message => message.content?.some?.(part => part.type === 'image_url')));
    return new Response(new ReadableStream({start(controller) {stream = controller; ready();}}), {headers: {'content-type': 'text/event-stream'}});
  };
  const run = completeChat({provider: 'aipro', credentialReceivedAt: 1, modelId: vision.name, model: vision,
    messages: [{role: 'user', content: [{type: 'text', text: '화면을 확인해 줘.'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,aGVsbG8='}}]}]}, new AbortController().signal);
  await started; await flush();
  const send = data => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
  for (let i = 0; i < 8; i++) {
    t.mock.timers.tick(10000); send({choices: [{delta: {content: '확인 '}}]}); await flush();
  }
  send({choices: [{delta: {}, finish_reason: 'stop'}]});
  stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); stream.close();
  assert.equal(await run, '확인 '.repeat(8)); assert.equal(requests, 1);
});

test('a long active SSE response creates no wait rows; a real silent interval settles on the next delta', async t => {
  const oldChrome = globalThis.chrome, oldFetch = globalThis.fetch;
  t.after(() => {globalThis.chrome = oldChrome; globalThis.fetch = oldFetch;});
  t.mock.timers.enable({apis: ['setTimeout']});
  globalThis.chrome = {storage: {session: {get: async () => ({credential: {provider: 'aipro', token: 'synthetic', mode: 'browser', receivedAt: 1}})}}};
  let stream, ready, requests = 0;
  const started = new Promise(resolve => {ready = resolve;});
  globalThis.fetch = async () => {
    requests++;
    return new Response(new ReadableStream({start(controller) {stream = controller; ready();}}), {headers: {'content-type': 'text/event-stream'}});
  };
  const steps = [], text = [];
  const request = {provider: 'aipro', credentialReceivedAt: 1, modelId: 'qwen3.8-27b', messages: [{role: 'user', content: '간단히 설명해 줘.'}]};
  const run = completeChat(request, new AbortController().signal, value => text.push(value), undefined, undefined, undefined, undefined, step => steps.push(step));
  await started; await flush();
  const send = payload => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
  for (let i = 0; i < 8; i++) {
    t.mock.timers.tick(10000);
    send({choices: [{delta: {content: '응답 '}}]});
    await flush();
  }
  assert.equal(steps.filter(step => step.tool === 'wait_model').length, 0);
  assert.equal(text.at(-1), '응답 '.repeat(8));
  t.mock.timers.tick(16000); await flush();
  assert.deepEqual(steps.filter(step => step.tool === 'wait_model').map(step => step.status), ['running']);
  send({choices: [{delta: {content: '계속'}}]}); await flush();
  assert.deepEqual(steps.filter(step => step.tool === 'wait_model').map(step => step.status), ['running', 'done']);
  assert.equal(steps[0].index, steps[1].index, 'The same actual wait is closed, not a new completed item');
  send({choices: [{delta: {}, finish_reason: 'stop'}]});
  stream.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); stream.close();
  assert.equal(await run, '응답 '.repeat(8) + '계속');
  assert.equal(requests, 1, 'Presentation changes must never increase model requests');
  assert.equal(steps.length, 2, 'Finish does not duplicate the already settled wait');
});

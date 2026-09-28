import 'core-js/stable';
import 'whatwg-fetch';
import { readSelection, readSnapshot, makeInput, applyPlan } from './excel.js';

const $ = id => document.getElementById(id);
let csrf, connected = false, busy = false, ready = false, polling, statusData;
let activeRun, stopRequested = false, history = [], messages = [], chats = [], draftId = Date.now();
let noticeTimer;
const toolLabels = { read_selection: '선택한 셀 읽기', apply_changes: '셀 수정 · 결과 확인', verify_selection: '결과 다시 읽기', ask_user: '추가 정보 확인' };
function mascot(mood) { for (const mark of document.querySelectorAll('.agent-mark')) mark.setAttribute('data-mood', mood); }
function hideNoticeLater() { clearTimeout(noticeTimer); if (!$('status').classList.contains('error')) noticeTimer = setTimeout(() => { if (!busy) $('status').hidden = true; }, 3000); }
function notice(text, error = false) { clearTimeout(noticeTimer); $('status').hidden = false; $('status').textContent = text; $('status').className = `status${error ? ' error' : ''}`; if (!busy && !error) hideNoticeLater(); }
function settings(open) { $('settings').hidden = !open; $('settings-toggle').setAttribute('aria-expanded', String(open)); updateMotion(); if (open) $('login').focus(); else $('settings-toggle').focus(); }
function updateMotion() { document.querySelector('.app').setAttribute('data-motion', document.hidden || !$('settings').hidden || document.activeElement === $('request') ? 'paused' : 'running'); }
document.addEventListener('visibilitychange', updateMotion); $('request').addEventListener('focus', updateMotion); $('request').addEventListener('blur', updateMotion);
function controls() {
  $('submit').disabled = busy || !ready || !connected;
  for (const id of ['model', 'login', 'disconnect', 'settings-toggle', 'refresh-selection', 'mode', 'new-chat', 'history-toggle']) $(id).disabled = busy || (id === 'model' && !connected);
  $('submit').hidden = busy; $('stop').hidden = !busy;
  $('request-form').setAttribute('aria-busy', String(busy));
}
async function api(path, data) {
  const response = await fetch(`/api/${path}`, data === undefined ? { credentials: 'same-origin', cache: 'no-store' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-AIPro-Session': csrf }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '연결 요청에 실패했습니다.');
  return result;
}
function renderConnection(data) {
  statusData = data; if (data.csrf) csrf = data.csrf;
  connected = data.connected;
  $('connection-label').textContent = connected ? data.mode === 'cli' ? 'AI Pro CLI · 설정됨' : 'AI Pro · 연결됨' : '연결 필요';
  $('disconnect').hidden = !connected;
  $('cancel-login').hidden = data.loginState !== 'waiting'; $('login').hidden = data.loginState === 'waiting';
  const select = $('model'); select.textContent = '';
  for (const model of data.models) { const option = document.createElement('option'); option.value = model.id; option.textContent = model.label; select.appendChild(option); }
  if (!data.models.length) { const option = document.createElement('option'); option.textContent = '모델 선택'; select.appendChild(option); }
  if (data.model) select.value = data.model;
  controls();
}
async function refreshSelection() {
  if (!ready || busy) return;
  try { const selection = await readSelection(); $('scope-label').textContent = `${selection.worksheet}!${selection.address}`; }
  catch (error) { $('scope-label').textContent = '하나의 연속 범위를 선택하세요'; notice(error.message || '선택 범위를 읽지 못했습니다.', true); }
}
function message(role, content, label, record = true) {
  $('welcome').hidden = true;
  const article = document.createElement('article'); article.className = `message ${role} message-${role}`;
  const title = document.createElement('span'); title.className = 'label'; title.textContent = label;
  const text = document.createElement('div'); text.className = 'message-body'; text.textContent = content;
  article.appendChild(title); article.appendChild(text); $('conversation').appendChild(article);
  if (record) messages.push({ role, content, label });
  $('conversation').scrollTop = $('conversation').scrollHeight;
  return { article, text, title };
}
function renderTrace(steps) {
  $('trace-panel').hidden = !steps.length; $('trace-list').textContent = '';
  for (const step of steps) { const item = document.createElement('li'); item.setAttribute('data-state', step.status); item.textContent = `${step.status === 'done' ? '✓' : step.status === 'error' ? '!' : step.status === 'running' ? '·' : '–'} ${toolLabels[step.tool] || step.tool}`; $('trace-list').appendChild(item); }
}
function saveChat() {
  if (!messages.length && !$('request').value.trim()) return;
  const item = { id: draftId, messages: messages.slice(), history: history.slice(), draft: $('request').value };
  chats = [item, ...chats.filter(chat => chat.id !== draftId)].slice(0, 10);
}
function showChat(chat) {
  for (const item of document.querySelectorAll('.message')) item.parentNode.removeChild(item);
  messages = []; history = chat ? chat.history.slice() : []; draftId = chat ? chat.id : Date.now();
  $('request').value = chat ? chat.draft : ''; $('welcome').hidden = !!chat?.messages.length; renderTrace([]);
  for (const item of chat?.messages || []) message(item.role, item.content, item.label);
  $('history-panel').hidden = true; $('history-toggle').setAttribute('aria-expanded', 'false'); $('request').focus();
}
$('new-chat').onclick = () => { saveChat(); showChat(null); notice('새 대화를 시작했습니다.'); };
$('history-toggle').onclick = () => {
  saveChat(); const open = $('history-panel').hidden; $('history-panel').hidden = !open; $('history-toggle').setAttribute('aria-expanded', String(open)); $('history-list').textContent = '';
  for (const chat of chats) { const button = document.createElement('button'); button.className = 'history-item'; button.textContent = (chat.messages[0]?.content || chat.draft).slice(0, 70); button.onclick = () => { saveChat(); showChat(chat); }; $('history-list').appendChild(button); }
  if (!chats.length) $('history-list').textContent = '아직 대화가 없습니다.';
};
$('history-close').onclick = () => { $('history-panel').hidden = true; $('history-toggle').setAttribute('aria-expanded', 'false'); $('history-toggle').focus(); };
$('trace-toggle').onclick = () => { $('trace-list').hidden = !$('trace-list').hidden; $('trace-toggle').setAttribute('aria-expanded', String(!$('trace-list').hidden)); };
async function pollLogin() {
  clearTimeout(polling);
  try {
    const data = await api('session'); renderConnection(data);
    if (data.loginState === 'waiting') { polling = setTimeout(pollLogin, 1200); return; }
    if (data.connected) { settings(false); notice('AI Pro에 연결했습니다. 셀을 선택하고 요청하세요.'); }
    else if (data.loginState === 'failed') notice(data.loginError, true);
  } catch { notice('연결 서버가 종료되었거나 응답하지 않습니다. 실행 창을 확인하세요.', true); }
}
$('settings-toggle').onclick = () => settings($('settings').hidden);
$('settings-close').onclick = () => settings(false);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('settings').hidden) settings(false); });
$('cli-toggle').onclick = () => { const open = $('cli-form').hidden; $('cli-form').hidden = !open; $('cli-toggle').setAttribute('aria-expanded', String(open)); if (open) $('base-url').focus(); };
$('login').onclick = async () => {
  $('login').disabled = true; notice('브라우저에서 AI Pro 로그인을 완료하세요.');
  try { renderConnection(await api('login', {})); pollLogin(); } catch (error) { notice(error.message, true); controls(); }
};
async function disconnect() { clearTimeout(polling); try { renderConnection(await api('disconnect', {})); notice('연결을 해제했습니다.'); } catch (error) { notice(error.message, true); } }
$('disconnect').onclick = disconnect; $('cancel-login').onclick = disconnect;
$('cli-form').onsubmit = async event => {
  event.preventDefault(); const button = $('cli-form').querySelector('button'); button.disabled = true;
  try {
    renderConnection(await api('connect-cli', { baseUrl: $('base-url').value.trim(), token: $('token').value.trim(), model: $('model-id').value.trim() }));
    $('token').value = ''; settings(false); notice('CLI 연결 정보를 저장했습니다. 첫 요청에서 실제 연결을 확인합니다.');
  } catch (error) { notice(error.message, true); } finally { button.disabled = false; }
};
$('model').onchange = async () => { try { renderConnection(await api('model', { model: $('model').value })); } catch (error) { renderConnection(statusData); notice(error.message, true); } };
$('refresh-selection').onclick = refreshSelection;
for (const button of document.querySelectorAll('[data-request]')) button.onclick = () => { $('request').value = button.getAttribute('data-request'); $('mode').value = button.getAttribute('data-mode'); $('request').focus(); };
$('stop').onclick = async () => { stopRequested = true; $('stop').disabled = true; if (activeRun) await api('run-cancel', { id: activeRun }).catch(() => {}); notice('중지하고 있습니다. 이미 적용된 변경은 유지됩니다.'); };
$('request').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $('submit').click(); } });
$('request-form').onsubmit = async event => {
  event.preventDefault(); if (busy || !ready || !connected) return;
  const request = $('request').value.trim(); if (!request) { $('request').focus(); return; }
  busy = true; stopRequested = false; $('stop').disabled = false; controls(); mascot('working'); notice('선택한 셀을 읽고 있습니다.');
  let reply;
  try {
    let snapshot = await readSelection(); const input = makeInput(snapshot, request, $('mode').value);
    $('scope-label').textContent = `${snapshot.worksheet}!${snapshot.address}`;
    message('user', request, `${input.mode === 'edit' ? '셀 수정' : '분석'} · ${snapshot.address}`);
    reply = message('assistant', '', '누비 · 작업 중', false);
    let state = await api('run-start', { input, history }); activeRun = state.id;
    const handled = new Set();
    for (;;) {
      if (stopRequested) { await api('run-cancel', { id: activeRun }).catch(() => {}); throw new Error('작업을 중지했습니다. 이미 적용된 셀 변경은 유지됩니다.'); }
      renderTrace(state.trace);
      if (state.partial) reply.text.textContent = state.partial;
      if (state.state !== 'running') {
        if (state.state !== 'done') throw new Error(state.error || '작업이 중지되었습니다. Excel 셀을 확인하세요.');
        reply.title.textContent = state.writes ? '누비 · 적용 확인' : '누비'; reply.text.textContent = state.answer;
        messages.push({ role: 'assistant', content: state.answer, label: reply.title.textContent });
        history.push({ role: 'user', content: request }, { role: 'assistant', content: state.answer }); history = history.slice(-8);
        $('request').value = ''; notice(state.writes ? `${snapshot.address}에 적용하고 결과를 확인했습니다.` : '셀 변경 없이 답변했습니다.'); mascot('celebrate'); break;
      }
      if (state.action && !handled.has(state.action.callId)) {
        const action = state.action; handled.add(action.callId); notice(`${toolLabels[action.name]} 중…`);
        let result;
        try {
          if (action.name === 'apply_changes') {
            const outcome = await applyPlan(snapshot, action.plan, makeInput(snapshot, request, input.mode));
            snapshot = await readSnapshot(snapshot); result = { ...outcome, snapshot };
          } else { snapshot = await readSnapshot(snapshot); result = { snapshot }; }
        } catch (error) { result = { error: error.message || 'Excel 도구 실행에 실패했습니다.' }; }
        state = await api('run-result', { id: activeRun, callId: action.callId, result });
      } else { await new Promise(resolve => setTimeout(resolve, 400)); state = await api('run-state', { id: activeRun }); }
    }
  } catch (error) {
    notice(error.message || '작업을 완료하지 못했습니다.', true); mascot('sad');
    if (reply) { reply.title.textContent = '누비 · 작업 중단'; reply.text.textContent = error.message; messages.push({ role: 'assistant', content: error.message, label: '누비 · 작업 중단' }); }
    if (activeRun) await api('run-cancel', { id: activeRun }).catch(() => {});
  } finally { activeRun = null; busy = false; controls(); hideNoticeLater(); }
};

const initializationTimer = setTimeout(() => notice('Excel 연결을 기다리고 있습니다. Office 추가 기능에서 열었는지, Office.js에 접속할 수 있는지 확인하세요.', true), 12000);
async function initialize() {
  clearTimeout(initializationTimer);
  if (!window.Office?.context?.requirements?.isSetSupported('ExcelApi', '1.1')) { notice('ExcelApi 1.1을 지원하는 Excel에서 추가 기능을 여세요.', true); return; }
  ready = true;
  try {
    renderConnection(await api('session')); await refreshSelection();
    if (!connected) { notice('AI Pro를 연결하면 선택한 셀에서 작업할 수 있습니다.'); settings(true); }
    else notice('준비되었습니다. 셀을 선택하고 요청하세요.');
    if (statusData.loginState === 'waiting') pollLogin();
  } catch { notice('로컬 연결 서버를 찾을 수 없습니다. 실행 창을 확인하세요.', true); }
  controls();
}
if (window.Office) {
  if (Office.onReady) Office.onReady(initialize); else Office.initialize = initialize;
} else { clearTimeout(initializationTimer); notice('Excel의 내 추가 기능에서 이 화면을 여세요.', true); }

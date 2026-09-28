const $ = selector => document.querySelector(selector);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const views = [...document.querySelectorAll('[role="tabpanel"]')];
function selectTab(name) {
  for (const tab of tabs) { const active = tab.dataset.tab === name; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; }
  for (const view of views) view.hidden = view.id !== `view-${name}`;
  $('.result-area').scrollTop = 0;
}
document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => selectTab(button.dataset.tab)));
tabs.forEach((tab, index) => tab.addEventListener('keydown', event => {
  const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
  if (next !== null) { event.preventDefault(); tabs[next].focus(); selectTab(tabs[next].dataset.tab); }
}));
function chatVisible(visible) {
  document.body.classList.toggle('chat-hidden', !visible);
  document.body.classList.toggle('chat-mobile-open', visible && matchMedia('(max-width:760px)').matches);
  $('#toggle-chat').setAttribute('aria-expanded', String(visible));
  $('#toggle-chat').setAttribute('aria-label', visible ? '누비 패널 접기' : '누비 패널 열기');
  $('#toggle-chat').title = visible ? '누비 패널 접기' : '누비 패널 열기';
}
$('#toggle-chat').addEventListener('click', () => chatVisible(matchMedia('(max-width:760px)').matches ? !document.body.classList.contains('chat-mobile-open') : document.body.classList.contains('chat-hidden')));
$('#close-agent').addEventListener('click', () => chatVisible(false));
$('#dev-layout').addEventListener('click', () => { document.body.classList.remove('review'); chatVisible(true); selectTab('code'); $('#dev-layout').setAttribute('aria-pressed','true'); $('#review-layout').setAttribute('aria-pressed','false'); });
$('#review-layout').addEventListener('click', () => { selectTab('compare'); document.body.classList.add('review'); chatVisible(false); $('#dev-layout').setAttribute('aria-pressed','false'); $('#review-layout').setAttribute('aria-pressed','true'); });
function sample(after) {
 return `<div class="sample"><div class="sample-head"><span class="sample-logo">portal</span><span class="sample-nav">고객 관리 &nbsp; / &nbsp; 검색</span></div><div class="sample-body"><div class="sample-title">고객 검색</div><div class="sample-search"><svg><use href="#i-search"/></svg><span>누비</span></div><div class="sample-filter"><span>전체 부서 ⌄</span><span>진행 중 ⌄</span></div><div class="sample-count">검색 결과 <strong>0</strong>건</div>${after ? '<div class="sample-empty"><svg><use href="#i-search"/></svg><strong>검색 결과가 없어요</strong><p>다른 검색어나 조건으로 찾아보세요.</p><span class="sample-button">필터 초기화</span></div>' : '<div class="blank-space"></div>'}</div></div>`;
}
$('#sample-before').innerHTML = sample(false); $('#sample-after').innerHTML = sample(true); $('#preview-sample').innerHTML = sample(true);
let overlay = false;
function compareMode(value) { $('#comparison .after').style.clipPath = value ? `inset(0 ${100 - Number($('#overlay-range').value)}% 0 0)` : ''; overlay = value; $('#comparison').classList.toggle('overlay',value); $('#overlay-controls').hidden = !value || $('#compare-state').value !== 'ready'; $('#compare-side').setAttribute('aria-pressed',String(!value)); $('#compare-overlay').setAttribute('aria-pressed',String(value)); $('#compare-side').classList.toggle('selected',!value); $('#compare-overlay').classList.toggle('selected',value); }
$('#compare-side').addEventListener('click', () => compareMode(false)); $('#compare-overlay').addEventListener('click', () => compareMode(true));
$('#overlay-range').addEventListener('input', event => { $('#comparison .after').style.clipPath = `inset(0 ${100 - Number(event.target.value)}% 0 0)`; $('#overlay-value').textContent = `${event.target.value}%`; });
$('#compare-state').addEventListener('change', event => {
 const ready = event.target.value === 'ready'; $('#comparison').hidden = !ready; $('.comparison-results').hidden = !ready; $('#compare-error').hidden = ready; $('#overlay-controls').hidden = !ready || !overlay;
 $('#compare-error').innerHTML = event.target.value === 'failed' ? '<strong>수정본 서버를 실행하지 못했어요</strong><p>사용 중인 포트와 실행 로그를 확인한 뒤 다시 연결합니다.<br>이 상태에서는 화면 비교와 검증 통과를 표시하지 않습니다.</p>' : '<strong>비교 기준의 코드가 바뀌었어요</strong><p>현재 코드와 이전 캡처의 기준이 달라 비교를 보류합니다.<br>새 기준으로 캡처한 뒤 이어갑니다.</p>';
});
$('#toggle-log').addEventListener('click', () => { const open = $('#log-content').hidden; $('#log-content').hidden = !open; $('#toggle-log').setAttribute('aria-expanded',String(open)); $('#log-chevron').textContent = open ? '⌄' : '⌃'; });
$('#shell-profile').addEventListener('change', event => {
  const prefix = event.target.value === 'powershell' ? 'PS C:\\work\\portal>' : event.target.value === 'wsl' ? 'wsl:~/work/portal $' : 'git-bash:/c/work/portal $';
  $('#shell-command').textContent = `${prefix} rg -n 'ResultList' src/pages`;
  $('#shell-test').textContent = `${prefix} npm run test -- search`;
  $('#log-content').hidden = false; $('#toggle-log').setAttribute('aria-expanded','true'); $('#log-chevron').textContent = '⌄';
});
const evidence = {
 code: ['요구사항과 소스 연결', '<p>REQ-014의 빈 결과 안내는 결과 렌더링 분기와 연결됩니다.</p><dl><dt>소스</dt><dd><code>src/pages/SearchPage.tsx:13</code></dd><dt>관련 파일</dt><dd><code>src/components/EmptyState.tsx</code></dd><dt>관계</dt><dd>정적 소스 근거 예시. 실제 화면 동작은 별도 검증합니다.</dd></dl>'],
 wiki: ['OpenWiki · 검색과 필터', '<p>검색어와 필터는 결과 목록과 별도로 유지한다. 결과가 0건이더라도 검색 조건을 자동 초기화하지 않는다.</p><dl><dt>문서</dt><dd><code>openwiki/features/search.md:18–24</code></dd><dt>코드 출처</dt><dd><code>src/hooks/useSearch.ts</code></dd><dt>최신성</dt><dd>실제 앱에서는 파일 해시와 revision으로 판정합니다.</dd></dl>'],
 empty: ['AC-01 · 빈 결과 안내', '<p>0건 결과에서 안내 문구와 다음 행동이 보이는지 확인합니다.</p><dl><dt>조건</dt><dd>검색어: 누비 / 결과: 0건</dd><dt>근거 유형</dt><dd>DOM 텍스트 + 화면 캡처</dd><dt>예시 결과</dt><dd>확인됨</dd></dl>'],
 filter: ['AC-02 · 필터 유지와 초기화', '<p>빈 결과 화면에서도 검색 조건이 남아 있고, 초기화 버튼을 직접 실행했을 때만 조건이 바뀌어야 합니다.</p><dl><dt>검사</dt><dd>변경 전후 입력값 대조 + 초기화 후 readback</dd><dt>예시 결과</dt><dd>확인됨</dd><dt>추가 경계</dt><dd>서버 저장 여부는 새로고침/재조회로 별도 확인합니다.</dd></dl>'],
 keyboard: ['AC-03 · 키보드 사용 미확인', '<p>버튼이 보이는 것만으로 키보드 접근을 확인했다고 판단하지 않습니다.</p><dl><dt>남은 검사</dt><dd>Tab 초점 순서 → Enter 실행 → 실제 필터값 확인</dd><dt>예시 결과</dt><dd>미확인</dd><dt>작업 상태</dt><dd>이 조건을 확인하기 전 전체 완료로 바꾸지 않습니다.</dd></dl>']
};
let returnFocus;
function detail(title, content) { returnFocus = document.activeElement; $('#detail-title').textContent = title; $('#detail-body').innerHTML = content; $('#detail-dialog').showModal(); }
document.querySelectorAll('[data-evidence]').forEach(button => button.addEventListener('click', () => detail(...evidence[button.dataset.evidence])));
document.querySelectorAll('[data-info]').forEach(button => button.addEventListener('click', () => { detail('화면 동작 안내','<p></p>'); $('#detail-body p').textContent = button.dataset.info; }));
$('#context-open').addEventListener('click', () => detail('이번 작업의 문맥', '<p>원래 요청과 완료 조건을 보존하고 필요한 근거만 읽습니다.</p><dl><dt>고정</dt><dd>REQ-014 / 완료 조건 3개 / 사용자 제약</dd><dt>현재</dt><dd>선택 파일과 코드 버전 / 최근 실행 결과</dd><dt>참조</dt><dd>Wiki와 소스의 경로·해시·읽은 구간</dd><dt>분석</dt><dd>담당별 독립 문맥 / 읽기 전용 / 최대 2개</dd><dt>압축</dt><dd>큰 읽기는 근거 ID로 바꾸고 쓰기 영수증은 유지</dd></dl>'));
$('#dialog-close').addEventListener('click', () => $('#detail-dialog').close());
$('#detail-dialog').addEventListener('close', () => returnFocus?.focus());
let toastTimer;
$('#composer').addEventListener('submit', event => { event.preventDefault(); $('#toast').textContent = '화면 시안입니다. 입력은 전송하지 않았고 그대로 보관했어요.'; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; },4000); });

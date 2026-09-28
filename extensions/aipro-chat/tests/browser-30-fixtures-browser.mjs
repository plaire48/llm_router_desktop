// Deterministic fixture validation only. These actions are not Nubi performance.
import {chromium} from 'playwright';
import {strict as assert} from 'node:assert';
import {startBrowserFixtures, trainingText} from '../evaluation/browser-fixtures.mjs';
import {createHash} from 'node:crypto';
import {fixtureGrade} from '../evaluation/browser-fixture-grades.mjs';
import {browserTasks30} from '../evaluation/browser-30.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
const server = await startBrowserFixtures();
let browser;
const checks = [];
try {
  browser = await chromium.launch({headless: true});
  const context = await browser.newContext({acceptDownloads: true});
  const page = await context.newPage();
  const gradeReadback = async id => {
    const fixtureState=[];
    for(const [index,frame] of page.frames().entries()) fixtureState.push({frameId:index,documentId:`fixture-document-${index}`,...await frame.evaluate(()=>({url:location.href,
      fields:[...document.querySelectorAll('input,textarea,select')].map(el=>({id:el.id,label:el.labels?.[0]?.textContent,value:el.value})),
      counters:window.evalCounters,toggle:document.querySelector('#toggle')?.getAttribute('aria-checked'),modalOpen:!!document.querySelector('dialog[open]')}))});
    return fixtureGrade(browserTasks30.find(t=>t.id===id),{id,startUrl:server.origin+'/'+id,target:{observed:true,tabId:1},targetPage:{url:page.url()},fixtureState});
  };
  await page.goto(server.origin + '/E-09');
  await page.getByLabel('제목', {exact: true}).fill('가을 교육');
  await page.getByLabel('본문', {exact: true}).fill('개발팀 교육 안내.\n장소는 서울 A입니다.');
  assert.equal(await page.getByLabel('본문', {exact: true}).inputValue(), '개발팀 교육 안내.\n장소는 서울 A입니다.');
  assert.equal(await page.evaluate(() => evalCounters.submits), 0); checks.push('multiline-draft');
  await page.goto(server.origin + '/E-10');
  assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), 'true');
  assert.equal(await page.evaluate(() => evalCounters.toggles), 0); checks.push('already-correct-toggle');
  assert((await gradeReadback('E-10')).checks.every(check=>check.passed));
  await page.getByRole('switch').click();
  assert.deepEqual((await gradeReadback('E-10')).checks.map(check=>check.passed),[false,false]);
  checks.push('grader-rejects-wrong-toggle');
  await page.goto(server.origin + '/M-07');
  await page.frameLocator('iframe').getByLabel('이름').fill('홍길동');
  assert.deepEqual(await page.getByLabel('이름').evaluateAll(fields => fields.map(field => field.value)), ['예시 보존', '담당자 보존']); checks.push('frame-target');
  assert((await gradeReadback('M-07')).checks.every(check=>check.passed));
  await page.getByLabel('이름').first().fill('홍길동');
  assert.equal((await gradeReadback('M-07')).checks[1].passed,false);
  checks.push('grader-rejects-wrong-frame-write');
  await page.goto(server.origin + '/M-08');
  await page.getByRole('button', {name: '신청 설정'}).click();
  await page.getByLabel('참석 유형').selectOption('온라인');
  await page.getByLabel('이메일').fill('demo@example.test');
  assert.equal(await page.getByLabel('현장 메모').inputValue(), '기존 현장 안내');
  assert.equal(await page.locator('dialog').evaluate(el => el.open), true); checks.push('conditional-modal');
  assert((await gradeReadback('M-08')).checks.every(check=>check.passed),JSON.stringify(await gradeReadback('M-08')));
  await page.getByRole('button',{name:'제출',exact:true}).click();
  assert.equal((await gradeReadback('M-08')).checks[3].passed,false);
  checks.push('grader-rejects-unrequested-submit');
  await page.goto(server.origin + '/M-09');
  const rows = [];
  for (let i = 0; i < 3; i++) {
    rows.push(...await page.locator('tbody tr').evaluateAll(rows => rows.map(row => Array.from(row.cells).map(cell => cell.textContent))));
    if (i < 2) await page.getByRole('button', {name: '다음', exact: true}).click();
  }
  assert.equal(rows.filter(row => row[1] === '완료').reduce((sum, row) => sum + Number(row[2]), 0), 14); checks.push('pagination-oracle');
  await page.goto(server.origin + '/M-10');
  await page.getByRole('button', {name: '조회', exact: true}).click();
  await page.getByText('일시 오류입니다. 다시 시도를 눌러 주세요.').waitFor();
  await page.getByRole('button', {name: '다시 시도', exact: true}).click();
  await page.getByText('처리 완료 37건').waitFor();
  assert.equal(await page.evaluate(() => duplicateQueries), 0); checks.push('delayed-recovery');
  await page.goto(server.origin + '/H-07');
  const longText = await page.locator('body').innerText();
  assert.ok(longText.length > 40000);
  for (const [team, days] of [['A', 3], ['B', 5], ['C', 7]]) assert.ok(longText.includes(`${team}팀의 긴급 건은 ${days}일`)); checks.push('long-context-oracle');
  await page.goto(server.origin + '/H-08');
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('link', {name: '교육 안내 파일 다운로드'}).click();
  const download = await pendingDownload;
  assert.equal(download.suggestedFilename(), 'training.txt');
  assert.equal(await download.failure(), null);
  const bytes = await readFile(await download.path());
  assert.equal(bytes.toString(), trainingText); checks.push('download-bytes');
  await page.goto(server.origin + '/H-09');
  await page.getByLabel('자료 파일').setInputFiles({name: 'training.txt', mimeType: 'text/plain', buffer: bytes});
  assert.equal(await page.locator('output').innerText(), `training.txt / ${bytes.length} bytes`);
  assert.equal(await page.evaluate(() => evalCounters.submits), 0); checks.push('file-selection-no-submit');
  await page.goto(server.origin + '/H-10');
  assert.equal(await page.getByLabel('기존 메모').inputValue(), '원본 메모 유지');
  assert.equal(await page.getByLabel('담당 팀').inputValue(), ''); checks.push('clarification-initial-state');
  await mkdir('verification/browser-30', {recursive: true});
  await writeFile('verification/browser-30/fixture-check.json', JSON.stringify({status: 'passed', actualModel: false, scope: 'fixture-validation-only', checks, sampleSha256: createHash('sha256').update(bytes).digest('hex')}, null, 2));
  console.log(`PASS ${checks.length} fixture checks; no model performance measured`);
} finally {await browser?.close(); await server.close();}

// Isolated evaluation pages. This server is never part of the extension bundle.
import {createServer} from 'node:http';
export const trainingText = '누비 교육 안내\n담당 팀: 개발팀\n장소: 서울 A\n';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const shell = body => `<!doctype html><html lang="ko"><meta charset="utf-8"><title>누비 브라우저 평가</title><style>body{font:16px/1.7 sans-serif;max-width:900px;margin:40px auto;color:#172238}label{display:block;margin:16px 0}input,textarea,select,button{font:inherit;padding:8px;margin:8px}textarea{width:80%;height:120px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:12px}iframe{height:240px;width:90%}dialog{min-width:400px}output{display:block}</style><h1>누비 브라우저 평가</h1>${body}<script>window.evalCounters={inputs:0,submits:0,toggles:0};addEventListener('input',()=>evalCounters.inputs++);addEventListener('submit',e=>{e.preventDefault();evalCounters.submits++});</script></html>`;
export function fixtureHtml(id) {
  switch (id) {
    case 'E-09': case 'H-10': return shell(`<form><label>제목<input id="title"></label><label>담당 팀<input id="team"></label><label>본문<textarea id="body"></textarea></label><label>기존 메모<textarea id="memo">원본 메모 유지</textarea></label><button>등록</button></form>`);
    case 'E-10': return shell('<button id="toggle" role="switch" aria-checked="true" onclick="evalCounters.toggles++;this.setAttribute(\'aria-checked\',this.getAttribute(\'aria-checked\')!==\'true\')">알림</button>');
    case 'M-07': return shell('<section aria-label="참고 예시"><label>이름<input value="예시 보존"></label></section><iframe title="신청자 영역" src="/applicant"></iframe><section aria-label="담당자"><label>이름<input value="담당자 보존"></label></section>');
    case 'applicant': return shell('<form aria-label="신청자"><label>이름<input id="applicant"></label><button>등록</button></form>');
    case 'M-08': return shell('<button onclick="document.querySelector(\'dialog\').showModal()">신청 설정</button><dialog><form><h2>참석 설정</h2><label>참석 유형<select onchange="document.querySelector(\'#online\').hidden=this.value!==\'온라인\'"><option>현장</option><option>온라인</option></select></label><div id="online" hidden><label>이메일<input type="email"></label></div><label>현장 메모<textarea>기존 현장 안내</textarea></label><button>제출</button></form></dialog>');
    case 'M-09': return shell('<h2>신청 목록</h2><p id="page"></p><table><thead><tr><th>번호</th><th>상태</th><th>인원</th></tr></thead><tbody></tbody></table><button id="prev">이전</button><button id="next">다음</button><script>const rows=[["A01","완료",2],["A02","대기",8],["A03","완료",4],["A04","취소",9],["A05","완료",3],["A06","완료",5]];let page=0;window.visitedPages=[];function render(){visitedPages.push(page+1);document.querySelector("#page").textContent=(page+1)+" / 3쪽";document.querySelector("tbody").innerHTML=rows.slice(page*2,page*2+2).map(r=>"<tr>"+r.map(v=>"<td>"+v+"</td>").join("")+"</tr>").join("");document.querySelector("#prev").disabled=page===0;document.querySelector("#next").disabled=page===2}document.querySelector("#prev").onclick=()=>{page--;render()};document.querySelector("#next").onclick=()=>{page++;render()};render();</script>');
    case 'M-10': return shell('<button id="query">조회</button><output aria-live="polite">조회 전</output><script>window.queries=0;window.duplicateQueries=0;let pending=false;document.querySelector("#query").onclick=()=>{if(pending){duplicateQueries++;return}queries++;pending=true;const button=document.querySelector("#query"),out=document.querySelector("output");button.disabled=true;out.textContent="조회 중";setTimeout(()=>{pending=false;out.textContent=queries===1?"일시 오류입니다. 다시 시도를 눌러 주세요.":"처리 완료 37건";button.textContent="다시 시도";button.disabled=false},1800)};</script>');
    case 'H-07': return shell('<h2>운영 문서</h2><p>일반 안내는 기본 기한만 설명합니다. 각 부록 끝의 예외 조항이 우선입니다.</p>' + ['A', 'B', 'C'].map((name, i) => `<section><h2>부록 ${name}</h2><p>대상 ${name}팀. 기본 기한 ${(i + 1) * 10}일.</p>${Array.from({length: 180}, (_, n) => `<p>${name}-${n + 1}: 이 항목은 운영 자료의 보관과 정기 점검 절차를 설명합니다. 담당자는 검토 기록과 문서 번호를 남기고 다음 점검 때 이전 기록과 비교합니다.</p>`).join('')}<h3>${name} 부록 말미 예외</h3><p>${name}팀의 긴급 건은 ${[3, 5, 7][i]}일 이내 처리합니다.</p></section>`).join(''));
    case 'H-08': return shell('<a href="/training.txt" download="training.txt">교육 안내 파일 다운로드</a>');
    case 'H-09': return shell('<form><label>자료 파일<input id="file" type="file" accept=".txt"></label><output>파일 미선택</output><button>서버 등록</button></form><script>document.querySelector("#file").onchange=e=>{const f=e.target.files[0];document.querySelector("output").textContent=f?f.name+" / "+f.size+" bytes":"파일 미선택"};</script>');
    default: return null;
  }
}
export async function startBrowserFixtures() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method !== 'GET') {res.writeHead(405); res.end(); return;}
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/training.txt') {
      res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': 'attachment; filename="training.txt"'});
      res.end(trainingText); return;
    }
    const html = fixtureHtml(path.slice(1));
    res.writeHead(html ? 200 : 404, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html || shell(`<p>없는 과제: ${escape(path)}</p>`));
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  return {origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => {server.close(resolve); server.closeAllConnections();})};
}

// Present unmodified browser captures at matching viewport sizes. CSS framing
// focuses the modal; every capture also links to its original full screenshot.
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import path from 'node:path';
const dir=path.resolve('verification/visual-polish-2026-10-15');
await mkdir(path.join(dir,'after'),{recursive:true});
const before=JSON.parse(await readFile(path.join(dir,'before/diagnostic.json'),'utf8'));
const after=JSON.parse(await readFile('verification/all-surfaces/diagnostic.json','utf8'));
for(const record of after)await cp(path.join('verification/all-surfaces',record.file),path.join(dir,'after',record.file));
await cp('verification/all-surfaces/diagnostic.json',path.join(dir,'after/diagnostic.json'));
await cp('verification/all-surfaces/result.json',path.join(dir,'after/result.json'));
const names={skills:'스킬 관리',registration:'스킬 등록',library:'위키 설정',fabrix:'연결 입력 폼',settings:'설정',marketplace:'Team 스킬',usage:'사용량',context:'컨텍스트 사용량',reasoning:'추론 선택',models:'모델 선택',account:'프로필',question:'질문',analysis:'하위 분석',setup:'명령 승인',progress:'백그라운드 진행',applied:'변경 파일'};
const description={skills:'이름과 설명을 같은 시작선으로 맞추고, 아이콘과 관리 버튼을 행 중앙에 정렬했습니다.',registration:'설명을 한 그룹으로 묶고 버튼까지 누적되던 여백을 줄였습니다. 파일과 폴더 선택 동작은 유지합니다.',library:'내부의 이중 패딩을 없애고 제목과 설명의 글자 위계를 분리했습니다.',fabrix:'필드 이름은 500 굵기로 낮춰 600 굵기의 제목과 주요 동작이 먼저 보이게 했습니다.'};
const rows=after.filter(row=>row.file&&before.some(b=>b.name===row.name)).map(row=>({name:row.name,before:before.find(b=>b.name===row.name),after:row}));
const highlights=['skills-1280','registration-1280','library-1280','fabrix-1280','skills-440','registration-440'];
rows.sort((a,b)=>(highlights.includes(a.name)?highlights.indexOf(a.name):-1)<0?highlights.includes(b.name)?1:a.name.localeCompare(b.name):highlights.includes(b.name)?highlights.indexOf(a.name)-highlights.indexOf(b.name):-1);
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누비 Workspace 화면 전후 비교</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f7fa;color:#191f28;font:15px/1.6 Pretendard,"Noto Sans KR",-apple-system,sans-serif}main{max-width:1480px;margin:auto;padding:32px}h1{font-size:24px;margin:0 0 8px;letter-spacing:-.4px}p{margin:0;color:#4e5968}header{margin-bottom:24px}.toolbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:24px 0 16px}select,button{font:inherit;min-height:40px;border:1px solid #e5e8eb;background:white;border-radius:12px;padding:8px 12px;color:inherit}select{max-width:100%}button{cursor:pointer}button[aria-pressed=true]{background:#e8f1fe;color:#1b64da;border-color:transparent}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}article{min-width:0;background:white;border-radius:20px;overflow:hidden}h2{font-size:16px;margin:0;padding:16px 20px}.capture{position:relative;overflow:hidden;background:#d3d7dc}.capture img{position:absolute;max-width:none}.note{padding:16px 20px;font-size:14px;display:flex;justify-content:space-between;gap:8px}a{color:#1b64da}.assessment{margin:24px 0;padding:20px;background:white;border-radius:16px}.assessment strong{display:block;margin-bottom:6px}.scope{margin-top:16px;font-size:14px}details{margin-top:20px}li{margin:8px 0}a:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid #1b64da;outline-offset:3px}@media(max-width:800px){main{padding:16px}.pair{grid-template-columns:1fr}h1{font-size:21px}}
</style><main><header><h1>누비 Workspace 화면 전후 비교</h1><p>2026-10-15 · 기존 기능과 흐름을 유지한 가독성 조정</p></header>
<div class="toolbar"><label for="screen">화면</label><select id="screen"></select><button id="frame" aria-pressed="true">모달 중심</button></div>
<div class="pair" id="pair"></div><section class="assessment"><strong id="title"></strong><p id="explanation"></p></section>
<p class="scope">실제 제품 컴포넌트를 격리된 Electron에서 렌더링한 캡처입니다. 계정과 문서는 테스트 데이터입니다. 이미지 픽셀은 수정하지 않았으며 모달 중심 보기에서는 주변 화면만 가립니다.</p>
<details><summary>평가 기준과 확인 범위</summary><ul><li>제목 18px / 600, 본문 15px / 400, 보조 14px, 필드 이름 500. 기존 Pretendard 및 Noto Sans KR 토큰 유지.</li><li>아이콘과 버튼 중앙 정렬, 8/16/24 간격, 40px 이상의 모달 버튼, 누비 파랑과 의미별 상태 색 유지.</li><li>전체 화면 검사 115개 상태: 일반/좁은 화면, 200% 글자 확대, 대비, 잘림, 조작 이름과 한 줄 버튼.</li><li>추가로 중첩 모달의 초점 복귀, 삭제 취소, 선택과 등록, AI Workspace 앱/Talk 및 Wiki 화면을 검사했습니다.</li><li>OS 파일 선택창과 외부 로그인 사이트는 운영체제 및 해당 서비스의 화면입니다. Windows 설치판과 사내 실계정은 이번 시각 검사 범위가 아닙니다.</li></ul></details></main>
<script>
const rows=${JSON.stringify(rows)},names=${JSON.stringify(names)},descriptions=${JSON.stringify(description)};
const select=document.querySelector('#screen'),pair=document.querySelector('#pair'),frame=document.querySelector('#frame');let focused=true;
function title(name){const group=name.replace(/-(1280|440|200pct)$/,'');return (names[group]||group)+' / '+(name.endsWith('200pct')?'200% 확대':name.match(/(1280|440)$/)?.[0]+'px');}
for(const row of rows){const option=document.createElement('option');option.value=row.name;option.textContent=title(row.name);select.append(option);}
function show(){const row=rows.find(row=>row.name===select.value);pair.replaceChildren();for(const side of ['before','after']){const value=row[side],r=focused&&value.dialog;const x=r?Math.max(0,r.left-16):0,y=r?Math.max(0,r.top-16):0,w=r?Math.min(value.width-x,r.width+32):value.width,h=r?Math.min(value.height-y,r.height+32):value.height;const card=document.createElement('article'),heading=document.createElement('h2'),capture=document.createElement('div'),img=document.createElement('img'),note=document.createElement('div'),link=document.createElement('a');heading.textContent=side==='before'?'수정 전':'수정 후';capture.className='capture';capture.style.aspectRatio=w+'/'+h;img.src=side+'/'+value.file;img.alt=heading.textContent+' '+title(row.name);img.style.cssText='width:'+value.width/w*100+'%;left:'+(-x/w*100)+'%;top:'+(-y/h*100)+'%';capture.append(img);note.className='note';note.textContent=r?'모달 '+Math.round(r.width)+' × '+Math.round(r.height)+'px':value.width+' × '+value.height+'px';link.href=img.src;link.target='_blank';link.rel='noopener';link.textContent='전체 캡처';note.append(link);card.append(heading,capture,note);pair.append(card);}document.querySelector('#title').textContent=title(row.name);document.querySelector('#explanation').textContent=descriptions[row.name.replace(/-(1280|440|200pct)$/,'')]||'기존 배치를 유지하며 공통 토큰과 화면 경계를 확인한 상태입니다.';}
select.onchange=show;frame.onclick=()=>{focused=!focused;frame.setAttribute('aria-pressed',focused);frame.textContent=focused?'모달 중심':'전체 화면';show();};show();
</script></html>`;
await writeFile(path.join(dir,'index.html'),html);
console.log(path.join(dir,'index.html'));

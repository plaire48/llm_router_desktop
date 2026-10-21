// The Office fidelity checklist (사용자 지시 2026-10-21 "이미지, 도형, 글자, 폰트, 오피스에서 할 수 있는 모든 걸 다
// 테스트"): every feature the synthetic kitchen-sink files hold (make_fixtures.py), checked on a registration capture
// (contract v1). The same list grades the file engine here and the Office host on Windows (Task H): a feature is
// captured when its check passes. Checks read only the capture, never the source file.
const all=(list,fn)=>Array.isArray(list)&&list.some(fn);
const runsOf=document=>[...(document.paragraphs??[]),...(document.tables??[]).flatMap(t=>t.rows.flat().flatMap(c=>c.paragraphs??[]))].flatMap(p=>p.runs??[]);
const paragraph=(document,text)=>(document.paragraphs??[]).find(p=>String(p.text??'').includes(text));
const run=(document,text)=>runsOf(document).find(r=>String(r.text??'').includes(text));
const flatShapes=shapes=>(shapes??[]).flatMap(s=>s.type==='group'?[s,...flatShapes(s.shapes)]:[s]);
const cell=(sheet,address)=>sheet?.cells?.find(c=>c.address===address);

export const WORD_FEATURES=[
  ['word.fonts','글꼴 4종(맑은 고딕, Arial, Times New Roman, 궁서)',d=>['맑은 고딕','Arial','Times New Roman','궁서'].every(f=>d.fonts?.includes(f))],
  ['word.sizes','글자 크기(9, 14, 20pt)',d=>[9,14,20].every(s=>runsOf(d).some(r=>r.size===s))],
  ['word.bold-italic','굵게와 기울임',d=>run(d,'굵게')?.bold===true&&run(d,'기울임')?.italic===true],
  ['word.underline','밑줄 종류(두 줄)',d=>run(d,'밑줄 두 줄')?.underline==='double'],
  ['word.strike','취소선과 이중 취소선',d=>run(d,'취소선 ')?.strike===true&&run(d,'이중 취소선')?.doubleStrike===true],
  ['word.vertical','위 첨자와 아래 첨자',d=>run(d,'위 첨자')?.vertAlign==='superscript'&&run(d,'아래 첨자')?.vertAlign==='subscript'],
  ['word.caps','작은 대문자와 모두 대문자',d=>run(d,'Small Caps')?.smallCaps===true&&run(d,'all caps')?.allCaps===true],
  ['word.color','글자 색(RGB와 테마 색)',d=>run(d,'빨간 글자')?.color==='#C00000'&&!!run(d,'테마 색')?.themeColor],
  ['word.highlight','형광펜',d=>run(d,'형광펜')?.highlight==='yellow'],
  ['word.char-spacing','자간',d=>Number(run(d,'자간 넓게')?.spacing)>0],
  ['word.char-shading','글자 음영',d=>run(d,'글자 음영')?.shading==='#D9E1F2'],
  ['word.symbols','기호와 이모지',d=>/★.*✓.*😀/.test(paragraph(d,'기호와 이모지')?.text??'')],
  ['word.align','문단 정렬(가운데, 오른쪽, 양쪽, 배분)',d=>['가운데 정렬','오른쪽 정렬','양쪽 정렬','배분 정렬'].map(t=>paragraph(d,t)?.align).join()==='center,right,both,distribute'],
  ['word.indent','들여쓰기, 첫 줄, 내어쓰기',d=>paragraph(d,'들여쓰기 2cm')?.indent?.left>0&&paragraph(d,'들여쓰기 2cm')?.indent?.firstLine>0&&paragraph(d,'내어쓰기')?.indent?.hanging>0],
  ['word.spacing','문단 앞뒤 간격과 줄 간격',d=>{const p=paragraph(d,'들여쓰기 2cm');return p?.spacing?.before>0&&p?.spacing?.after>0&&p?.spacing?.line>0;}],
  ['word.keep','다음 문단과 함께',d=>paragraph(d,'들여쓰기 2cm')?.keepNext===true],
  ['word.para-border','문단 테두리와 음영',d=>{const p=paragraph(d,'테두리와 음영');return !!p?.borders?.top&&!!p?.borders?.bottom&&p?.shading==='#FFF2CC';}],
  ['word.breaks','탭과 줄 바꿈과 쪽 나눔',d=>/\t/.test(paragraph(d,'탭')?.text??'')&&/\n/.test(paragraph(d,'탭')?.text??'')&&(d.paragraphs??[]).some(p=>p.breaks?.page>0)],
  ['word.lists','글머리와 번호 목록(2단계 포함)',d=>{const b=paragraph(d,'글머리 기호 2단계'),n=paragraph(d,'번호 목록 2단계');const deeper=(x,base)=>x?.listLevel===1||x?.listIndent>paragraph(d,base)?.listIndent;return !!paragraph(d,'글머리 기호 1')?.listString&&deeper(b,'글머리 기호 1')&&!!paragraph(d,'번호 목록 1')?.listString&&deeper(n,'번호 목록 1');}],
  ['word.table-merge','표 가로 병합과 세로 병합',d=>all(d.tables,t=>t.rows.flat().some(c=>c.span===2)&&t.rows.flat().some(c=>c.vMerge==='restart'))],
  ['word.table-style','표 셀 음영과 머리글 반복',d=>all(d.tables,t=>t.rows[0]?.some(c=>c.shading==='#D9E1F2')&&t.headerRow===true)],
  ['word.table-nested','중첩 표',d=>all(d.tables,t=>t.rows.flat().some(c=>(c.tables??[]).some(n=>n.rows.flat().some(x=>x.text==='중첩 표'))))],
  ['word.image-inline','인라인 그림과 자산',d=>all(d.images,i=>i.inline===true&&!!i.asset)],
  ['word.image-floating','떠 있는 그림(위치, 배치, 자르기)',d=>all(d.images,i=>i.inline===false&&!!i.position&&!!i.wrap&&!!i.crop)],
  ['word.shapes','도형과 글상자(종류, 채움, 선, 글)',d=>{const s=d.shapes??[];return s.some(x=>x.geometry==='rect'&&x.text==='글상자 안 글'&&x.fill==='#2E75B6'&&x.line?.dash==='dash')&&s.some(x=>x.geometry==='roundRect')&&s.some(x=>x.geometry==='rightArrow');}],
  ['word.chart','차트(종류와 제목)',d=>all(d.charts,c=>c.type==='barChart'&&c.title==='분기 매출'&&c.series?.length>0)],
  ['word.equation','수식',d=>(d.equations??[]).some(e=>/E=mc2|E=m.*c.*2/.test(e.text))],
  ['word.hyperlink','링크 주소와 글자',d=>(d.hyperlinks??[]).some(h=>h.target==='https://example.com/form-guide'&&h.text==='작성 안내')],
  ['word.bookmark','책갈피',d=>(d.bookmarks??[]).includes('결재란')],
  ['word.fields','필드(DATE, PAGE)',d=>(d.fields??[]).some(f=>/DATE/.test(f.instr))&&(d.footers??[]).some(f=>(f.fields??[]).some(x=>/PAGE/.test(x.instr)))],
  ['word.notes','각주와 미주',d=>(d.footnotes??[]).some(n=>n.text.includes('각주 내용'))&&(d.endnotes??[]).some(n=>n.text.includes('미주 내용'))],
  ['word.comments','메모(작성자와 글)',d=>(d.comments??[]).some(c=>c.author==='검토자'&&c.text.includes('확인이 필요'))],
  ['word.revisions','변경 추적(삽입, 삭제, 작성자)',d=>(d.revisions??[]).some(r=>r.type==='insert'&&r.text==='삽입된 글'&&r.author==='편집자')&&(d.revisions??[]).some(r=>r.type==='delete'&&r.text==='지운 글')],
  ['word.controls','입력 컨트롤 4종',d=>{const c=d.controls??[];return c.some(x=>x.controlType==='text'&&x.showingPlaceholder)&&c.some(x=>x.controlType==='date'&&x.dateFormat==='yyyy-MM-dd')&&c.some(x=>x.controlType==='dropdown'&&x.items?.length===2)&&c.some(x=>x.controlType==='checkbox'&&x.checked===true);}],
  ['word.sections','구역(가로 방향, 2단)',d=>(d.sections??[]).length===2&&d.sections[1].page?.orientation==='landscape'&&d.sections[1].columns===2],
  ['word.headers','머리글(기본, 첫 쪽)과 바닥글',d=>(d.headers??[]).some(h=>h.type==='default'&&h.text==='기본 머리글')&&(d.headers??[]).some(h=>h.type==='first'&&h.text==='첫 쪽 머리글')&&(d.footers??[]).length>0],
  ['word.styles','스타일 목록',d=>['Title','heading 1','List Bullet'].every(n=>(d.styles??[]).some(s=>s.name===n))],
  ['word.theme','테마 글꼴과 색',d=>!!d.theme?.fonts?.major&&!!d.theme?.fonts?.minor&&Object.keys(d.theme?.colors??{}).length>=6]
];

export const EXCEL_FEATURES=[
  ['excel.sheets','시트 5개와 숨김/아주 숨김',d=>d.sheets?.length===5&&d.sheets.some(s=>s.state==='hidden')&&d.sheets.some(s=>s.state==='veryHidden')],
  ['excel.tab-color','탭 색',d=>d.sheets?.[0]?.tabColor==='#1F3864'],
  ['excel.merge','병합',d=>d.sheets?.[0]?.merges?.includes('A1:F1')],
  ['excel.fonts','글꼴과 글자 서식',d=>{const s=d.sheets?.[0];return cell(s,'A1')?.font?.name==='맑은 고딕'&&cell(s,'A3')?.font?.bold&&cell(s,'B3')?.font?.italic&&cell(s,'C3')?.font?.underline==='double'&&cell(s,'D3')?.font?.strike&&cell(s,'E3')?.font?.color==='#C00000'&&cell(s,'F3')?.font?.size===14&&cell(s,'G3')?.font?.vertAlign==='superscript';}],
  ['excel.fills','채움(단색, 무늬, 그라데이션)',d=>{const s=d.sheets?.[0];return cell(s,'A4')?.fill?.color==='#FFF2CC'&&cell(s,'B4')?.fill?.pattern==='darkGrid'&&cell(s,'C4')?.fill?.type==='gradient'&&(cell(s,'C4')?.fill?.stops?.length??0)>=2;}],
  ['excel.borders','테두리 종류와 색',d=>{const b=cell(d.sheets?.[0],'D4')?.border;return b?.top?.style==='thick'&&b?.top?.color==='#C00000'&&b?.bottom?.style==='dashed';}],
  ['excel.alignment','회전, 줄 바꿈, 들여쓰기',d=>{const s=d.sheets?.[0];return cell(s,'E4')?.alignment?.textRotation===45&&cell(s,'F4')?.alignment?.wrapText===true&&cell(s,'F4')?.alignment?.indent===1;}],
  ['excel.rich-text','칸 안 부분 서식',d=>cell(d.sheets?.[0],'A5')?.runs?.some(r=>r.bold&&r.color==='#C00000')],
  ['excel.notes','메모',d=>cell(d.sheets?.[0],'A6')?.note?.includes('합성 메모')],
  ['excel.links','링크(바깥, 안쪽)',d=>{const s=d.sheets?.[0];return cell(s,'A7')?.hyperlink==='https://example.com/sheet-guide'&&/데이터!A1/.test(cell(s,'B7')?.hyperlink??'');}],
  ['excel.number-formats','숫자 서식(%, 통화, 날짜, 사용자)',d=>{const s=d.sheets?.[0];return cell(s,'A8')?.numberFormat==='0.0%'&&/₩/.test(cell(s,'B8')?.numberFormat??'')&&cell(s,'C8')?.numberFormat==='yyyy-mm-dd'&&/0\.00_\)/.test(cell(s,'E8')?.numberFormat??'');}],
  ['excel.types','값 종류(날짜, 참/거짓)',d=>{const s=d.sheets?.[0];return cell(s,'C8')?.type==='date'&&cell(s,'D8')?.type==='boolean';}],
  ['excel.hidden','숨긴 행과 열',d=>{const s=d.sheets?.[0];return s?.columns?.some(c=>c.column==='G'&&c.hidden)&&s?.rows?.some(r=>r.row===9&&r.hidden);}],
  ['excel.freeze','틀 고정',d=>d.sheets?.[0]?.freeze==='A3'],
  ['excel.images','그림과 위치',d=>d.sheets?.[0]?.images?.some(i=>i.asset&&i.from==='H2')],
  ['excel.shapes','도형과 글상자',d=>{const s=d.sheets?.[0]?.shapes??[];return s.some(x=>x.text==='시트 위 글상자'&&x.fill==='#2E75B6')&&s.some(x=>x.geometry==='rightArrow');}],
  ['excel.formulas','수식(합계, 다른 시트, 찾기, 배열)',d=>{const s=d.sheets?.find(x=>x.name==='데이터');return cell(s,'D5')?.formula==='SUM(D2:D4)'&&/요약/.test(cell(s,'B7')?.formula??'')&&/VLOOKUP/.test(cell(s,'B8')?.formula??'')&&cell(s,'F2')?.arrayFormula===true;}],
  ['excel.tables','표(이름과 스타일)',d=>d.sheets?.find(x=>x.name==='데이터')?.tables?.some(t=>t.name==='SalesTable'&&t.style==='TableStyleMedium2')],
  ['excel.conditional','조건부 서식 4종',d=>{const types=(d.sheets?.find(x=>x.name==='데이터')?.conditionalFormats??[]).flatMap(f=>f.rules.map(r=>r.type));return ['cellIs','colorScale','dataBar','iconSet'].every(t=>types.includes(t));}],
  ['excel.validation','데이터 유효성(목록, 정수)',d=>{const v=d.sheets?.find(x=>x.name==='데이터')?.validations??[];return v.some(x=>x.type==='list')&&v.some(x=>x.type==='whole');}],
  ['excel.outline','그룹(개요 수준)',d=>d.sheets?.find(x=>x.name==='데이터')?.rows?.some(r=>r.outlineLevel===1)],
  ['excel.protection','시트 보호',d=>d.sheets?.find(x=>x.name==='데이터')?.protected===true],
  ['excel.print','인쇄 영역, 방향, 반복 행',d=>{const p=d.sheets?.find(x=>x.name==='데이터')?.print;return /A\$?1:\$?D\$?5|A1:D5/.test(p?.area??'')&&p?.orientation==='landscape'&&/1:\$?1/.test(p?.titleRows??'');}],
  ['excel.names','이름 정의',d=>d.definedNames?.some(n=>n.name==='합계금액')],
  ['excel.charts','차트 3종과 제목',d=>{const c=d.sheets?.find(x=>x.name==='차트')?.charts??[];return ['barChart','lineChart','pieChart'].every(t=>c.some(x=>x.type===t))&&c.some(x=>x.title==='품목별 금액');}]
];

export const POWERPOINT_FEATURES=[
  ['ppt.size','슬라이드 크기(16:9)',d=>d.size?.width===960&&d.size?.height===540],
  ['ppt.layouts','레이아웃 이름',d=>new Set((d.slides??[]).map(s=>s.layout)).size>=3],
  ['ppt.background','슬라이드 배경',d=>d.slides?.[0]?.background==='#F2F2F2'],
  ['ppt.title-format','제목 글자 서식',d=>{const r=d.slides?.[0]?.shapes?.[0]?.paragraphs?.[0]?.runs?.[0];return r?.size===44&&r?.bold&&r?.color==='#1F3864'&&r?.font==='맑은 고딕';}],
  ['ppt.bullets','글머리 수준',d=>{const p=d.slides?.[1]?.shapes?.flatMap(s=>s.paragraphs??[])??[];return p.some(x=>x.level===1)&&p.some(x=>x.level===2);}],
  ['ppt.notes','발표자 노트',d=>/목록 수준/.test(d.slides?.[1]?.notes??'')],
  ['ppt.runs','글자 서식(굵게, 기울임, 밑줄, 글꼴, 색, 취소선)',d=>{const r=(d.slides?.[2]?.shapes??[]).flatMap(s=>(s.paragraphs??[]).flatMap(p=>p.runs));return r.some(x=>x.bold)&&r.some(x=>x.italic)&&r.some(x=>x.underline)&&r.some(x=>x.font==='Arial'&&x.size===24)&&r.some(x=>x.color==='#C00000')&&r.some(x=>x.strike);}],
  ['ppt.hyperlink','링크',d=>(d.slides?.[2]?.shapes??[]).flatMap(s=>(s.paragraphs??[]).flatMap(p=>p.runs)).some(r=>r.hyperlink==='https://example.com/deck-guide')],
  ['ppt.shapes','도형 5종(종류, 채움, 선)',d=>{const s=flatShapes(d.slides?.[2]?.shapes);return ['rect','roundRect','ellipse','rightArrow','star5'].every(g=>s.some(x=>x.geometry===g))&&s.some(x=>x.fill==='#2E75B6')&&s.some(x=>x.fill==='gradient')&&s.some(x=>x.line?.dash==='dash'&&x.line?.width>0);}],
  ['ppt.group','묶음과 안쪽 도형',d=>(d.slides?.[2]?.shapes??[]).some(s=>s.type==='group'&&s.shapes?.length===2)],
  ['ppt.connector','연결선과 화살표 끝',d=>(d.slides?.[2]?.shapes??[]).some(s=>s.type==='connector'&&s.line?.tailEnd==='triangle')],
  ['ppt.wordart','워드아트(글자 휘기)',d=>(d.slides?.[2]?.shapes??[]).some(s=>s.textWarp==='textArchUp')],
  ['ppt.picture','그림과 자르기',d=>(d.slides?.[2]?.shapes??[]).some(s=>s.type==='picture'&&s.asset&&s.crop?.left>0)],
  ['ppt.transition','화면 전환',d=>d.slides?.[2]?.transition?.type==='fade'],
  ['ppt.animation','애니메이션',d=>(d.slides?.[2]?.animations??[]).length>0],
  ['ppt.table','표와 병합',d=>(d.slides?.[3]?.shapes??[]).some(s=>s.type==='table'&&s.rows?.flat().some(c=>c.gridSpan===2)&&s.rows?.flat().some(c=>c.rowSpan===2))],
  ['ppt.charts','차트 2종과 제목',d=>{const c=(d.slides?.[3]?.shapes??[]).filter(s=>s.type==='chart');return c.some(x=>x.chartType==='barChart'&&x.title==='분기 매출')&&c.some(x=>x.chartType==='pieChart');}],
  ['ppt.media','동영상',d=>(d.slides?.[3]?.shapes??[]).some(s=>s.type==='media'||s.media)],
  ['ppt.hidden','숨긴 슬라이드',d=>d.slides?.[4]?.hidden===true],
  ['ppt.sections','구역',d=>(d.sections??[]).map(s=>s.name).join()==='소개,본문']
];

export const FEATURES={word:WORD_FEATURES,excel:EXCEL_FEATURES,powerpoint:POWERPOINT_FEATURES};
/** Grades a capture: [{id,label,ok}] and the share captured. */
export function gradeCapture(capture){
  const rows=(FEATURES[capture.app]??[]).map(([id,label,check])=>{let ok=false;try{ok=!!check(capture.document);}catch{ok=false;}return {id,label,ok};});
  return {app:capture.app,engine:capture.engine,rows,captured:rows.filter(r=>r.ok).length,total:rows.length};
}

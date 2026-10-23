import {AuxiliaryDetail} from './AuxiliaryDetail.jsx';
import {WikiCoverageBadge} from './WikiCoverageBadge.jsx';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CxButton,CxInput,Icon,DetailPanel,SearchField} from '@e2e/cx-design-system';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {CxSelect} from './WorkspaceSelect.jsx';
import {BookMark,BranchMark} from './marks.jsx';
import {MessageBody} from '../../../extensions/aipro-chat/src/MessageBody.jsx';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {wikiDrafts,wikiLastDocuments} from './wiki-drafts.mjs';
import {buildWikiGraph,relatedDocuments,filterWikiRows,sortWikiRows,pageWikiRows,sectionColors,sectionLabel,wikiSection} from './wiki-graph.mjs';
import {deriveMailClusterKinds} from './wiki-map-groups.mjs';
import {WikiTable,WikiPagination,EMPTY_WIKI_FILTERS,WIKI_PAGE_SIZES,activeWikiFilter} from './WikiTable.jsx';
import {WikiMap} from './WikiMap.jsx';
import {describeWikiPage} from '../electron-app/wiki-frontmatter.cjs';
import {mailTableDate} from '../runtime/mail-presentation.mjs';
import './wiki-browser.css';
import {ShowMore} from './ShowMore.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import {PageNumbers} from './PageNumbers.jsx';
import {DriftLabel} from './DriftLabel.jsx';
const errors={wiki_library_mail_limit:'메일 위키는 기존 문서를 60,000자까지 수정할 수 있어요.',wiki_library_changed:'원문이 바뀌었어요. 작성한 내용은 보관했으니 원문과 비교해 주세요.',wiki_library_busy:'이 자료를 갱신하고 있어요. 읽기는 가능하며 작업이 끝나면 저장할 수 있어요.',wiki_library_scope:'이 위키 안의 Markdown 문서를 선택해 주세요.',wiki_library_limit:'문서 한 개는 1MB까지 편집할 수 있어요.',wiki_library_encoding:'UTF-8 Markdown 문서만 편집할 수 있어요.',wiki_library_unconfirmed:'저장 결과를 확인하지 못했어요. 원문을 다시 확인해 주세요.'};
const sizeKey='nubi-wiki-page-size-v1';
function preferredSize(){try{const value=Number(localStorage.getItem(sizeKey));return WIKI_PAGE_SIZES.includes(value)?value:20;}catch{return 20;}}
const directionIcon={both:'link',out:'arrowRight',in:'arrowLeft'};
// The Wiki screen mirrors the mail screen: one header, a scope, a list or a map
// above, and the open document below. Pages come from the library only.
export function WikiBrowser({detailHost,api,projectId,onBack,onSettings,onRewrite,openPath}){
 const [roots,setRoots]=useState([]),[scope,setScope]=useState(''),[list,setList]=useState({items:[],edges:[]}),[view,setView]=useState('documents'),[mapMode,setMapMode]=useState('overview');
 const [query,setQuery]=useState(''),[filters,setFilters]=useState(EMPTY_WIKI_FILTERS),[sort,setSort]=useState('updated-desc'),[page,setPage]=useState(1),[size,setSize]=useState(preferredSize),[draftRevision,setDraftRevision]=useState(0);
 const [bodySearch,setBodySearch]=useState(null);
 const [doc,setDoc]=useState(null),[text,setText]=useState(''),[editing,setEditing]=useState(false),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[newName,setNewName]=useState(null),[link,setLink]=useState('');
 const generation=useRef(0),listGeneration=useRef(0),live=useRef(true),scopeRef=useRef(scope),reader=useRef(null);scopeRef.current=scope;
 const [detailOpen,setDetailOpen]=useState(false);
 function closeDetail(){generation.current++;setDetailOpen(false);setDoc(null);setLoading(false);closeMapReader();requestAnimationFrame(()=>explorer.current?.focus({preventScroll:true}));}
 const [facts,setFacts]=useState(null),[mapState,setMapState]=useState('loading'),[mapReaderOpen,setMapReaderOpen]=useState(false);
 const mapOrigin=useRef(null),explorer=useRef(null);
 const openFromMap=path=>{mapOrigin.current=document.activeElement;setMapReaderOpen(true);void open(path);};
 const closeMapReader=()=>{setMapReaderOpen(false);requestAnimationFrame(()=>{const origin=mapOrigin.current;if(origin?.isConnected)origin.focus({preventScroll:true});else explorer.current?.focus({preventScroll:true});});};
 useEffect(()=>{if(view==='map'&&mapReaderOpen&&!loading){reader.current?.focus({preventScroll:true});if(reader.current)reader.current.scrollTop=0;}},[view,mapReaderOpen,loading,doc?.path]);
 const call=(action,args={})=>api('wikiLibrary',{action,scopeId:scope,...args});
 const fail=e=>setError(errors[e.message]||'위키를 열지 못했어요. 폴더와 접근 권한을 확인해 주세요.');
 const touchDrafts=()=>setDraftRevision(value=>value+1);
 useEffect(()=>{let active=true;live.current=true;api('wikiLibrary',{action:'roots'}).then(v=>{if(active){const items=v.items.filter(r=>r.kind==='mail'||r.id===projectId);setRoots(items);if(!items.length)setMapState('ready');setScope(items.find(r=>r.id===projectId)?.id||items.find(r=>r.kind==='mail')?.id||'');}}).catch(e=>{if(active){setMapState('error');fail(e);}});return()=>{active=false;live.current=false;generation.current++;listGeneration.current++;};},[api,projectId]);
 useEffect(()=>{const reset=event=>{if(event.type==='nubi-mail-reset'?scope!=='personal-mail':event.detail?.scopeId!==scope)return;setDoc(null);setText('');setEditing(false);setFacts(null);setList({items:[],edges:[]});void load();};window.addEventListener('nubi-mail-reset',reset);window.addEventListener('nubi-wiki-reset',reset);return()=>{window.removeEventListener('nubi-mail-reset',reset);window.removeEventListener('nubi-wiki-reset',reset);};},[api,scope]);
 function showDocument(v,file){setDetailOpen(true);const draft=wikiDrafts.get(scope+':'+file);setDoc(draft?.base||v);setText(draft?.text??v.content);setEditing(!!draft);wikiLastDocuments.set(scope,file);if(draft&&draft.base.hash!==v.hash)setError(errors.wiki_library_changed);}
 async function load({restore=false}={}){if(!scope)return;const run=++generation.current,listRun=++listGeneration.current,owner=scope;setLoading(true);setMapState('loading');setError('');try{const v=await call('list').catch(e=>{if(live.current&&listRun===listGeneration.current&&scopeRef.current===owner)setMapState('error');throw e;});if(!live.current||listRun!==listGeneration.current||scopeRef.current!==owner)return;setList(v);setMapState('ready');if(run!==generation.current)return;if(restore){const remembered=wikiLastDocuments.get(scope),draft=wikiDrafts.get(scope+':'+remembered);const file=(v.items.some(i=>i.path===remembered)||draft?remembered:null)||v.items.find(i=>/^(home|index|readme)\.md$/i.test(i.path))?.path||v.items[0]?.path;if(file){const result=draft?.base.hash===null?draft.base:await call('read',{path:file});if(live.current&&run===generation.current)showDocument(result,file);}}}catch(e){if(live.current&&run===generation.current)fail(e);}finally{if(live.current&&run===generation.current)setLoading(false);}}
 useEffect(()=>{setDetailOpen(false);setMapReaderOpen(false);setDoc(null);setEditing(false);setQuery('');setFilters(EMPTY_WIKI_FILTERS);setPage(1);setList({items:[],edges:[]});setLink('');setNotice('');void load({restore:true});},[scope]);
 useEffect(()=>{
  if(!query.trim()||scope!==projectId){setBodySearch(null);return;}
  let active=true;setBodySearch({scope,query,state:'loading'});
  const timer=setTimeout(()=>{api('wikiLibrary',{action:'search',scopeId:scope,query:query.trim()}).then(value=>{
   if(!Array.isArray(value?.paths))throw Error('unsupported');
   if(active)setBodySearch({scope,query,state:'ready',paths:new Set(value.paths),truncated:value.truncated});
  }).catch(()=>{if(active)setBodySearch({scope,query,state:'error'});});},200);
  return()=>{active=false;clearTimeout(timer);};
 },[api,scope,projectId,query,list]);
 // Mail pages carry time facts (2026-10-14): the values this mail introduced, with what replaced them since.
 useEffect(()=>{setFacts(null);if(!doc?.path||!isMail)return;let alive=true;api('mail',{action:'facts',wikiFile:doc.path,includeHistory:true}).then(value=>{if(alive)setFacts(value.facts||[]);}).catch(()=>{if(alive)setFacts([]);});return()=>{alive=false;};},[doc?.path,scope]);
 async function open(file,{reveal=false}={}){if(saving)return;setDetailOpen(true);detailHost?.show('wiki-detail');const run=++generation.current;setLoading(true);setError('');setNotice('');try{const pending=wikiDrafts.get(scope+':'+file);const v=pending?.base.hash===null?pending.base:await call('read',{path:file});if(!live.current||run!==generation.current)return;showDocument(v,file);setLink('');if(reveal)requestAnimationFrame(()=>{if(detailHost){if(reader.current)reader.current.scrollTop=0;}else reader.current?.scrollIntoView({block:reveal==='start'?'start':'nearest',behavior:'smooth'});});}catch(e){if(live.current&&run===generation.current)fail(e);}finally{if(live.current&&run===generation.current)setLoading(false);}}
 function change(value){setText(value);const key=scope+':'+doc.path,hadDraft=wikiDrafts.has(key);if(value===doc.content&&doc.hash)wikiDrafts.delete(key);else wikiDrafts.set(key,{base:doc,text:value});setNotice('');if(hadDraft!==wikiDrafts.has(key))touchDrafts();}
 async function save(){if(!doc||saving)return;const owner=scope,key=scope+':'+doc.path;setSaving(true);setError('');try{const v=await call('save',{path:doc.path,expectedHash:doc.hash,content:text});wikiDrafts.delete(key);touchDrafts();if(live.current&&scopeRef.current===owner){setDoc(v);setText(v.content);setEditing(false);setNotice('저장했어요. 다음 위키 조회에 반영됩니다.');await load();}}catch(e){if(live.current&&scopeRef.current===owner)fail(e);}finally{if(live.current)setSaving(false);}}
 function cancelEdit(){wikiDrafts.delete(scope+':'+doc.path);touchDrafts();setText(doc.content);setEditing(false);if(!doc.hash)setDoc(null);}
 function create(){const name=(newName||'').trim().replace(/\.md$/i,'')+'.md';if(!name||name==='.md'||name.includes('/')||name.includes('\\')){setError('문서 이름을 입력해 주세요.');return;}const base={path:name,hash:null,content:''};setDetailOpen(true);detailHost?.show('wiki-detail');setMapReaderOpen(true);setDoc(base);setText('# '+name.slice(0,-3)+'\n');setEditing(true);wikiDrafts.set(scope+':'+name,{base,text:'# '+name.slice(0,-3)+'\n'});touchDrafts();wikiLastDocuments.set(scope,name);setNewName(null);}
 function connect(){if(!link||!doc)return;const parts=doc.path.split('/').slice(0,-1),to=link.split('/');while(parts.length&&to.length&&parts[0]===to[0]){parts.shift();to.shift();}const rel=[...parts.map(()=> '..'),...to].map(p=>encodeURIComponent(p)).join('/');const title=list.items.find(i=>i.path===link)?.title?.replace(/[\[\]\n]/g,'')||link;setEditing(true);change(text.trimEnd()+`\n\n[${title}](${rel})\n`);setLink('');}
 const graph=useMemo(()=>{const drafts=[...wikiDrafts.entries()].filter(([key,draft])=>key.startsWith(scope+':')&&draft.base.hash===null&&!list.items.some(item=>item.path===draft.base.path)).map(([,draft])=>({...draft.base,title:draft.base.path,updatedAt:new Date().toISOString()}));const items=scope===roots.find(r=>r.kind==='mail')?.id?list.items.map(item=>{const at=new Date(item.date||item.updatedAt||'');return Number.isFinite(+at)?{...item,section:`${at.getFullYear()}-${String(at.getMonth()+1).padStart(2,'0')}`}:item;}):list.items;return deriveMailClusterKinds(buildWikiGraph([...items,...drafts],list.edges,{kind:scope===roots.find(r=>r.kind==='mail')?.id?'mail':'code'}));},[list,scope,draftRevision,roots]);
 // Sorting is independent of the search text. Keep the order while narrowing
 // the list instead of comparing thousands of titles on every keystroke.
 const sorted=useMemo(()=>sortWikiRows(graph.nodes,sort),[graph,sort]);
 const currentSearch=bodySearch?.scope===scope&&bodySearch.query===query?bodySearch:null;
 const filtered=useMemo(()=>{
  const metadata=filterWikiRows(sorted,{query,...filters});
  if(currentSearch?.state!=='ready')return metadata;
  const names=new Set(metadata.map(node=>node.path));
  return filterWikiRows(sorted,filters).filter(node=>names.has(node.path)||currentSearch.paths.has(node.path));
 },[sorted,query,filters,currentSearch]);
 const paged=useMemo(()=>pageWikiRows(filtered,page,size),[filtered,page,size]);
 const facets=useMemo(()=>({sections:graph.sections,types:graph.types}),[graph]),colors=useMemo(()=>sectionColors(graph),[graph]);
 const projectRoots=roots.filter(r=>r.kind!=='mail'),mailRoot=roots.find(r=>r.kind==='mail'),isMail=scope===mailRoot?.id,projectScope=projectRoots.find(r=>r.id===scope)||projectRoots.find(r=>r.id===projectId)||projectRoots[0];
 const selected=graph.nodes.find(node=>node.path===doc?.path),described=useMemo(()=>doc?describeWikiPage(editing?text:doc.content,doc.path):null,[doc,editing,text]);
 const related=useMemo(()=>doc?relatedDocuments(graph,doc.path):[],[graph,doc?.path]);
 const title=selected?.title||described?.title||doc?.path||'',dirty=doc&&(text!==doc.content||doc.hash===null);
 const body=described?described.body.replace(/^\s*#\s+(.+?)\s*#*[ \t]*(?:\r?\n|$)/,(line,heading)=>heading.trim()===title.trim()?'':line):'';
 const chips=[...filters.sections.map(id=>({label:`분류 ${sectionLabel(id)}`,clear:()=>setFilters(f=>({...f,sections:f.sections.filter(s=>s!==id)}))})),...filters.types.map(id=>({label:`종류 ${id}`,clear:()=>setFilters(f=>({...f,types:f.types.filter(t=>t!==id)}))})),...(filters.link!=='all'?[{label:filters.link==='orphan'?'연결 없는 문서만':'연결된 문서만',clear:()=>setFilters(f=>({...f,link:'all'}))}]:[]),...(filters.period!=='all'?[{label:`최근 ${filters.period}일 수정`,clear:()=>setFilters(f=>({...f,period:'all'}))}]:[])];
 const changeFilters=patch=>{setFilters(current=>({...current,...patch}));setPage(1);};
 const scopeItems=[...(projectScope?[{key:projectScope.id,label:<><BookMark size={16}/><DriftLabel title={projectScope.name}>{projectScope.name}</DriftLabel></>}]:[]),...(mailRoot?[{key:mailRoot.id,label:<><Icon name="mail" size={16}/>메일</>}]:[])];
 return <section className="nubi-wiki-browser" data-external-reader={!!detailHost||undefined} data-map={view==='map'||undefined} aria-label="내 위키">
  <header className="nubi-wiki-bar">{onBack&&<WorkspaceAction action="back" label="대화로 돌아가기" onClick={onBack}/>}<span className="nubi-wiki-badge" aria-hidden="true"><BookMark size={22}/></span><h1>위키</h1>{scopeItems.length===1&&<span className="nubi-wiki-scope-name">{isMail?'메일':projectScope?.name}</span>}<span className="nubi-wiki-count">{graph.nodes.length}개</span>
   {loading&&<span className="status-spinner" role="status" aria-label="위키 읽는 중"/>}
   <WorkspaceAction action="refresh" label="위키 새로고침" disabled={loading||saving} onClick={()=>load({restore:true})}/>
   {!isMail&&<WorkspaceAction action="add" iconOnly label="새 문서" disabled={!scope||saving} onClick={()=>setNewName('')}/>}
   {onSettings&&<CxButton className="nubi-wiki-settings-link" data-icon-only aria-label="위키 설정" title="위키 설정" onClick={onSettings}><Icon name="sliders" size={18}/></CxButton>}
  </header>
  {scopeItems.length>1&&<div className="nubi-wiki-scope">
   {scopeItems.length>0&&<WorkspaceCatalogTabs wide label="위키 자료" idPrefix="wiki-scope" active={isMail?mailRoot.id:projectScope?.id||''} onChange={value=>{if(!saving)setScope(value);}} items={scopeItems}/>}
  </div>}
  <WorkspaceCatalogTabs wide={false} label="위키 보기" idPrefix="wiki-view" active={view==='documents'?'documents':mapMode==='network'?'network':'map'} onChange={value=>{setMapReaderOpen(false);setView(value==='documents'?'documents':'map');setMapMode(value==='network'?'network':'overview');}} items={[{key:'documents',label:<><Icon name="list" size={16}/>문서 목록</>},{key:'map',label:<><Icon name="link" size={16}/>함께 읽기</>},{key:'network',label:<><BranchMark size={16}/>관계 지도</>}]}/>
  {!isMail&&scope===projectId&&<WikiCoverageBadge api={api} projectId={projectId} onOpenUpdate={onSettings} onOpenPage={path=>void open(path.replace(/^openwiki\//,''),{reveal:true})} disabled={saving}/>}
  {error&&<p role="alert" className="nubi-wiki-error">{error}</p>}{notice&&<p role="status" className="nubi-wiki-saved">{notice}</p>}
  <div className="nubi-wiki-workbench" data-reader-open={view==='map'&&mapReaderOpen||undefined}>
  <div ref={explorer} tabIndex={-1} className="nubi-wiki-explorer" aria-label="위키 탐색">
  {view==='map'?<WikiMap key={scope} mode={mapMode} loading={mapState==='loading'} unavailable={mapState==='error'} graph={graph} selectedPath={doc?.path} onOpen={openFromMap} disabled={saving}/>:<div className="nubi-wiki-list">
   <div className="nubi-collection-controls">
   <div className="nubi-mail-search-input-row" onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&paged.rows[0]){e.preventDefault();void open(paged.rows[0].path);}}}><SearchField label="위키 문서 검색" placeholder="위키 검색" title={isMail?'제목, 설명, 태그, 경로에서 찾아요':'제목, 설명, 태그, 경로와 본문에서 찾아요'} maxLength={200} value={query} onChange={value=>{setQuery(value);setPage(1);}}/></div>
   {currentSearch&&<p className="nubi-muted" role="status">{currentSearch.state==='loading'?'본문 검색 중':currentSearch.state==='error'?'본문을 확인하지 못해 제목·설명·태그·경로에서만 찾았어요.':currentSearch.truncated||list.truncated?'제목·태그·본문 검색 · 일부 문서를 확인하지 못했어요.':'제목·태그·본문에서 찾았어요.'}</p>}
   <div className="nubi-mail-result-toolbar"><span>{(query||chips.length>0)&&<><Icon name="filter" size={14}/>{filtered.length}개</>}</span><WikiPagination page={paged.page} totalPages={paged.totalPages} total={paged.total} offset={paged.offset} count={paged.rows.length} size={size} sort={sort} disabled={loading} onPage={setPage} onSize={value=>{setSize(value);setPage(1);try{localStorage.setItem(sizeKey,String(value));}catch{}}} onSort={value=>{setSort(value);setPage(1);}}/></div>
   </div>
   {!!chips.length&&<div className="nubi-mail-filter-chips" aria-label="선택한 조건">{chips.map(chip=><span key={chip.label}>{chip.label}<WorkspaceAction action="clearSearch" label={`${chip.label} 조건 제거`} onClick={chip.clear}/></span>)}</div>}
   <div className="nubi-wiki-results">
    {paged.rows.length>0&&<WikiTable rows={paged.rows} selectedPath={doc?.path} sort={sort} onSort={value=>{setSort(value);setPage(1);}} onOpen={path=>{void open(path,{reveal:true});}} filters={filters} facets={facets} onFilters={changeFilters} disabled={saving} colors={colors} drafts={new Set([...wikiDrafts.keys()].filter(key=>key.startsWith(scope+':')).map(key=>key.slice(scope.length+1)))}/>}
    {!paged.rows.length&&!loading&&<div className="nubi-wiki-empty-rows"><Icon name={query||chips.length?'search':'file'} size={28}/><strong>{query||chips.length?'조건에 맞는 문서가 없어요.':'아직 위키 문서가 없어요.'}</strong><p>{query||chips.length?'검색어나 필터를 바꿔 보세요.':isMail?'메일을 가져오면 정리한 위키가 여기에 쌓여요.':'위키를 준비하거나 새 문서를 작성해 보세요.'}</p></div>}
    {!paged.rows.length&&loading&&<LoadingNote className="nubi-wiki-loading">위키를 불러오는 중</LoadingNote>}
   </div>
   <PageNumbers page={paged.page} totalPages={paged.totalPages} disabled={loading} label="위키 문서" onPage={value=>setPage(value)}/>
   {(list.truncated||list.skipped?.length>0)&&<p className="nubi-muted nubi-note"><Icon name="infoCircle" size={14}/>읽을 수 있는 문서만 표시했어요. 최대 3,000개, 120MB입니다.</p>}
  </div>}
  </div>
  <AuxiliaryDetail host={detailHost} kind="wiki-detail" title={title||'위키 문서'} open={detailOpen} onClose={closeDetail}>
  <article ref={reader} tabIndex={-1} hidden={!detailHost&&view==='map'&&!mapReaderOpen} className="nubi-wiki-document" aria-label="위키 문서" aria-busy={loading}>
   {!detailHost&&view==='map'&&<div className="nubi-wiki-reader-navigation"><CxButton onClick={closeMapReader} aria-label="탐색으로 돌아가기"><Icon name="arrowLeft" size={16}/>탐색으로 돌아가기</CxButton><span>{dirty?'초안 보관 중':loading?'불러오는 중':'문서 읽기'}</span></div>}
   {doc?<div className="nubi-wiki-document-content" key={doc.path}>
    <header>
     <div className="nubi-wiki-document-heading"><h2 title={doc.path}>{title}</h2>
      <div className="nubi-wiki-document-meta">{described.type&&<span className="nubi-wiki-type">{selected?.type||described.type}</span>}<span><Icon name="layers" size={13}/>{sectionLabel(selected?.section??wikiSection(doc.path))}</span>{doc.updatedAt&&<time dateTime={doc.updatedAt} title="마지막 수정"><Icon name="clock" size={13}/>{mailTableDate(doc.updatedAt)}</time>}{selected&&<span title="연결된 문서"><Icon name="link" size={13}/>{selected.degree}</span>}{dirty&&<span className="nubi-wiki-dirty">저장 전</span>}</div>
     </div>
     <div className="nubi-wiki-document-actions">{editing?<><WorkspaceAction action="cancel" iconOnly label="수정 취소" disabled={saving} onClick={cancelEdit}/><WorkspaceAction action="save" label="위키 저장" disabled={!dirty||saving} onClick={save}/></>:<><WorkspaceAction action="edit" iconOnly label="위키 수정" title="위키 수정" onClick={()=>setEditing(true)}/>{onRewrite&&doc.hash&&<CxButton data-icon-only disabled={saving} aria-label="다시 작성 요청" title="다시 작성 요청: OpenWiki 에이전트에게 이 문서를 다시 쓰게 해요" onClick={()=>onRewrite({path:doc.path,title,kind:isMail?'mail':'project',scopeId:scope})}><Icon name="agent" size={18}/></CxButton>}{openPath&&!isMail&&doc.hash&&<WorkspaceAction action="openExternal" iconOnly label="원본 열기" title="원본 열기" onClick={()=>openPath('openwiki/'+doc.path)}/>}</>}</div>
    </header>
    {!editing&&described.description&&<p className="nubi-wiki-description">{described.description}</p>}
    {!editing&&described.tags.length>0&&<div className="nubi-wiki-tags" aria-label="태그">{described.tags.map(tag=><span key={tag}><Icon name="tag" size={12}/>{tag}</span>)}</div>}
    {editing?<textarea className="nubi-wiki-editor" aria-label="위키 본문" value={text} maxLength={isMail?60000:1048576} disabled={saving} onChange={e=>change(e.target.value)} spellCheck={false}/>:<MessageBody role="assistant" content={body}/>}
    {!editing&&facts?.length>0&&<section className="nubi-wiki-facts" aria-label="사실 이력"><h3><Icon name="clock" size={16}/>사실 이력 {facts.length}개</h3><ShowMore items={facts} step={8} resetKey={doc?.path}>{rows=><ul>{rows.map(fact=><li key={fact.id}><span className="nubi-wiki-fact-key">{fact.subject} <small>{fact.predicate}</small></span><span className="nubi-wiki-fact-value"><strong>{fact.value}</strong><time dateTime={fact.validFrom}>{mailTableDate(fact.validFrom).slice(0,10)}부터</time>{fact.history?.map((entry,index)=><span key={index} className="nubi-wiki-fact-past"><s>{entry.value}</s><time dateTime={entry.validFrom}>{mailTableDate(entry.validFrom).slice(0,10)}</time></span>)}</span></li>)}</ul>}</ShowMore></section>}
    {(related.length>0||editing)&&<section className="nubi-wiki-links" aria-label="연결된 문서">
     {related.length>0&&<><h3 title={list.relationsTruncated?'후보가 많아 가까운 관련 문서부터 표시합니다.':undefined}><Icon name="link" size={16}/>연결된 문서 {related.length}개{list.relationsTruncated?' (일부)':''}</h3><ShowMore items={related} step={8} resetKey={doc?.path}>{rows=><nav>{rows.map(item=><button type="button" key={item.path} title={`${item.reasons.join(', ')} (${item.path})`} disabled={saving} onClick={()=>open(item.path)}><Icon name={item.relationship?.confidence==='candidate'?'link':directionIcon[item.direction]} size={14}/><span><strong>{item.title}</strong>{item.relationship?.label&&<small className="nubi-wiki-relation-label">{item.relationship.label}{item.date?` / ${mailTableDate(item.date).slice(0,10)}`:''}</small>}</span><span className="nubi-wiki-relation-evidence">{item.relationship?.confidence==='candidate'?'후보':'기록된 연결'}</span></button>)}</nav>}</ShowMore></>}
     {editing&&<div className="nubi-wiki-link-editor"><CxSelect aria-label="연결할 위키" value={link} onChange={e=>setLink(e.target.value)}><option value="">연결할 문서</option>{list.items.filter(i=>i.path!==doc.path).map(i=><option key={i.path} value={i.path}>{i.title}</option>)}</CxSelect><CxButton disabled={!link||saving} onClick={connect}><Icon name="plus" size={16}/>링크 추가</CxButton></div>}
    </section>}
   </div>:<div className="nubi-wiki-empty"><AgentMark size={56} mood="idle"/><strong>{error?'문서를 열지 못했어요.':'선택된 문서가 없어요.'}</strong><p>{error?'목록에서 다른 문서를 선택해 주세요.':graph.nodes.length?'목록이나 지도에서 문서를 선택하세요.':isMail?'메일을 가져오면 정리한 위키가 여기에 쌓여요.':'위키를 준비하거나 새 문서를 작성해 보세요.'}</p></div>}
  </article>
  </AuxiliaryDetail>
  </div>
  {newName!==null&&<DetailPanel className="deck-dialog" variant="modal" title="새 위키 문서" onClose={()=>setNewName(null)} footer={<CxButton variant="primary" disabled={!newName?.trim()} onClick={create}>만들기</CxButton>}><CxInput aria-label="문서 이름" placeholder="문서 이름" value={newName} maxLength={100} onChange={e=>setNewName(e.target.value)}/></DetailPanel>}
 </section>;
}

import {MailTable} from './MailTable.jsx';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import React,{startTransition,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CxButton, CxInput, SearchField, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {MailMatchText,mailDate,mailLocation} from './MailMatchText.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {DEFAULT_MAIL_FILTERS,mailFilterChips} from './MailSearchToolbar.jsx';
import {cleanMailPreview} from '../runtime/mail-preview.mjs';
import {SavedMailSearches} from './SavedMailSearches.jsx';
import {CxSelect} from './WorkspaceSelect.jsx';
import {PageNumbers} from './PageNumbers.jsx';

const defaults=DEFAULT_MAIL_FILTERS;
const periods={all:'전체 기간','7':'최근 7일','30':'최근 30일',custom:'기간 지정',unknown:'날짜 미확인'};
const periodChoices=['all','7','30','custom','unknown'];
const attachments={all:'모든 메일',with:'첨부 있음',without:'첨부 없음',pdf:'PDF',word:'Word',excel:'Excel',powerpoint:'PowerPoint'};
const pageSizes=[10,20,50,100],sizeKey='nubi-mail-page-size-v1';
function preferredSize(){try{const value=Number(localStorage.getItem(sizeKey));return pageSizes.includes(value)?value:20;}catch{return 20;}}
export function MailKnowledgeSearch({api,query,onQuery,lastAppliedAt,revision,refreshKey=0,accountKey=null,selectedId,onOpen,onAskSearch,onAskSelected,onResults,viewState,mailbox='all'}){
  const saved=viewState?.current?.search?.accountKey===accountKey?viewState.current.search:null;
  const [filters,setFilters]=useState(()=>saved?.filters||defaults),[size,setSize]=useState(preferredSize),[sort,setSort]=useState(()=>saved?.sort||'auto'),[navigation,setNavigation]=useState(()=>saved?.navigation||{page:1,cursor:null}),[pageDraft,setPageDraft]=useState('1');
  const [packet,setPacket]=useState(null),[pending,setPending]=useState(true),[failed,setFailed]=useState(false),[savedOpen,setSavedOpen]=useState(false),[tags,setTags]=useState([]),[asking,setAsking]=useState(false);
  const [columnFacets,setColumnFacets]=useState({senders:[]});
  const [selected,setSelected]=useState(()=>saved?.selected||[]),[selecting,setSelecting]=useState(false);
  const [refreshRequest,setRefreshRequest]=useState(0);
  const dataRevision=JSON.stringify([lastAppliedAt,revision]),latestRevision=useRef(dataRevision);latestRevision.current=dataRevision;
  const [density,setDensity]=useState(()=>{try{return localStorage.getItem('nubi-mail-density')==='compact'?'compact':'comfortable';}catch{return 'comfortable';}});
  const resultsRef=useRef(null),shownView=useRef(null),initialScroll=useRef(saved?.scrollTop||0),selectionLock=useRef(false);
  useLayoutEffect(()=>{if(viewState)viewState.current={...viewState.current,search:{...viewState.current?.search,accountKey,filters,sort,navigation,selected}};},[filters,sort,navigation,selected,viewState,accountKey]);
  const term=query.trim(),wire={...filters,mailbox};
  const attachmentChoice=filters.types[0]||filters.attachment;
  useEffect(()=>{let live=true;void api('mail',{action:'facets'}).then(value=>{if(live){setTags(value.tags||[]);setColumnFacets(value);}}).catch(()=>{});return()=>{live=false;};},[api,packet?.dataRevision]);
  const signature=JSON.stringify([term,wire,size,sort]);
  const currentPage=packet?.page||1,totalPages=packet?.totalPages||1;
  const invalidRange=filters.period==='custom'&&(!filters.from||!filters.to||filters.from>filters.to);
  const currentPacket=packet?.signature===signature&&packet?.requestPage===navigation.page;
  const blocked=invalidRange||!currentPacket;
  const updateAvailable=!!packet&&packet.dataRevision!==dataRevision;
  useEffect(()=>{
    let live=true;setPending(true);setFailed(false);
    if(invalidRange){setPending(false);setPacket(null);return;}
    const timer=setTimeout(async()=>{let scheduled=false;try{
      const observedRevision=latestRevision.current;
      // A numbered UI page is an explicit navigation request, not a cursor
      // accumulation. An arrival must never silently send the reader to page 1.
      const result=await api('mail',{action:'search',query:term,filters:wire,limit:size,sort:sort==='auto'?(term?'relevance':'newest'):sort,page:navigation.page});
      if(!live)return;
      const viewKey=JSON.stringify([signature,navigation.page]);
      const changeDraft=viewKey!==shownView.current||result.reset;
      // Search result rendering is background work. Commit its packet, page
      // label and pending state together, yielding to current pointer/key input.
      startTransition(()=>{
        if(changeDraft)setPageDraft(current=>live?String(result.page||1):current);
        setPacket(current=>live?{...result,signature,requestPage:navigation.page,viewKey,dataRevision:observedRevision}:current);
        setPending(current=>live?false:current);
      });scheduled=true;
    }catch{if(live){setFailed(true);notifyWorkspaceToast('메일을 검색하지 못했어요. 다시 확인해 주세요.',{error:true});}}finally{if(live&&!scheduled)setPending(false);}},term||filters.senders.length||filters.filename?300:0);
    return()=>{live=false;clearTimeout(timer);};
  // Background ingestion changes only the update affordance. Never replace
  // rows or disable a pointer/keyboard target while someone is reading them.
  },[api,signature,navigation.page,refreshKey,refreshRequest,invalidRange]);
  useLayoutEffect(()=>{
    if(packet?.viewKey&&shownView.current!==packet.viewKey){if(resultsRef.current)resultsRef.current.scrollTop=shownView.current?0:initialScroll.current;shownView.current=packet.viewKey;}
  },[packet]);
  async function askSearch(){
    if(asking||invalidRange||!term)return;
    setAsking(true);
    try{await onAskSearch({query:term,filters:wire});}
    catch(error){notifyWorkspaceToast(error.message==='agent_input_invalid'?'초안이 길어요. 입력창 내용을 줄인 뒤 다시 연결해 주세요.':'지금은 대화에 연결할 수 없어요. 진행 중인 확인을 마친 뒤 다시 시도해 주세요.',{error:true});}
    finally{setAsking(false);}
  }
  useEffect(()=>{onResults?.({...packet,blocked,query:term,signature,movePage:goPage});},[packet,blocked,signature,onResults]);
  function toggle(result){
    setSelected(current=>{if(current.some(item=>item.id===result.sourceId))return current.filter(item=>item.id!==result.sourceId);
      if(current.length>=20){notifyWorkspaceToast('한 번에 20개까지 선택할 수 있어요.');return current;}
      return [...current,{id:result.sourceId,sourceHash:result.sourceHash,title:result.title}];});
  }
  const pageRows=packet?.results||[],allSelected=pageRows.length>0&&pageRows.every(row=>selected.some(item=>item.id===row.sourceId));
  function togglePage(){
    if(allSelected){setSelected(current=>current.filter(item=>!pageRows.some(row=>row.sourceId===item.id)));return;}
    const additions=pageRows.filter(row=>!selected.some(item=>item.id===row.sourceId));
    if(selected.length+additions.length>20){notifyWorkspaceToast('한 번에 20개까지 선택할 수 있어요. 필요한 메일을 골라 주세요.');return;}
    setSelected(current=>[...current,...additions.map(row=>({id:row.sourceId,sourceHash:row.sourceHash,title:row.title}))]);
  }
  async function askSelected(){
    if(selectionLock.current||!selected.length)return;selectionLock.current=true;setSelecting(true);
    try{await onAskSelected(selected);}
    catch(error){notifyWorkspaceToast(error.message==='mail_source_changed'?'선택한 원문이 바뀌었어요. 목록에서 다시 선택해 주세요.':error.message==='mail_reference_limit'?'연결할 수 있는 메일은 20개예요. 입력창의 메일을 일부 제거해 주세요.':'메일을 연결하지 못했어요. 선택은 유지했습니다.',{error:true});}
    finally{selectionLock.current=false;setSelecting(false);}
  }
  function resetPage(){setSelected([]);setPageDraft('1');setNavigation({page:1,cursor:null});}
  function changeFilters(patch){setFilters(current=>({...current,...patch}));resetPage();}
  function goPage(page){if(blocked||pending)return;const target=Math.max(1,Math.min(totalPages,page));setPageDraft(String(target));if(target!==currentPage)setNavigation({page:target,cursor:null});}
  function commitPage(){if(blocked)return;const value=Number(pageDraft);if(Number.isSafeInteger(value)&&value>0)goPage(value);else setPageDraft(String(currentPage));}
  const chips=mailFilterChips(filters).map(chip=>({...chip,clear:()=>changeFilters(chip.patch)}));
  return <div className="nubi-mail-search" data-density={density}>
    <div className="nubi-mail-collection-controls">
    <div className="nubi-mail-search-input-row"><SearchField label="메일 검색" placeholder="메일 검색" title="제목, 주소, 날짜, 태그, 본문과 첨부 파일명 검색" maxLength={500} value={query} onChange={value=>{resetPage();onQuery(value);}}/><details className="nubi-mail-filters" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}><summary aria-label="메일 검색 조건" title="검색 조건"><Icon name="sliders" size={16}/><span>검색 조건</span>{chips.length>0&&<span className="nubi-mail-filters-count" title={`적용한 조건 ${chips.length}개`}><span className="visually-hidden">적용한 조건 </span>{chips.length}</span>}<Icon name="chevronDown" size={14}/></summary><div className="nubi-mail-filter-fields">
      <label><span><Icon name="calendar" size={16}/>기간</span><CxSelect aria-label="메일 기간" value={filters.period} onChange={event=>changeFilters({period:event.target.value})}>{periodChoices.map(id=><option key={id} value={id}>{periods[id]}</option>)}</CxSelect></label>
      {filters.period==='custom'&&<div className="nubi-mail-date-range"><CxInput type="date" aria-label="메일 시작 날짜" value={filters.from} onChange={event=>changeFilters({from:event.target.value})}/><CxInput type="date" aria-label="메일 끝 날짜" value={filters.to} onChange={event=>changeFilters({to:event.target.value})}/></div>}
      <label><span><Icon name="mail" size={16}/>보낸 사람</span><CxInput aria-label="메일 보낸 사람" placeholder="이름 또는 메일 주소" maxLength={200} value={filters.senders[0]||''} onChange={event=>changeFilters({senders:event.target.value?[event.target.value]:[]})}/></label>
      <label><span><Icon name="file" size={16}/>첨부</span><CxSelect aria-label="메일 첨부 조건" value={attachmentChoice} onChange={event=>{const value=event.target.value;changeFilters({attachment:['with','without','all'].includes(value)?value:'with',types:['with','without','all'].includes(value)?[]:[value]});}}>{Object.entries(attachments).map(([id,label])=><option key={id} value={id}>{label}</option>)}</CxSelect></label>
      <details className="nubi-mail-extra-filters"><summary><Icon name="plus" size={14}/><span>추가 조건</span><Icon name="chevronDown" size={14}/></summary><div>
        <CxButton className="nubi-mail-pin-filter" aria-pressed={filters.pinned} onClick={()=>changeFilters({pinned:!filters.pinned})}><Icon name="bookmark" size={16}/>고정한 메일{filters.pinned&&<Icon name="check" size={14}/>}</CxButton>
        <label><span><Icon name="tag" size={16}/>태그</span><CxSelect aria-label="메일 태그 조건" value={filters.tags[0]||''} onChange={event=>changeFilters({tags:event.target.value?[event.target.value]:[]})}><option value="">전체 태그</option>{[...new Set([...tags,...filters.tags])].map(tag=><option key={tag} value={tag}>{tag}</option>)}</CxSelect></label>
        <label><span><Icon name="file" size={16}/>파일명</span><CxInput aria-label="메일 첨부 파일명" placeholder="파일명에 포함된 단어" maxLength={200} value={filters.filename} onChange={event=>changeFilters({filename:event.target.value})}/></label>
        <label><span><Icon name="search" size={16}/>검색 위치</span><CxSelect aria-label="메일 검색 위치" value={filters.locations[0]||''} onChange={event=>changeFilters({locations:event.target.value?[event.target.value]:[]})}><option value="">전체 내용</option><option value="subject">제목과 보낸 사람</option><option value="metadata">받는 사람, 참조, 날짜와 태그</option><option value="body">본문</option><option value="attachment">첨부 파일명</option><option value="knowledge">핵심 정리</option></CxSelect></label>
      </div></details>
    </div></details><CxButton className="nubi-mail-saved-trigger" aria-label="저장한 검색" title="저장한 검색" aria-haspopup="dialog" onClick={()=>setSavedOpen(true)}><Icon name="save" size={16}/></CxButton></div>
    <div className="nubi-mail-result-toolbar">

      {selected.length?<><span className="nubi-mail-selection-count">{selected.length}개 선택</span><CxButton disabled={selecting} onClick={askSelected}><Icon name="message" size={16}/><span>{selecting?'연결 중':'AI에 질문'}</span></CxButton><ActionButton action="clearSearch" label="메일 선택 해제" disabled={selecting} onClick={()=>setSelected([])}/></>:onAskSearch&&term?<CxButton className="nubi-mail-ai-search" disabled={asking||invalidRange} title="검색어와 조건을 대화 초안으로 가져오기" onClick={askSearch}><Icon name="agent" size={16}/><span>{asking?'연결 중':'AI로 찾기'}</span></CxButton>:null}
      <div className="nubi-mail-pagination">
        {updateAvailable&&<CxButton className="nubi-mail-list-update" aria-label="메일 목록 업데이트" title="새 내용을 반영해요. 현재 메일과 선택은 유지됩니다." disabled={pending} onClick={()=>setRefreshRequest(value=>value+1)}><Icon name="refresh" size={16}/><span>목록 업데이트</span></CxButton>}
        {pending&&<span className="status-spinner" role="status" aria-label="검색 중"/>}
        <details className="nubi-mail-page-options" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}>
          <summary aria-label="메일 페이지 설정" title="페이지 이동과 목록 보기"><span aria-live="polite">{packet?.total?`${packet.offset+1}–${packet.offset+packet.results.length} / ${packet.total}`:'0개'}</span><Icon name="chevronDown" size={12}/></summary>
          <div className="nubi-mail-page-popover">
            <label><span className="nubi-mail-page-label"><Icon name="list" size={16}/>페이지</span><span className="nubi-mail-page-number"><CxInput aria-label="메일 페이지" inputMode="numeric" value={pageDraft} disabled={blocked} maxLength={8} onChange={event=>{if(/^\d*$/.test(event.target.value))setPageDraft(event.target.value);}} onBlur={commitPage} onKeyDown={event=>{if(event.nativeEvent.isComposing)return;if(event.key==='Enter'){event.preventDefault();commitPage();}}}/><span>/ {totalPages}</span></span></label>
            <label><span className="nubi-mail-page-label"><Icon name="layers" size={16}/>표시 개수</span><CxSelect aria-label="페이지당 메일 수" value={size} onChange={event=>{const value=Number(event.target.value);setSize(value);resetPage();try{localStorage.setItem(sizeKey,String(value));}catch{}}}>{pageSizes.map(count=><option key={count} value={count}>{count}개씩</option>)}</CxSelect></label>
            <label><span className="nubi-mail-page-label"><Icon name="sort" size={16}/>정렬</span><CxSelect aria-label="메일 정렬" value={sort} onChange={event=>{setSort(event.target.value);resetPage();}}><option value="auto">{term?'관련도순':'최신순'}</option><option value="newest">최신순</option><option value="oldest">오래된순</option>{[["subject-asc","제목 오름차순"],["subject-desc","제목 내림차순"],["sender-asc","보낸 사람 오름차순"],["sender-desc","보낸 사람 내림차순"],["role-asc","구분 오름차순"],["role-desc","구분 내림차순"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</CxSelect></label>
            <label><span className="nubi-mail-page-label"><Icon name="layoutGrid02" size={16}/>간격</span><CxSelect aria-label="메일 목록 간격" value={density} onChange={event=>{setDensity(event.target.value);try{localStorage.setItem('nubi-mail-density',event.target.value);}catch{}}}><option value="comfortable">편안하게</option><option value="compact">간결하게</option></CxSelect></label>
          </div>
        </details>
        <ActionButton action="previousMedia" iconOnly label="이전 메일 페이지" disabled={blocked||pending||currentPage<=1} onClick={()=>goPage(currentPage-1)}/>
        <ActionButton action="nextMedia" iconOnly label="다음 메일 페이지" disabled={blocked||pending||currentPage>=totalPages} onClick={()=>goPage(currentPage+1)}/>
      </div>
    </div>
    </div>
    {!!chips.length&&<div className="nubi-mail-filter-chips" aria-label="선택한 검색 조건">{chips.map(chip=><span key={chip.label+JSON.stringify(chip.patch)}>{chip.label}<ActionButton action="clearSearch" label={`${chip.label} 조건 제거`} onClick={chip.clear}/></span>)}</div>}
    <div ref={resultsRef} className="nubi-mail-results" role="region" tabIndex={0} aria-label="메일 검색 결과" aria-busy={pending} onScroll={event=>{if(viewState)viewState.current={...viewState.current,search:{...viewState.current?.search,scrollTop:event.currentTarget.scrollTop}};}}>
      {invalidRange?<p className="nubi-mail-search-hint">시작 날짜와 끝 날짜를 확인해 주세요.</p>:failed&&!currentPacket?<DeckEmpty title="검색을 완료하지 못했어요" description="검색어나 조건을 바꿔 다시 확인해 주세요."/>:packet&&<MailTable filters={filters} facets={columnFacets} onFilters={changeFilters} rows={packet.results} selected={selected} selectedId={selectedId} blocked={blocked} selecting={selecting} toggle={toggle} togglePage={togglePage} allSelected={allSelected} sort={sort} onSort={value=>{setSort(value);resetPage();}} onOpen={onOpen} query={term}/>}

      {!pending&&!failed&&!invalidRange&&packet&&!packet.results.length&&<DeckEmpty title={term||chips.length?'검색 결과가 없어요':mailbox.startsWith('local:')?'가져온 문서가 없어요':({inbox:'받은 메일이 없어요',sent:'보낸 메일이 없어요',draft:'임시 보관한 메일이 없어요',spam:'스팸 메일이 없어요'})[mailbox]||'표시할 메일이 없어요'} description={term||chips.length?'검색어나 조건을 바꿔 보세요.':mailbox.startsWith('local:')?'다른 분류를 선택하거나 파일을 가져와 주세요.':mailbox==='sent'?'':'메일 연결에서 수집 상태를 확인해 주세요.'}/>}
    </div>
    <PageNumbers page={currentPage} totalPages={totalPages} disabled={blocked||pending} label="메일" onPage={goPage}/>
    {packet&&(packet.unreadAttachments>0||packet.bodyTruncated>0||packet.unavailable?.length>0)&&<details className="nubi-mail-search-coverage"><summary><Icon name="infoCircle" size={13}/>검색 범위 확인</summary>{packet.unreadAttachments>0&&<p>{DESKTOP_FEATURES.mailAttachmentReading?`아직 읽지 못한 첨부 ${packet.unreadAttachments}개는 파일명으로만 검색해요.`:'첨부는 파일명으로만 검색해요.'}</p>}{packet.bodyTruncated>0&&<p>긴 본문 일부가 검색에서 빠진 메일 {packet.bodyTruncated}개가 있어요.</p>}{packet.unavailable?.length>0&&<p>원문을 확인할 수 없는 메일 {packet.unavailable.length}개는 제외했어요.</p>}</details>}
    {savedOpen&&<SavedMailSearches api={api} query={query} filters={wire} sort={sort} onApply={item=>{setFilters({...defaults,...item.filters});setSort(item.sort||'auto');onQuery(item.query||'');resetPage();}} onClose={()=>setSavedOpen(false)}/>}
  </div>;
}

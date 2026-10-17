import React,{useMemo,useState} from 'react';
import {CxButton,Icon,SearchField} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {WikiNetwork} from './WikiNetwork.jsx';
import {recordedWikiGraph,wikiMapInsights} from './wiki-map-insights.mjs';
import './wiki-insights.css';

const lenses=[
 {id:'connected',label:'함께 읽을 자료',icon:'link',unit:'문서',note:'기록된 연결이 있는 문서'},
 {id:'bridges',label:'분야를 잇는 자료',icon:'layers',unit:'문서',note:'다른 분류의 문서와 연결'},
 {id:'isolated',label:'연결 없이 보관',icon:'file',unit:'문서',note:'기록된 연결이 아직 없는 문서'},
 {id:'candidates',label:'검토할 관련 후보',icon:'search',unit:'쌍',note:'주제 유사도로 찾은 후보'},
];
function ReadingLinks({rows,onOpen,disabled}){
 const [limit,setLimit]=useState(6);
 return <details className="nubi-wiki-reading-links"><summary>함께 볼 자료 {rows.length}개</summary><ul>{rows.slice(0,limit).map(row=><li key={row.path}><button type="button" disabled={disabled} onClick={()=>onOpen(row.path)}><span>{row.title}</span><Icon name="arrowRight" size={16}/></button><small>{row.reasons.join(' / ')}</small></li>)}</ul>{rows.length>limit&&<CxButton onClick={()=>setLimit(value=>value+6)}>연결 더 보기</CxButton>}</details>;
}
const matches=(node,query)=>[node.title,node.path,node.description,node.category,...(node.tags||[])].some(value=>String(value||'').toLocaleLowerCase().includes(query));
export function WikiMap({graph,selectedPath,onOpen,disabled,loading=false,unavailable=false,mode}){
 const [localView,setView]=useState('overview'),[lens,setLens]=useState('connected'),[query,setQuery]=useState(''),[group,setGroup]=useState(null),[limit,setLimit]=useState(12),[includeCandidates,setIncludeCandidates]=useState(false);
 const view=mode??localView;
 const insights=useMemo(()=>wikiMapInsights(graph),[graph]);
 const groupsByPath=useMemo(()=>new Map(insights.documents.map(doc=>[doc.path,doc.group])),[insights]);
 const network=useMemo(()=>recordedWikiGraph(graph,includeCandidates),[graph,includeCandidates]);
 const needle=query.trim().toLocaleLowerCase(),active=lenses.find(item=>item.id===lens);
 const rows=useMemo(()=>lens==='candidates'?insights.candidates.filter(row=>(group===null||[row.a,row.b].some(node=>groupsByPath.get(node.path)===group))&&(!needle||matches(row.a,needle)||matches(row.b,needle))):insights[lens].filter(row=>(group===null||row.group===group)&&(!needle||matches(row,needle))),[insights,groupsByPath,lens,group,needle]);
 const choose=id=>{setLens(id);setLimit(12);};
 if(!insights.total)return <section className="nubi-wiki-insights nubi-wiki-insights-empty" aria-label="위키 관계 지도" role="status"><Icon name="link" size={24}/><h3>{loading?'자료의 연결을 불러오는 중':unavailable?'관계 지도를 불러오지 못했어요':'자료가 쌓이면 연결을 살펴볼 수 있어요'}</h3><p>{unavailable?'위키를 새로고침해 주세요. 불러오기 실패를 0건으로 집계하지 않아요.':'문서에 기록된 링크와 메일 회신을 바탕으로 함께 읽을 자료를 보여드려요.'}</p></section>;
 return <section className="nubi-wiki-insights" aria-label="위키 관계 지도">
  <header className="nubi-wiki-insights-heading"><div><h3>{view==='network'?'문서 사이의 연결':'함께 읽을 자료 찾기'}</h3><p>{loading?'새로 불러오는 중이에요. 아래는 이전 목록 기준이에요.':unavailable?'새로고침하지 못했어요. 아래는 이전 목록 기준이에요.':`문서 ${insights.total}개 / 기록된 연결 ${insights.recordedPairs}쌍`}</p></div>
   {!mode&&<WorkspaceCatalogTabs wide={false} label="관계 지도 탐색" idPrefix="wiki-insight-view" active={view} onChange={setView} items={[{key:'overview',label:'한눈에 보기'},{key:'network',label:'연결 탐색'}]}/>}
  </header>
  {view==='overview'?<>
   <div className="nubi-wiki-insight-search">
    <SearchField label="관계 자료 찾기" placeholder="제목이나 키워드로 찾기" value={query} onChange={value=>{setQuery(value);setLimit(12);}} maxLength={200}/>
    <CxSelect aria-label={graph.kind==='mail'?'업무 분류로 좁히기':'폴더로 좁히기'} value={group??''} onChange={event=>{setGroup(event.target.value||null);setLimit(12);}}><option value="">전체 {graph.kind==='mail'?'분류':'폴더'}</option>{insights.groups.map(item=><option key={item.label} value={item.label}>{item.label} ({item.count})</option>)}</CxSelect>
   </div>
   <div className="nubi-wiki-insight-metrics" role="group" aria-label="읽을 자료 선택">{lenses.map(item=><button type="button" key={item.id} aria-pressed={lens===item.id} title={item.note} onClick={()=>choose(item.id)}><Icon name={item.icon} size={16}/><span>{item.label}</span><strong aria-label={`${insights[item.id].length}${item.unit}`}>{insights[item.id].length}</strong></button>)}</div>
   <div className="nubi-wiki-insight-reading"><header><div><h4>{active.label}<span className="nubi-wiki-result-count">{rows.length}{lens==='candidates'?'쌍':'개'}</span></h4><p>{lens==='bridges'?'다른 폴더나 업무 분류로 이어지는 문서예요.':lens==='isolated'?'기록된 연결이 없는 자료예요. 단독으로 보관해도 괜찮아요.':lens==='candidates'?'주제 유사 후보예요. 두 원문을 읽고 관련성을 확인해 주세요.':'문서를 열거나 연결 근거를 펼쳐서 읽어 보세요.'}</p></div>{(needle||group)&&<CxButton onClick={()=>{setQuery('');setGroup(null);setLimit(12);}}>조건 지우기</CxButton>}</header>
     <ul className="nubi-wiki-insight-list">{rows.slice(0,limit).map(row=>lens==='candidates'?<li key={JSON.stringify([row.from,row.to])} className="nubi-wiki-candidate"><span className="nubi-wiki-evidence">관련 후보</span><div>{[row.a,row.b].map(node=><button type="button" key={node.path} disabled={disabled} onClick={()=>onOpen(node.path)}><Icon name="file" size={16}/><span>{node.title}</span><Icon name="arrowRight" size={16}/></button>)}</div><p>{row.reasons.join(' / ')}</p></li>:<li key={row.path}><button type="button" className="nubi-wiki-insight-document" aria-pressed={selectedPath===row.path} disabled={disabled} onClick={()=>onOpen(row.path)}><Icon name="file" size={18}/><span><strong>{row.title}</strong><small>{row.group}{row.degree?` / 연결 ${row.degree}개`:' / 기록된 연결 없음'}</small>{row.description&&<span className="nubi-wiki-row-description">{row.description}</span>}{lens==='bridges'&&<small>이어지는 분류: {row.otherGroups.join(', ')}</small>}</span><Icon name="arrowRight" size={16}/></button>{row.evidence.length>0&&<ReadingLinks rows={row.evidence} onOpen={onOpen} disabled={disabled}/>}</li>)}</ul>
     {!rows.length&&<p className="nubi-wiki-insight-no-results">{needle||group?'이 조건에 맞는 자료가 없어요. 검색어나 분류를 바꿔 보세요.':'아직 해당하는 자료가 없어요.'}</p>}
     {rows.length>limit&&<CxButton onClick={()=>setLimit(value=>value+12)}>12개 더 보기</CxButton>}
   </div>
  </>:<><label className="nubi-wiki-candidate-toggle"><input type="checkbox" checked={includeCandidates} onChange={event=>setIncludeCandidates(event.target.checked)}/>관련 후보도 표시 <span>{insights.candidates.length}쌍</span></label><WikiNetwork graph={network} selectedPath={selectedPath} onOpen={onOpen} disabled={disabled}/></>}
  <details className="nubi-wiki-insight-method"><summary>집계 기준과 분류별 현황</summary><div className="nubi-wiki-group-summary">{insights.groups.map(item=><p key={item.label}><strong>{item.label}</strong><span>전체 {item.count}개 / 연결된 문서 {item.connected}개</span></p>)}</div><p>문서 사이의 링크와 메일 회신 정보에 기록된 연결을 셉니다. 같은 두 문서의 중복 연결과 양방향 참조는 한 쌍으로 계산해요. 관련 후보는 별도로 세며 기본 지도에서는 제외해요.</p><p>분야를 잇는 자료는 자신의 폴더 또는 메일 업무 분류와 다른 분류에 연결된 문서예요. 미분류는 제외합니다. 폴더와 분류는 원문에 저장된 값이며, 자동으로 새 주제를 발견했다고 해석하지 않아요.</p><p>지도에서 가까운 위치, 같은 색, 큰 점은 인과관계나 중요도의 증거가 아니에요. 추이와 업무 성과는 이 데이터만으로 계산하지 않습니다.</p></details>
 </section>;
}

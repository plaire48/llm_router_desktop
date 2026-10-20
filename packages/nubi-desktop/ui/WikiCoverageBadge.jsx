import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {ShowMore} from './ShowMore.jsx';
import './wiki-coverage.css';

export function WikiCoverageSummary({report}){
 if(!report)return null;
 return <dl className="nubi-wiki-coverage-facts" aria-label="위키 준비 보고서"><div><dt>문서</dt><dd>{report.pages}개</dd></div><div><dt>모델 호출</dt><dd>{report.modelCalls}회</dd></div><div><dt>소요 시간</dt><dd>{durationLabel(report.durationMs,{keepSeconds:true})}</dd></div><div><dt>정리 횟수</dt><dd>{report.rounds}회</dd></div><div><dt>건너뛴 파일</dt><dd>크기 {report.skipped.large} / 바이너리 {report.skipped.binary} / 인코딩 {report.skipped.encoding}</dd></div></dl>;
}
export function WikiCoverageBadge({api,projectId,onOpenUpdate,disabled=false}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(new Set()),[notice,setNotice]=useState('');const revision=useRef(0),live=useRef(true),lock=useRef(false);
 const load=async()=>{const id=++revision.current;try{const next=await api('wikiCoverage',{projectId});if(live.current&&revision.current===id){setData(next);setSelected(new Set((next?.coverage?.uncovered||[]).slice(0,2000)));setError('');}}catch(cause){if(live.current&&revision.current===id){setData(null);if(!['method_invalid','unsupported'].includes(cause.message))setError('파일 연결 상태를 확인하지 못했어요.');}}};
 useEffect(()=>{live.current=true;void load();const refresh=()=>void load();window.addEventListener('nubi-wiki-updated',refresh);return()=>{live.current=false;revision.current++;window.removeEventListener('nubi-wiki-updated',refresh);};},[api,projectId]);
 const coverage=data?.coverage;if(!coverage)return error?<p role="alert" className="nubi-muted">{error}<CxButton onClick={load}>다시 확인</CxButton></p>:null;
 const missing=coverage.uncovered,total=coverage.important.length,title=total?`중요 파일 연결 ${Math.min(missing.length?99:100,Math.round(coverage.ratio*100))}% (${total-missing.length}/${total})`:'연결할 중요 파일 없음';
 const propose=async()=>{if(lock.current||!selected.size)return;lock.current=true;setBusy(true);setError('');try{await api('wikiUpdate',{method:'propose',coverageFiles:[...selected]});if(live.current){setNotice('갱신 제안을 준비했어요. 확인 후 실행하고 결과를 반영하세요.');onOpenUpdate?.();}}catch{if(live.current)setError('보강 제안을 준비하지 못했어요. 원본과 진행 중인 갱신을 확인해 주세요.');}finally{lock.current=false;if(live.current)setBusy(false);}};
 return <section className="nubi-wiki-coverage" aria-label="위키 파일 연결"><DeckDisclosure title={title} icon="file"><p className="nubi-muted">계획에 연결하거나 현재 근거로 인용한 파일 비율입니다. 내용의 정확도를 뜻하지 않습니다.</p>{data.report&&<><small className="nubi-muted">마지막 준비 기록</small><WikiCoverageSummary report={data.report}/></>}{missing.length>0&&<><p>빠진 중요 파일 {missing.length}개</p><ShowMore items={missing} step={20} resetKey={projectId}>{rows=><ul className="nubi-wiki-coverage-files">{rows.map(file=><li key={file}><label><input type="checkbox" checked={selected.has(file)} disabled={busy||!selected.has(file)&&selected.size>=2000} onChange={event=>setSelected(old=>{const next=new Set(old);event.target.checked?next.add(file):next.delete(file);return next;})}/><span>{file}</span></label></li>)}</ul>}</ShowMore>{missing.length>2000&&<small>한 번에 최대 2,000개를 선택할 수 있어요.</small>}<CxButton disabled={disabled||busy||!selected.size||!onOpenUpdate} onClick={propose}><Icon name="plus" size={16}/>빠진 것 추가</CxButton></>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}</DeckDisclosure></section>;
}

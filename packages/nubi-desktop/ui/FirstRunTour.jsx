import React,{useCallback,useEffect,useLayoutEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './first-run-tour.css';
import {placeCard} from './tourPlacement.js';

// A short guide on the very first launch (user request 2026-10-14). It waits until no dialog is open (the startup mail
// prompt opens on launch), points at real controls rather than whole panels, places its card on the side with room and
// keeps it inside the window, and never dims the window (the native window buttons cannot be dimmed with it).
// Rendered on <body> so no containing block can shift it. Remembered per viewer; automated runs never show it.
const KEY='nubi-first-run-tour-v1';
const STEPS=[
  {targets:['.nubi-workspace-rail button'],limit:4,title:'여기서 이동해요',text:'홈, 메일, 위키, 파일을 왼쪽에서 바로 열어요.'},
  {targets:['.provider-options'],title:'모델을 연결하세요',text:'쓸 AI를 고르면 바로 대화를 시작할 수 있어요.'},
  {targets:['textarea[aria-label="작업 요청"]'],title:'할 일을 적어 보세요',text:'적으면 누비가 계획을 세우고 단계별로 진행해요.'},
  {targets:['.model-trigger'],title:'모델을 바꿀 수 있어요',text:'쓸 모델과 생각 깊이를 여기서 바꿔요.'},
  {targets:['.nubi-toolbar-actions','.nubi-toolbar-account'],title:'오른쪽 위 도구',text:'사용량, 알림, 회사 로그인은 이 줄에 있어요.'},
];
const PAD=6;
const seen=()=>{try{return localStorage.getItem(KEY)==='done';}catch{return true;}};
const remember=()=>{try{localStorage.setItem(KEY,'done');}catch{}};
const dialogOpen=()=>!!document.querySelector('.cx-panel-backdrop,[role="dialog"][aria-modal="true"]:not(.nubi-tour),[role="alertdialog"]');
// The union of the visible elements a step points at.
function stepRect(step){
  const boxes=[];
  for(const selector of step.targets){
    const nodes=[...document.querySelectorAll(selector)].filter(node=>node.getClientRects().length&&node.getBoundingClientRect().width);
    for(const node of step.limit?nodes.slice(0,step.limit):nodes)boxes.push(node.getBoundingClientRect());
  }
  if(!boxes.length)return null;
  const left=Math.min(...boxes.map(b=>b.left)),top=Math.min(...boxes.map(b=>b.top)),right=Math.max(...boxes.map(b=>b.right)),bottom=Math.max(...boxes.map(b=>b.bottom));
  return {left:left-PAD,top:top-PAD,width:right-left+PAD*2,height:bottom-top+PAD*2};
}
export function FirstRunTour({active}){
  const [steps,setSteps]=useState(null),[index,setIndex]=useState(0),[spot,setSpot]=useState(null),[paused,setPaused]=useState(false);
  // Start once the screen is quiet: no dialog open and at least two places to show.
  useEffect(()=>{
    if(!active||steps||navigator.webdriver||seen())return;
    const timer=setInterval(()=>{if(dialogOpen())return;const found=STEPS.filter(stepRect);if(found.length>=2){clearInterval(timer);setSteps(found);}},700);
    return()=>clearInterval(timer);
  },[active,steps]);
  const measure=useCallback(()=>{const step=steps?.[index];setPaused(dialogOpen());setSpot(step?stepRect(step):null);},[steps,index]);
  useLayoutEffect(()=>{if(!steps?.length)return;measure();const timer=setInterval(measure,500);window.addEventListener('resize',measure);return()=>{clearInterval(timer);window.removeEventListener('resize',measure);};},[measure,steps]);
  const close=useCallback(()=>{remember();setSteps([]);},[]);
  const next=useCallback(()=>{if(index>=steps.length-1)close();else setIndex(index+1);},[index,steps,close]);
  useEffect(()=>{if(!steps?.length||paused)return;const key=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[steps,paused,close]);
  // A step whose control left the screen is skipped.
  useEffect(()=>{if(steps?.length&&!spot&&!paused){const timer=setTimeout(()=>{if(!stepRect(steps[index]))next();},800);return()=>clearTimeout(timer);}},[spot,steps,index,paused,next]);
  if(!steps?.length||!spot||paused)return null;
  const step=steps[index],last=index===steps.length-1,card=placeCard(spot);
  return createPortal(<div className="nubi-tour" role="dialog" aria-label="누비 둘러보기">
    <div className="nubi-tour-spot" style={{width:spot.width,height:spot.height,transform:`translate(${spot.left}px,${spot.top}px)`}}/>
    <section key={index} className="nubi-tour-card" style={card}>
      <strong>{step.title}</strong><p>{step.text}</p>
      <div className="nubi-tour-footer">
        <span className="nubi-tour-dots" aria-label={`${index+1} / ${steps.length}`}>{steps.map((_,dot)=><i key={dot} data-current={dot===index||undefined}/>)}</span>
        <CxButton className="nubi-tour-skip" onClick={close}>건너뛰기</CxButton>
        <CxButton variant="primary" autoFocus onClick={next}>{last?<><Icon name="check" size={16}/>시작하기</>:<>다음<Icon name="chevronRight" size={16}/></>}</CxButton>
      </div>
    </section>
  </div>,document.body);
}

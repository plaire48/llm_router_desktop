import React,{useCallback,useEffect,useLayoutEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './first-run-tour.css';

// A short guide on the very first launch (user request 2026-10-14: "처음 화면이면 튜토리얼 형식으로 간단하게 안내").
// A soft spotlight moves between four places with one line each; Next, Skip and Escape. Steps whose target is not on
// screen are left out. Remembered per viewer in local storage; automated runs never show it.
const KEY='nubi-first-run-tour-v1';
const STEPS=[
  {selector:'.nubi-workspace-rail',title:'여기서 이동해요',text:'홈, 메일, 위키, 파일을 왼쪽에서 바로 열어요.'},
  {selector:'textarea[aria-label="작업 요청"]',title:'할 일을 적어 보세요',text:'적으면 누비가 계획을 세우고 단계별로 진행해요.'},
  {selector:'.model-trigger',title:'모델을 고르세요',text:'쓸 모델과 생각 깊이를 여기서 바꿔요.'},
  {selector:'button[aria-label="토큰 사용량"]',title:'오른쪽 위 도구',text:'사용량, 알림, 회사 로그인은 이 줄에 있어요.'},
];
const seen=()=>{try{return localStorage.getItem(KEY)==='done';}catch{return true;}};
const remember=()=>{try{localStorage.setItem(KEY,'done');}catch{}};
export function FirstRunTour({active}){
  const [steps,setSteps]=useState(null),[index,setIndex]=useState(0),[rect,setRect]=useState(null);
  useEffect(()=>{
    if(!active||steps||navigator.webdriver||seen())return;
    // Wait a moment for the screen to settle after the opening scene, then keep the steps that are on screen.
    const timer=setTimeout(()=>{const found=STEPS.filter(step=>document.querySelector(step.selector)?.getClientRects().length);if(found.length)setSteps(found);},500);
    return()=>clearTimeout(timer);
  },[active,steps]);
  const measure=useCallback(()=>{const step=steps?.[index];const node=step&&document.querySelector(step.selector);if(!node){setRect(null);return;}const r=node.getBoundingClientRect();setRect({left:r.left,top:r.top,width:r.width,height:r.height});},[steps,index]);
  useLayoutEffect(()=>{measure();if(!steps)return;window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);},[measure,steps]);
  const close=useCallback(()=>{remember();setSteps([]);},[]);
  useEffect(()=>{if(!steps?.length)return;const key=event=>{if(event.key==='Escape'){event.preventDefault();close();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[steps,close]);
  if(!steps?.length||!rect)return null;
  const step=steps[index],last=index===steps.length-1,pad=8;
  const spot={left:rect.left-pad,top:rect.top-pad,width:rect.width+pad*2,height:rect.height+pad*2};
  const below=spot.top+spot.height+190<innerHeight,cardLeft=Math.max(16,Math.min(spot.left,innerWidth-336));
  const card=below?{left:cardLeft,top:spot.top+spot.height+12}:{left:cardLeft,bottom:innerHeight-spot.top+12};
  return <div className="nubi-tour" role="dialog" aria-modal="true" aria-label="누비 둘러보기">
    <div className="nubi-tour-spot" style={spot}/>
    <section key={index} className="nubi-tour-card" style={card}>
      <strong>{step.title}</strong><p>{step.text}</p>
      <div className="nubi-tour-footer">
        <span className="nubi-tour-dots" aria-label={`${index+1} / ${steps.length}`}>{steps.map((_,dot)=><i key={dot} data-current={dot===index||undefined}/>)}</span>
        <CxButton className="nubi-tour-skip" onClick={close}>건너뛰기</CxButton>
        <CxButton variant="primary" autoFocus onClick={()=>last?close():setIndex(index+1)}>{last?<><Icon name="check" size={16}/>시작하기</>:<>다음<Icon name="chevronRight" size={16}/></>}</CxButton>
      </div>
    </section>
  </div>;
}

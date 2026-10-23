import {createPortal} from 'react-dom';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {WorkspaceBrand} from './WorkspaceBrand.jsx';
import {NUBI_VERSION as VERSION} from './app-version.mjs';
import './cinematic-intro.css';
import {openingSceneId,openingSceneMode,rememberOpeningScene} from './opening-scene.mjs';
import {startIntroFlight} from './introFlight.js';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {WorkspaceAtmosphere} from './WorkspaceAtmosphere.jsx';

// Opening scene, once per launch (user requests 2026-10-14: "영화의 한 장면처럼", more cuts, a real sky, a progress bar,
// a smooth hand-over, and finally "우리가 새가 되어서 날아가는 느낌"). Seen through the bird's eyes: we glide over the
// cloud sea at sunrise, fly into a cloud and burst out into a rushing corridor, climb into the sun's glare, and come out
// onto white, where the wordmark and progress bar gently fade in. Wingbeats lift the view a little, the view banks into
// turns, and cloud wisps rush past. The bar completes when the app reports it
// is ready, then the scene glides away. Transform and opacity only. The full flight is not skippable. Installed apps never bypass it merely because automation is attached. Reduced
// motion uses a short, static opening instead of the flight.
const SCENES=5400,TITLE_MIN=900,COMPLETE=420,LEAVE=620,LONGEST=11000;
let played=false;
// A completed installation rotates its ID even for a same-version reinstall.
// Remember only after the scene completes naturally, never on mount.
const storage={getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)};
export function CinematicIntro({ready=false,onFinish}){
  const [sceneId]=useState(()=>openingSceneId(VERSION,window.nubi?.installationId));
  const [mode]=useState(()=>openingSceneMode({played,automated:navigator.webdriver,installationId:window.nubi?.installationId,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,storage,id:sceneId}));
  const [phase,setPhase]=useState(()=>mode==='none'?'done':mode==='full'?'scenes':'title');
  const finished=useRef(false),finish=useRef(onFinish),flight=useRef(null);finish.current=onFinish;
  const active=phase!=='done';
  useLayoutEffect(()=>{
    if(!window.nubi?.desktop)return;
    const update=active=>{void window.nubi.request('openingScene',{active}).catch(()=>{});};
    update(active);
    return()=>{if(active)update(false);};
  },[active]);
  const bootGuard=useRef(document.body.hasAttribute('data-nubi-opening'));
  useLayoutEffect(()=>{
    if(!bootGuard.current)return;
    // The shell owns its startup lock. #root belongs to CX modal isolation;
    // sharing it restored a stale startup lock when a restored dialog closed.
    if(phase==='done')delete document.body.dataset.nubiOpening;
    else document.body.dataset.nubiOpening=phase==='leave'?'leaving':'intro';
    // The scene is committed outside the app root before the static white cover
    // is removed. No frame can expose the workspace before this hand-over.
    document.getElementById('nubi-boot-cover')?.remove();
  },[phase]);
  // The scene holds its first frame until startup work settles, then plays in real time; started during heavy startup on a
  // slower PC it skipped ahead and went by in a flash (user report 2026-10-14). Waits at most 2.5 s.
  const [started,setStarted]=useState(mode!=='full');
  useEffect(()=>{
    if(started)return;let idle=0,frame=0;
    const go=()=>setStarted(true);
    frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{idle=typeof requestIdleCallback==='function'?requestIdleCallback(go,{timeout:2500}):setTimeout(go,600);});});
    return()=>{cancelAnimationFrame(frame);if(typeof cancelIdleCallback==='function')cancelIdleCallback(idle);clearTimeout(idle);};
  },[started]);
  useEffect(()=>{if(!started||!flight.current||mode!=='full')return;return startIntroFlight(flight.current,{length:4700});},[started,phase==='done']);
  useEffect(()=>{if(phase==='done'&&!finished.current){finished.current=true;played=true;if(mode!=='none')rememberOpeningScene(storage,sceneId);finish.current?.();}},[phase]);
  useEffect(()=>{
    if(phase==='done'||!started)return;
    const timers=[setTimeout(()=>setPhase(current=>current==='scenes'?'title':current),mode==='full'?SCENES:0),setTimeout(()=>setPhase(current=>current==='scenes'?'title':current),LONGEST)];
    return()=>timers.forEach(clearTimeout);
  },[phase==='done',started]);
  // The bar completes once the app is ready and the title has been seen, then the scene hands over.
  useEffect(()=>{
    if(phase!=='title'||!ready)return;
    const timers=[setTimeout(()=>setPhase('complete'),mode==='full'?TITLE_MIN:700)];
    return()=>timers.forEach(clearTimeout);
  },[phase,ready]);
  useEffect(()=>{
    if(phase==='complete'){const timer=setTimeout(()=>setPhase('leave'),COMPLETE);return()=>clearTimeout(timer);}
    if(phase==='leave'){const timer=setTimeout(()=>setPhase('done'),LEAVE);return()=>clearTimeout(timer);}
  },[phase]);
  if(phase==='done')return null;
  return createPortal(<div className="nubi-intro" data-mode={mode} data-phase={phase} data-started={started||undefined} role="region" aria-label="누비 시작 화면">
    <div className="nubi-intro-horizon"/><div className="nubi-intro-horizon nubi-intro-echo nubi-intro-echo-1"/><div className="nubi-intro-horizon nubi-intro-echo nubi-intro-echo-2"/>
    {mode==='full'&&<canvas ref={flight} className="nubi-intro-flight"/>}
    <div className="nubi-intro-tunnel"/>
    <div className="nubi-intro-flash"/>
    {mode==='full'&&<div className="nubi-intro-whiteout"/>}
    {phase!=='scenes'&&<WorkspaceAtmosphere scene="intro" active={phase==='title'||phase==='complete'}/>}
    <div className="nubi-intro-title">
      <div className="nubi-intro-lockup">
        <WorkspaceBrand variant="intro"/>
        <span className="nubi-intro-version" aria-label={`버전 ${VERSION}`}>{VERSION}</span>
      </div>
      <div className="nubi-intro-loading">
        <TaskProgressBar className="nubi-intro-progress" label="Workspace 시작 준비" value={ready?100:undefined} valueText={ready?'준비 완료':'Workspace 준비 중'}/>
        <div className="nubi-intro-progress-status" role="status">
          <span>{ready?'준비 완료':'Workspace 준비 중'}</span>
          {ready&&<span className="nubi-intro-progress-value">100%</span>}
        </div>
      </div>
    </div>
  </div>,document.body);
}

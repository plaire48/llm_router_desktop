import React,{useEffect,useRef,useState} from 'react';
import {AgentMark,NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './cinematic-intro.css';
import {startIntroFlight} from './introFlight.js';

// Opening scene, once per launch (user requests 2026-10-14: "영화의 한 장면처럼", more cuts, a real sky, a progress bar,
// a smooth hand-over, and finally "우리가 새가 되어서 날아가는 느낌"). Seen through the bird's eyes: we glide over the
// cloud sea at sunrise, fly into a cloud and burst out into a rushing corridor, climb into the sun's glare, and come out
// over a calm sky where the wordmark rises over a progress bar. Wingbeats lift the view a little, the view banks into
// turns, and cloud wisps rush past. The bar completes when the app reports it
// is ready, then the scene glides away. Transform and opacity only. A click or key skips it; automated runs and reduced
// motion never show it.
const SCENES=5400,TITLE_MIN=900,COMPLETE=420,LEAVE=620,LONGEST=11000;
let played=false;
// The full scene plays once, on the first launch after installing (user decision 2026-10-14); later launches show only
// the logo and the progress bar. Remembered per viewer in local storage; if storage is unavailable the short form shows.
const SEEN_KEY='nubi-opening-scene-v1';
const firstLaunch=()=>{try{if(localStorage.getItem(SEEN_KEY))return false;localStorage.setItem(SEEN_KEY,'seen');return true;}catch{return false;}};
const skipped=()=>typeof navigator!=='undefined'&&navigator.webdriver||typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
export function CinematicIntro({ready=false,onFinish}){
  const [mode]=useState(()=>played||skipped()?'none':firstLaunch()?'full':'brief');
  const [phase,setPhase]=useState(()=>mode==='none'?'done':mode==='full'?'scenes':'title');
  const finished=useRef(false),finish=useRef(onFinish),flight=useRef(null);finish.current=onFinish;
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
  useEffect(()=>{if(phase==='done'&&!finished.current){finished.current=true;finish.current?.();}},[phase]);
  useEffect(()=>{
    if(phase==='done'||!started)return;played=true;
    const timers=[setTimeout(()=>setPhase(current=>current==='scenes'?'title':current),mode==='full'?SCENES:0),setTimeout(()=>setPhase('done'),mode==='full'?LONGEST:6000)];
    const skip=()=>{setPhase('leave');timers.push(setTimeout(()=>setPhase('done'),260));};
    window.addEventListener('pointerdown',skip,{once:true});window.addEventListener('keydown',skip,{once:true});
    return()=>{timers.forEach(clearTimeout);window.removeEventListener('pointerdown',skip);window.removeEventListener('keydown',skip);};
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
  return <div className="nubi-intro" data-mode={mode} data-phase={phase} data-started={started||undefined} aria-hidden="true">
    <div className="nubi-intro-horizon"/><div className="nubi-intro-horizon nubi-intro-echo nubi-intro-echo-1"/><div className="nubi-intro-horizon nubi-intro-echo nubi-intro-echo-2"/>
    {mode==='full'&&<canvas ref={flight} className="nubi-intro-flight"/>}
    <div className="nubi-intro-tunnel"/>
    <div className="nubi-intro-flash"/>
    <div className="nubi-intro-title">
      <div className="nubi-intro-brand"><span className="nubi-intro-brand-bird"><AgentMark size={64} mood="idle" lively/></span><NubiWordmark/><span>Workspace</span></div>
      <div className="nubi-intro-progress"><span/></div>
    </div>
  </div>;
}

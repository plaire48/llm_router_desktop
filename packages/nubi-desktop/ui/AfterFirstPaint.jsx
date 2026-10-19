import React,{useEffect,useState} from 'react';
import {frameCoalescer} from './frame-coalescer.mjs';
import {LoadingNote} from './LoadingNote.jsx';

// Let the new screen's light shell paint before mounting its expensive subtree.
// Cancellation prevents work for a screen the user has already left.
export function AfterFirstPaint({children}){
 const [ready,setReady]=useState(false);
 useEffect(()=>{
  const mount=frameCoalescer(()=>setReady(true));
  const first=frameCoalescer(()=>mount.schedule());first.schedule();
  return()=>{first.cancel();mount.cancel();};
 },[]);
 return ready?children:<LoadingNote>화면 준비 중</LoadingNote>;
}

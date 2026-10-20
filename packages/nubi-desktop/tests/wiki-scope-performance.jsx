import React,{useState} from 'react';
import {WikiScopeSheet} from '../ui/WikiScopeSheet.jsx';
const folders=Array.from({length:1000},(_,i)=>({path:'synthetic-'+i,files:40,score:1000-i}));
const job={id:'synthetic-performance-scope',scopePlan:{total:40000,folders,selected:['synthetic-0','synthetic-1']}};
export function useWikiScopePerformance(){const [open,setOpen]=useState(false);window.openWikiScope=()=>setOpen(true);return open?<WikiScopeSheet job={job} onClose={()=>setOpen(false)} onSelect={async folders=>{window.wikiScopeSelected=folders;setOpen(false);}}/>:null;}

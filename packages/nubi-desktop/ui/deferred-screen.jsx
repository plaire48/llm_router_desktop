import React,{Suspense,lazy} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {LoadingNote} from './LoadingNote.jsx';

// Each screen gets its own boundary: a missing chunk cannot replace the chat or
// application shell. The normal lazy type is stable; retry alone replaces it.
class ScreenBoundary extends React.Component {
 constructor(props){super(props);this.state={error:null,View:props.View};}
 static getDerivedStateFromError(error){return {error};}
 render(){
  if(this.state.error)return <section className="nubi-deferred-error" role="alert"><p>화면을 불러오지 못했어요.</p><CxButton onClick={()=>this.setState({error:null,View:this.props.retry()})}><Icon name="refresh" size={16}/>다시 불러오기</CxButton></section>;
  const View=this.state.View;
  return <Suspense fallback={<LoadingNote>화면 준비 중</LoadingNote>}><View {...this.props.screenProps}/></Suspense>;
 }
}
export function deferredScreen(importScreen,name){
 const load=()=>importScreen().then(module=>({default:module[name]}));
 let View=lazy(load);
 const retry=()=>{View=lazy(load);return View;};
 function DeferredScreen(props){return <ScreenBoundary View={View} retry={retry} screenProps={props}/>;}
 DeferredScreen.displayName=`Deferred${name}`;
 return DeferredScreen;
}

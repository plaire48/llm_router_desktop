// This is an Office protocol fixture, not a Windows COM implementation.
export function nativeFixture(){
  const c={text:'제목\r회의는 3월 12일입니다.\r',calls:[],objects:new Map(),released:0,
    metadataAvailable:true,gate:null,afterInspection:null,inspection:0,truncated:false,badLength:false,unknownMember:false,collectionCounts:{}};
  function font(pos){return {kind:'Font',Name:'맑은 고딕',Size:pos<3?16:11,Bold:pos<3||pos>=7&&pos<13?-1:0,Italic:0,Underline:0,Color:0};}
  function range(start,end){return {kind:'Range',start,end};}
  const document={kind:'Document'};
  const members={Document:['Range'],Range:['Text','Start','End','StoryType','Font','ParagraphFormat','Fields','InlineShapes','ContentControls'],Font:['Name','Size','Bold','Italic','Underline','Color']};
  function get(target,member,args=[]){
    if(target.kind==='Document'&&member==='Range'){
      if(args.length!==2||!args.every(Number.isInteger)||args[0]<0||args[1]<args[0]||args[1]>c.text.length)throw Error('bad range arguments');
      return range(...args);
    }
    if(target.kind==='Range'){
      if(member==='Text')return c.truncated?{text:'partial',truncated:true,length:999}:c.text.slice(target.start,target.end);
      if(member==='Start')return target.start;
      if(member==='End')return c.badLength?target.end+1:target.end;
      if(member==='StoryType')return 1;
      if(member==='Font')return font(target.start);
      if(member==='ParagraphFormat')return {kind:'ParagraphFormat',Alignment:0,SpaceBefore:0,SpaceAfter:6,LeftIndent:0,RightIndent:0};
      if(['Fields','InlineShapes','ContentControls','Tables'].includes(member))return {kind:'Collection',Count:c.collectionCounts[member]??0};
    }
    if(Object.hasOwn(target,member))return target[member];
    throw Error('unsupported fixture member '+member);
  }
  const scope={projectId:'project-1',taskId:'task-1'};
  const connection={scope,targetRef:'host-document:meeting',leaseId:'native-lease-1',app:'word',officeSessionId:'office-session-1',documentId:'meeting-document',range:{start:0,end:c.text.length,storyType:1},
    async call(name,input,signal){
      if(signal.aborted)throw Error('cancelled');c.calls.push({name,input:structuredClone(input)});
      if(c.gate)await c.gate.promise;
      if(signal.aborted)throw Error('cancelled');
      if(name==='inspect_office_members'){
        if(!c.metadataAvailable)return {ok:false,error:'office_member_metadata_unavailable',invocationStarted:false};
        const target=input.target==='document'?document:c.objects.get(input.target);
        if(!target)throw Error('unknown native handle');
        return {members:(members[target.kind]??[]).filter(x=>!input.query||x.toLowerCase().includes(input.query.toLowerCase())).map(name=>({name,action:name==='Range'?'call':'get',parameterCount:name==='Range'?2:0,optionalParameters:name==='Range'?2:0,parameters:name==='Range'?['Start','End']:[],readOnlyCall:name==='Range'})),limit:200,retrievedFrom:'live_office_type_info'};
      }
      if(name!=='inspect_office')throw Error('A read adapter tried a non-read tool');
      c.inspection++;
      const results=input.steps.map(step=>{
        if(step.action!=='get')throw Error('A read adapter tried a non-get step');
        if(c.unknownMember&&step.member==='Text')throw Error('native member missing');
        const parts=step.member.split('.');let target=step.target==='document'?document:c.objects.get(step.target);
        if(!target)throw Error('unknown native handle');
        for(let i=0;i<parts.length;i++)target=get(target,parts[i],i===parts.length-1?(step.args??[]):[]);
        if(target&&typeof target==='object'&&!Object.hasOwn(target,'truncated')){
          if(!step.id)throw Error('native object requires an id');c.objects.set(step.id,target);return {reference:step.id};
        }
        return target;
      });
      const result={snapshotId:'native-snapshot-'+c.inspection,steps:structuredClone(input.steps),results};
      c.afterInspection?.(c.inspection);return result;
    }
  };
  const bridge={environment:'fixture',async acquire(wanted,targetRef,signal){
    if(signal.aborted||JSON.stringify(wanted)!==JSON.stringify(scope)||targetRef!==connection.targetRef)throw Error('not owned');return connection;
  },async release(){c.released++;}};
  return {bridge,connection,c,scope};
}

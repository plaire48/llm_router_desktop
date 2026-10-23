// During a legacy catalog migration, report counts directly in SQLite. Never
// load every source record into JavaScript or block on rebuilding the catalog.
export function mailStatusRollup(store,{account,attachmentReading=false}={}){
 const db=store.db;
 if(!db.prepare('SELECT 1 FROM nubi_mail_list_dirty LIMIT 1').get())return store.mailList.stats({account,attachmentReading});
 const scope=account?"(json_extract(value,'$.account')=? OR json_extract(value,'$.protocol')='local')":'1',args=account?[account]:[];
 const count=(condition='1',bindings=[])=>Number(db.prepare("SELECT count(*) n FROM records WHERE key GLOB 'mail:*' AND "+condition).get(...bindings).n);
 const state=value=>"coalesce(json_extract(value,'$.state'),'')="+"'"+value+"'";
 const summary="(json_extract(value,'$.state')='attention' AND coalesce(json_extract(value,'$.error'),'')!='mail_cancelled')";
 const attachment=attachmentReading?"(json_extract(value,'$.attachmentState')='attention' AND (coalesce(json_array_length(value,'$.attachmentFailures'),0)=0 OR EXISTS(SELECT 1 FROM json_each(value,'$.attachmentFailures') f WHERE coalesce(json_extract(f.value,'$.error'),'')!='mail_cancelled')) )":'0';
 const last=db.prepare("SELECT value FROM records WHERE key GLOB 'mail:*' AND "+state('saved')+' AND '+scope+" ORDER BY json_extract(value,'$.savedAt') DESC LIMIT 1").get(...args);
 const timed=db.prepare("SELECT json_extract(value,'$.summaryTiming') timing FROM records WHERE key GLOB 'mail:*' AND "+state('saved')+' AND '+scope+" AND json_extract(value,'$.summaryTiming.state')='completed' ORDER BY json_extract(value,'$.savedAt') DESC LIMIT 1").get(...args);
 const reading=attachmentReading?db.prepare("SELECT json_extract(value,'$.attachmentProgress') progress FROM records WHERE key GLOB 'mail:*' AND "+scope+" AND json_extract(value,'$.attachmentState')='reading' LIMIT 1").get(...args):null;
 return {received:count(),indexed:count(state('indexed')),saved:count(state('saved')),queued:count(state('queued')),localCount:count("json_extract(value,'$.protocol')='local'"),
  localKinds:db.prepare("SELECT DISTINCT json_extract(value,'$.mailbox') mailbox FROM records WHERE key GLOB 'mail:*' AND json_extract(value,'$.protocol')='local'").all().map(r=>r.mailbox),
  scopedSaved:count(scope+' AND '+state('saved'),args),scopedQueued:count(scope+" AND coalesce(json_extract(value,'$.state'),'') IN ('queued','summarizing')"+(attachmentReading?" AND coalesce(json_extract(value,'$.attachmentState'),'')!='attention'":''),args),
  attention:{summary:count(scope+' AND '+summary,args),attachment:count(scope+' AND '+attachment,args),total:count(scope+' AND ('+summary+' OR '+attachment+')',args)},
  lastAppliedAt:last?JSON.parse(last.value).savedAt||null:null,lastTiming:timed?.timing?JSON.parse(timed.timing):null,attachment:reading?.progress?JSON.parse(reading.progress):null,metadataPreparing:true};
}

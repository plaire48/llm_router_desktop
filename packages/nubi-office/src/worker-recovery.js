// Only status reads and deduplicated receipt delivery may be replayed here.
// Native actions and runStart are deliberately excluded.
export async function recoverWorkerRead(method,payload,{call,cancelled,onRetry,onStall,wait}) {
  if(!['runStatus','runLookup','toolResult'].includes(method))throw new Error('unsafe_tool_retry');
  const check=()=>{if(cancelled())throw new Error('cancelled');};
  let failures=0;
  for(;;){
    check();
    try{
      const result=await call(method,payload);check();
      if(method==='runStatus'&&result?.id!==payload.id)throw new Error('run_expired');
      if(method==='runLookup'&&(!result?.id||result?.requestId!==payload.requestId))throw new Error('run_expired');
      if(method==='toolResult'&&result?.accepted!==true)throw new Error('receipt_unconfirmed');
      return result;
    }
    catch(error){
      check();if(!['office_timeout','worker_timeout'].includes(error.message))throw error;
      failures++;await onRetry({failures,code:error.message,paused:failures>=3});check();
      if(failures>=3){
        const answer=await onStall();check();
        if(answer?.approved!==true)throw new Error('cancelled');
        failures=0;
      }else{await wait(Math.min(5000,500*2**(failures-1)));check();}
    }
  }
}

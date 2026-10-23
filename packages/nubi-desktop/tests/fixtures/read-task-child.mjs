// Test transport only. Production handlers never accept scripts or a spin task.
process.on('disconnect',()=>process.exit(0));
process.on('message',async({id,task,input})=>{
 process.send?.({id,type:'started'});
 if(task==='crash')process.exit(2);
 if(task==='spin'){const at=Date.now();while(Date.now()-at<input.ms){};}
 if(task==='wait')await new Promise(resolve=>setTimeout(resolve,input.ms));
 process.send?.({id,type:'result',result:{pid:process.pid,value:input.value,environment:{apiKey:process.env.AIPRO_API_KEY,nodeOptions:process.env.NODE_OPTIONS}}});
});

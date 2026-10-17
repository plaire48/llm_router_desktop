const {EventEmitter}=require('node:events');

// Lazy native loading works in both the CommonJS Electron host and the ESM
// service bundle. Human TerminalHost sessions keep their separate lifecycle.
function spawnPty(executable,args,options){
 const entry=require.resolve('node-pty').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
 const terminal=require(entry).spawn(executable,args,{cwd:options.cwd,env:options.env,name:'xterm-256color',cols:120,rows:30});
 const child=new EventEmitter();
 child.pid=terminal.pid;
 child.stdout=new EventEmitter();child.stderr=new EventEmitter();
 child.stdin={write:data=>terminal.write(data)};
 child.kill=signal=>terminal.kill(signal);
 terminal.onData(data=>child.stdout.emit('data',Buffer.from(data,'utf8')));
 terminal.onExit(({exitCode,signal})=>child.emit('close',exitCode,signal||null));
 return child;
}
module.exports={spawnPty};

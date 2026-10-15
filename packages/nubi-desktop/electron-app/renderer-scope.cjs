// Hash routes belong to the bundled UI (for example #support). Origin,
// document, sender and top-level frame checks must all remain exact.
function trustedRenderer(event,window){
 if(!window||event.sender!==window.webContents||!event.senderFrame||event.senderFrame!==window.webContents.mainFrame||typeof event.senderFrame.url!=='string'||event.senderFrame.url.split('#',1)[0]!=='app://bundle/index.html')throw Error('ipc_scope');
}
module.exports={trustedRenderer};

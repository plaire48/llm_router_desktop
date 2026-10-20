// The webview bundle holds the shared UI only. Theia, the A2A SDK and the A2A modules that pair, sign or send
// stay out of it. A2A is enabled (user decision 2026-10-01), so the UI may use the names and messages of its
// contract (contract.mjs, tasks.mjs), which import nothing else.
const SHARED=/nubi-a2a\/(?:contract|tasks)\.mjs$/;
export const leakedInputs=inputs=>inputs.map(file=>file.replaceAll('\\','/')).filter(file=>/@theia\/|@a2a-js\//.test(file)||/nubi-a2a\//.test(file)&&!SHARED.test(file));

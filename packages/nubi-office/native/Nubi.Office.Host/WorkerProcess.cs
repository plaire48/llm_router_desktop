using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed class WorkerProcess : IDisposable
    {
        private readonly Process process;
        private readonly StreamWriter input;
        private readonly ConcurrentDictionary<string, TaskCompletionSource<JToken>> pending = new ConcurrentDictionary<string, TaskCompletionSource<JToken>>();
        private readonly object writeGate = new object();
        public WorkerProcess(string root) : this(root,"excel") {}
        public WorkerProcess(string root, string host)
        {
            if(host!="excel"&&host!="word"&&host!="powerpoint")throw new OfficeFault("unsupported_office_host");
            var runtime = Path.Combine(root, "runtime", Environment.Is64BitOperatingSystem ? "x64" : "x86", "node.exe");
            if (!File.Exists(runtime)) throw new OfficeFault("runtime_missing");
            // Bundled Node 22.23.2 verifies TLS against Windows corporate roots too.
            process = new Process { StartInfo = new ProcessStartInfo(runtime, "--use-system-ca \"" + Path.Combine(root, "worker", "main.mjs") + "\"") {
                WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false), StandardErrorEncoding = new UTF8Encoding(false) }, EnableRaisingEvents = true };
            // Do not inherit Node injection hooks or keys from unrelated applications.
            foreach (var key in new[] {"NODE_OPTIONS", "NODE_PATH", "NODE_TLS_REJECT_UNAUTHORIZED", "OPENAI_API_KEY", "OPENAI_BASE_URL"}) process.StartInfo.EnvironmentVariables.Remove(key);
            process.StartInfo.EnvironmentVariables["NUBI_OFFICE_HOST"] = host;
            process.OutputDataReceived += (_, e) => {
                if (e.Data == null) {Fail(); return;}
                if (e.Data.Length > 300000) {Fail(); return;}
                try {
                    var msg = JObject.Parse(e.Data); var id = (string?)msg["id"];
                    if (id != null && pending.TryRemove(id, out var completion)) {
                        if ((bool?)msg["ok"] == true) completion.TrySetResult(msg["result"] ?? JValue.CreateNull());
                        else completion.TrySetException(new OfficeFault((string?)msg["error"] ?? "worker_failed"));
                    }
                } catch {Fail();}
            };
            process.ErrorDataReceived += (_, __) => {}; // Provider output never enters Office logs.
            process.Exited += (_, __) => Fail();
            process.Start(); input = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false)) {AutoFlush = true}; process.BeginOutputReadLine(); process.BeginErrorReadLine();
        }
        public async Task<JToken> Call(string method, JObject payload)
        {
            var id = Guid.NewGuid().ToString("N"); var completion = new TaskCompletionSource<JToken>(TaskCreationOptions.RunContinuationsAsynchronously);
            pending[id] = completion;
            try {
                lock (writeGate) input.WriteLine(new JObject { ["id"] = id, ["method"] = method, ["payload"] = payload }.ToString(Formatting.None));
                if (await Task.WhenAny(completion.Task, Task.Delay(30000)).ConfigureAwait(false) != completion.Task) throw new OfficeFault("worker_timeout");
                return await completion.Task.ConfigureAwait(false);
            } finally {pending.TryRemove(id, out _);}
        }
        private void Fail() {foreach (var pair in pending) if (pending.TryRemove(pair.Key, out var c)) c.TrySetException(new OfficeFault("worker_disconnected"));}
        public void Dispose() {Fail(); try {input.Close(); if (!process.WaitForExit(1000)) process.Kill();} catch {} process.Dispose();}
    }
}

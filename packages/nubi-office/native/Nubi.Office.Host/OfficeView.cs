using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed class OfficeView : IDisposable
    {
        private readonly string executable;
        private readonly Dictionary<string,(string image,string hash,long expires)> images=new Dictionary<string,(string,string,long)>();
        public OfficeView(string root){executable=Path.GetFullPath(Path.Combine(root,"..","View","Nubi.Office.View.exe"));}
        public static bool SameCom(object? a,object? b){if(a==null||b==null)return false;var left=Marshal.GetIUnknownForObject(a);try{var right=Marshal.GetIUnknownForObject(b);try{return left==right;}finally{Marshal.Release(right);}}finally{Marshal.Release(left);}}
        public bool Available=>File.Exists(executable);
        private Process? active;
        private readonly OfficeCursorOverlay cursor=new OfficeCursorOverlay();
        private readonly Dictionary<string,JObject> observations=new Dictionary<string,JObject>();
        private readonly Dictionary<string,(string signature,JObject result)> receipts=new Dictionary<string,(string,JObject)>();
        private readonly HashSet<string> consumed=new HashSet<string>();
        private bool uncertain;
        public JObject Receipt(string id)=>receipts.TryGetValue(id,out var value)?(JObject)value.result.DeepClone():new JObject{["outcome"]="not_executed"};
        public void Clear(){cursor.Dismiss();images.Clear();observations.Clear();try{if(active!=null&&!active.HasExited)active.Kill();}catch{}}
        public void Dispose(){Clear();cursor.Dispose();}
        public JObject Image(string id){if(!images.TryGetValue(id,out var item)||item.expires<DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()){images.Remove(id);throw new OfficeFault("view_expired");}return new JObject{["id"]=id,["data"]=item.image,["sha256"]=item.hash,["mimeType"]="image/png"};}
        private async Task<JObject> Request(IntPtr window,IntPtr exclude,JObject? action=null)
        {
            if(!Available)throw new OfficeFault("view_unavailable");
            using(var process=new Process{StartInfo=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=new UTF8Encoding(false)}}){
                process.StartInfo.EnvironmentVariables.Clear();
                foreach(var key in new[]{"SystemRoot","WINDIR","TEMP","TMP"}){var value=Environment.GetEnvironmentVariable(key);if(value!=null)process.StartInfo.EnvironmentVariables[key]=value;}
                active=process;
                if(!process.Start())throw new OfficeFault("view_unavailable");
                try {
                    var output=process.StandardOutput.ReadToEndAsync();var error=process.StandardError.ReadToEndAsync();
                    var input=new StreamWriter(process.StandardInput.BaseStream,new UTF8Encoding(false)){AutoFlush=true};
                    var request=new JObject{["window"]=window.ToInt64(),["excludeWindow"]=exclude.ToInt64(),["processId"]=Process.GetCurrentProcess().Id,["cursorWindow"]=cursor.IsHandleCreated?cursor.Handle.ToInt64():0};if(action!=null)request.Merge(action);
                    await input.WriteLineAsync(request.ToString(Formatting.None));input.Close();
                    var exit=Task.Run(()=>process.WaitForExit());if(await Task.WhenAny(exit,Task.Delay(8000))!=exit){try{process.Kill();}catch{}throw new OfficeFault("view_timeout");}
                    var text=await output;await error;if(text.Length>180000)throw new OfficeFault("view_limit");return JObject.Parse(text);
                } finally {active=null;}
            }
        }
        public async Task<JObject> Observe(IntPtr window,IntPtr exclude,JObject binding,Func<JObject> validate)
        {
            var result=await Request(window,exclude);if(result["error"]!=null)throw new OfficeFault((string)result["error"]!);
            if(!JToken.DeepEquals(binding,validate()))throw new OfficeFault("view_source_changed");
            string id=Guid.NewGuid().ToString("N"),data=(string?)result["image"]??"",hash=(string?)result["imageSha256"]??"";result.Remove("image");
            if(data.Length>0){while(images.Count>=3)images.Remove(images.Keys.First());images[id]=(data,hash,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+120000);}
            result["id"]=id;result["binding"]=binding;result["scope"]="visible_office_window_only";result["documentVerified"]=false;
            while(observations.Count>=3)observations.Remove(observations.Keys.First());observations[id]=(JObject)result.DeepClone();return result;
        }
        public void MarkFocused(IntPtr window,JObject observation)
        {
            var focused=(observation["elements"] as JArray)?.OfType<JObject>().FirstOrDefault(e=>(bool?)e["focused"]==true);
            if(focused?["bounds"] is JArray bounds){cursor.Mark(window,bounds);cursor.Settle();}
        }
        public async Task<JObject> Act(IntPtr window,IntPtr exclude,JObject binding,JObject payload,Func<JObject> validate)
        {
            string id=(string?)payload["operationId"]??"",viewId=(string?)payload["viewId"]??"",action=(string?)payload["action"]??"";
            if(!Guid.TryParse(id,out _)||!new[]{"hover","click","scroll_up","scroll_down"}.Contains(action)||(bool?)payload["approved"]!=true)throw new OfficeFault("view_action_invalid");
            string signature=ContentDocument.Hash(payload.ToString(Formatting.None));
            if(receipts.TryGetValue(id,out var prior)){if(prior.signature!=signature)throw new OfficeFault("operation_collision");return (JObject)prior.result.DeepClone();}
            if(uncertain)throw new OfficeFault("view_action_uncertain");
            if(receipts.Count>=256)throw new OfficeFault("receipt_limit");
            if(consumed.Contains(viewId)||!observations.TryGetValue(viewId,out var observation)||(long?)observation["observedAt"]<DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-120000)throw new OfficeFault("view_expired");
            if(!JToken.DeepEquals(binding,observation["binding"])||!JToken.DeepEquals(binding,validate())||(long?)observation["window"]!=window.ToInt64())throw new OfficeFault("view_source_changed");
            var target=((JArray)observation["elements"]!).OfType<JObject>().SingleOrDefault(item=>(string?)item["id"]==(string?)payload["targetId"]);
            if(target==null||target["runtimeId"]==null)throw new OfficeFault("view_target_changed");
            consumed.Add(viewId);uncertain=true;
            var receipt=new JObject{["operationId"]=id,["action"]=action,["target"]=target["name"],["outcome"]="uncertain",["instruction"]="Do not replay. Read the document and view; uncertain input requires user inspection and restarting the Office add-in."};receipts[id]=(signature,receipt);
            try {
                bool marked=target["bounds"] is JArray bounds&&cursor.Mark(window,bounds);
                if(marked){marked=await cursor.WaitForArrival();if(!marked){uncertain=false;receipt["outcome"]="not_executed";receipt["error"]="view_marker_cancelled";return (JObject)receipt.DeepClone();}}
                receipt["virtualCursorShown"]=marked;
                if(!JToken.DeepEquals(binding,validate())){uncertain=false;receipt["outcome"]="not_executed";receipt["error"]="view_source_changed";return (JObject)receipt.DeepClone();}
                if(action=="hover"&&!marked){uncertain=false;receipt["outcome"]="not_executed";receipt["error"]="view_marker_unavailable";return (JObject)receipt.DeepClone();}
                var result=await Request(window,exclude,new JObject{["action"]=action,["target"]=target,["observedAt"]=observation["observedAt"]});
                receipt["input"]=result;
                if(result["error"]!=null){if((bool?)result["dispatched"]==false){receipt["outcome"]="not_executed";uncertain=false;}receipt["error"]=result["error"];return (JObject)receipt.DeepClone();}
                if(action=="click"&&(bool?)result["dispatched"]==true)cursor.IndicateClick();
                // Verify native binding after input. A changed document needs a new
                // read/replan; never bless a GUI edit as a verified COM write.
                try {
                    receipt["view"]=await Observe(window,exclude,binding,validate);
                    receipt["outcome"]="dispatched";receipt["documentUnchanged"]=true;receipt["applicationVerified"]=false;
                    receipt["instruction"]="Input was dispatched. Inspect the fresh UIA/view and read native document state before the next action. This does not prove task completion or saving.";uncertain=false;
                }catch(OfficeFault failure){receipt["error"]=failure.Code;}
            } catch {receipt["error"]="view_action_uncertain";}
            finally {if(uncertain)cursor.Dismiss();else cursor.Settle();}
            return (JObject)receipt.DeepClone();
        }
    }
}

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    // All entry points run synchronously on the pane's Office UI/STA thread.
    // COM references are document-bound; an ActiveDocument switch is never a
    // target lookup. No file parser/export/decryptor participates in open/save.
    internal sealed partial class ContentPort : IDisposable
    {
        private readonly dynamic app, window;
        private readonly string host;
        private readonly Dictionary<string, ContentDocument> documents = new Dictionary<string, ContentDocument>();
        private readonly Dictionary<string, JObject> receipts = new Dictionary<string, JObject>();
        private readonly Dictionary<string, string> signatures = new Dictionary<string, string>();
        public ContentPort(object application, object documentWindow, string host) { app=application;window=documentWindow;this.host=host; }
        private ContentDocument Wrap(object document, bool created) => host=="word" ? (ContentDocument)new WordContentDocument(document, created) : new SlideContentDocument(document, created);
        private ContentDocument Get(string id) { if(!documents.TryGetValue(id,out var document))throw new OfficeFault("scope_expired");document.EnsureOpen();return document; }
        private ContentDocument Register(ContentDocument document) { if(documents.Count>=128)throw new OfficeFault("scope_limit");documents.Add(document.Id,document);return document; }
        public IntPtr ViewWindow(string id,string? target,bool focus)=>Get(id).ViewWindow(target,focus);
        public JObject Selection()
        {
            object doc=host=="word"?(object)window.Document:(object)window.Presentation;
            var document=Wrap(doc,false);document.Capture(window);Register(document);return Read(document.Id,0);
        }
        public JObject Read(string id, int offset)
        {
            var document=Get(id);var items=document.Items();
            if(offset<0||offset>items.Count||offset%40!=0)throw new OfficeFault("invalid_request");
            return new JObject { ["host"]=host,["scopeId"]=id,["documentId"]=id,["name"]=document.Name,["created"]=document.Created,
                ["copySource"]=document.CopySource?.DeepClone(),["copyReady"]=document.CopyReady,["copyPath"]=document.CopyPath,["fingerprint"]=document.Fingerprint(items),["items"]=new JArray(items.Skip(offset).Take(40)),["total"]=items.Count,["offset"]=offset,
                ["nextOffset"]=offset+40<items.Count?(JToken)(offset+40):JValue.CreateNull(),
                ["preservationNote"]="선택한 내용과 읽을 수 있는 문서 속성을 확인합니다. 인쇄 결과, 화면의 완전한 동일성, NASCA 암호화 여부는 별도 확인이 필요합니다." };
        }
        public JToken Dispatch(string method,JObject payload)
        {
            string Required(string key)=>(string?)payload[key]??throw new OfficeFault("invalid_request");
            if(method=="office_read")return Read(Required("scopeId"),(int?)payload["offset"]??0);
            if(method=="office_read_text")return ReadText(Required("scopeId"),Required("expectedFingerprint"),Required("itemId"),Required("field"),(int?)payload["offset"]??0,(int?)payload["maxChars"]??4000);
            if(method=="office_receipt")return receipts.TryGetValue(Required("operationId"),out var receipt)?receipt.DeepClone():new JObject{["outcome"]="not_executed"};
            if(method=="office_focus"){Get(Required("scopeId")).Focus();return new JObject{["focused"]=true};}
            if(!new[]{"office_apply","office_create","office_save","office_copy","office_template_register"}.Contains(method))throw new OfficeFault("unknown_method");
            string operationId=Required("operationId"),signature=ContentDocument.Hash(method+payload.ToString(Formatting.None));
            if(!Guid.TryParse(operationId,out _))throw new OfficeFault("invalid_request");
            if(receipts.TryGetValue(operationId,out var old)){
                if(signatures[operationId]!=signature)throw new OfficeFault("operation_collision");
                if((string?)old["outcome"]!="applied")throw new OfficeFault("write_uncertain");
                return old["result"]!.DeepClone();
            }
            if(receipts.Count>=512)throw new OfficeFault("receipt_limit");
            ContentDocument document=Get(Required("scopeId"));
            JObject? operation=payload["operation"] as JObject;
            var before=document.Items();string fingerprint=document.Fingerprint(before);
            if(method!="office_create"&&fingerprint!=Required("expectedFingerprint"))throw new OfficeFault("source_changed");
            if(method=="office_apply"){if(document.CopySource!=null&&!document.CopyReady)throw new OfficeFault("content_copy_mismatch");if(operation==null)throw new OfficeFault("invalid_plan");document.Validate(operation,before);}
            string? copyPath=null;
            if(method=="office_copy"){
                if(documents.Count>=128)throw new OfficeFault("scope_limit");
                copyPath=ChooseCopyPath(document,(string?)payload["title"]??"Nubi",fingerprint);
                if(copyPath==null)return new JObject{["cancelled"]=true,["verified"]=true};
            }
            // Record intent BEFORE the first COM mutation. Exceptions can never
            // make an uncertain operation eligible for replay.
            signatures.Add(operationId,signature);receipts.Add(operationId,new JObject{["outcome"]="uncertain"});
            try {
                JObject result;
                if(method=="office_create"){
                    if(documents.Count>=128)throw new OfficeFault("scope_limit");
                    object created=host=="word"?(object)app.Documents.Add():(object)app.Presentations.Add(-1);
                    document=Register(Wrap(created,true));result=new JObject{["verified"]=true,["snapshot"]=Read(document.Id,0)};
                } else if(method=="office_copy")result=Copy(document,copyPath!,fingerprint,before);
                else if(method=="office_template_register")result=RegisterTemplate(document,payload);
                else if(method=="office_save")result=Save(document,(string?)payload["title"]??"Nubi",fingerprint);
                else {
                    var expected=document.Apply(operation!);var after=document.Items();
                    var checks=document.Check(operation!,expected,before,after);
                    if(checks.Any(c=>(string?)c["status"]=="unknown"))throw new OfficeFault("write_uncertain");
                    int offset=0;string? target=(string?)expected["targetId"];
                    if(target!=null){var position=after.FindIndex(i=>(string?)i["id"]==target);if(position>=0)offset=position/40*40;}
                    result=new JObject{["verified"]=true,["checks"]=checks,["targetId"]=expected["targetId"]?.DeepClone(),["snapshot"]=Read(document.Id,offset)};
                }
                receipts[operationId]=new JObject{["outcome"]="applied",["result"]=result.DeepClone()};return result;
            }catch{throw new OfficeFault(method=="office_save"?"document_save_uncertain":"write_uncertain");}
        }
        private JObject ReadText(string id,string expectedFingerprint,string itemId,string field,int offset,int maxChars)
        {
            if((field!="text"&&field!="notes")||offset<0||maxChars<1||maxChars>8000)throw new OfficeFault("invalid_request");
            var document=Get(id);var items=document.Items();string fingerprint=document.Fingerprint(items);
            if(fingerprint!=expectedFingerprint)throw new OfficeFault("source_changed");
            var item=items.SingleOrDefault(value=>(string?)value["id"]==itemId);
            if(item==null||item[field]?.Type!=JTokenType.String)throw new OfficeFault("unsupported_target");
            string text=document.ReadText(itemId,field),textHash=ContentDocument.Hash(text);
            if(item[field+"Hash"]!=null&&(string?)item[field+"Hash"]!=textHash)throw new OfficeFault("source_changed");
            if(document.Fingerprint(document.Items())!=fingerprint)throw new OfficeFault("source_changed");
            if(offset>text.Length)throw new OfficeFault("invalid_request");
            string chunk=text.Substring(offset,Math.Min(maxChars,text.Length-offset));int end=offset+chunk.Length;
            return new JObject{["host"]=host,["scopeId"]=id,["documentId"]=id,["fingerprint"]=fingerprint,["itemId"]=itemId,["field"]=field,["offset"]=offset,["text"]=chunk,["textLength"]=text.Length,["textHash"]=textHash,["chunkHash"]=ContentDocument.Hash(chunk),["nextOffset"]=end<text.Length?(JToken)end:JValue.CreateNull(),["readOnly"]=true};
        }
        private JObject Save(ContentDocument document,string title,string expectedFingerprint)
        {
            // Native SaveAs keeps the Office/NASCA path. Reject overwrite and
            // macro down-conversion; saving an edited source means a new copy.
            if(document.CopySource!=null){
                if(!document.CopyReady)throw new OfficeFault("content_copy_mismatch");
                document.CommitCopy();
                return new JObject{["verified"]=true,["saved"]=true,["scopeId"]=document.Id,["path"]=document.CopyPath};
            }
            var extension=document.Extension;
            using(var dialog=new SaveFileDialog{Filter=$"Office (*{extension})|*{extension}",DefaultExt=extension.TrimStart('.'),AddExtension=true,OverwritePrompt=true,FileName=string.Concat(title.Take(100).Select(c=>Path.GetInvalidFileNameChars().Contains(c)?'_':c))+extension}){
                if(dialog.ShowDialog()!=DialogResult.OK)return new JObject{["cancelled"]=true,["verified"]=true};
                if(File.Exists(dialog.FileName))throw new OfficeFault("template_destination_exists");
                if(document.Fingerprint(document.Items())!=expectedFingerprint)throw new OfficeFault("source_changed");
                document.Save(dialog.FileName);
                if(!document.SavedAt(dialog.FileName))throw new OfficeFault("document_save_uncertain");
                document.AcceptSavedPath();
                return new JObject{["verified"]=true,["saved"]=true,["scopeId"]=document.Id,["path"]=dialog.FileName};
            }
        }
        public void Dispose(){foreach(var document in documents.Values)document.Dispose();documents.Clear();receipts.Clear();signatures.Clear();}
    }
    internal sealed class ComObjects : IDisposable
    {
        private readonly List<object> objects=new List<object>();
        public dynamic Keep(object value){if(Marshal.IsComObject(value))objects.Add(value);return value;}
        public void Dispose(){for(int i=objects.Count-1;i>=0;i--)try{Marshal.ReleaseComObject(objects[i]);}catch{}objects.Clear();}
    }
    internal abstract partial class ContentDocument : IDisposable
    {
        protected readonly dynamic Doc;
        protected readonly HashSet<string> Allowed=new HashSet<string>();
        public readonly string Id=Guid.NewGuid().ToString("N");
        public bool Created { get; }
        protected ContentDocument(object document,bool created){Doc=document;Created=created;boundName=(string)Doc.FullName;}
        public string Name=>(string)Doc.Name;
        public void EnsureOpen(){try{var ignored=Name;if(!string.Equals(boundName,(string)Doc.FullName,StringComparison.OrdinalIgnoreCase))throw new OfficeFault("source_changed");}catch(OfficeFault){throw;}catch{throw new OfficeFault("document_closed");}}
        public static string Hash(string value){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant();}
        public abstract List<JObject> Items();
        public abstract string ReadText(string itemId,string field);
        public abstract string Fingerprint(List<JObject> items);
        public abstract void Capture(dynamic window);
        public abstract void Validate(JObject operation,List<JObject> before);
        public abstract JObject Apply(JObject operation);
        public abstract JArray Check(JObject operation,JObject expected,List<JObject> before,List<JObject> after);
        public abstract string Extension {get;}
        public abstract void Save(string path);
        public abstract void Focus();
        public abstract IntPtr ViewWindow(string? target,bool focus);
        public bool SavedAt(string path)=>string.Equals((string)Doc.FullName,path,StringComparison.OrdinalIgnoreCase)&&Convert.ToBoolean(Doc.Saved);
        protected static string String(JObject o,string key,int max=4000){var value=(string?)o[key];if(value==null||value.Length>max||value.Any(c=>char.IsControl(c)))throw new OfficeFault("invalid_plan");return value;}
        protected static void Keys(JObject operation,params string[] names){if(operation.Properties().Any(p=>!names.Contains(p.Name)))throw new OfficeFault("invalid_plan");}
        protected static JObject CheckResult(string name,bool met)=>new JObject{["requirement"]=name,["status"]=met?"met":"unmet"};
        // Do not FinalRelease an RCW shared with Office/VSTO. Pane lifetime owns
        // only the references it acquired; documents are never closed on unload.
        public virtual void Dispose(){try{if(Marshal.IsComObject(Doc))Marshal.ReleaseComObject(Doc);}catch{}}
    }
}

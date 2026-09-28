using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Excel = Microsoft.Office.Interop.Excel;

namespace Nubi.Office.Host
{
    public sealed class NubiPane : UserControl
    {
        private const string Page = "https://nubi.local/taskpane.html";
        private readonly WebView2 web = new WebView2 {Dock = DockStyle.Fill};
        private readonly WorkbookEngine engine = null!;
        private readonly ExcelPort port = null!;
        private readonly DocumentPort documents = null!;
        private readonly ContentPort? content;
        private readonly string host = "excel";
        private readonly Func<string> officeVersion;
        private readonly CatalogActions catalogActions=new CatalogActions();
        private readonly string root;
        private WorkerProcess? worker;
        private readonly OfficeView views;
        private bool observingView;
        private int viewEpoch;
        private bool initialized;
        public NubiPane(Excel.Application application, string packageRoot)
        {
            officeVersion=()=>application.Version;root = packageRoot; views=new OfficeView(root); documents = new DocumentPort(application); port = new ExcelPort(application); engine = new WorkbookEngine(port); Controls.Add(web);
            Load += async (_, __) => {try {await Initialize();} catch {Controls.Clear(); Controls.Add(new Label {Text = "누비를 시작하지 못했습니다. 설치 파일의 런타임과 WebView2를 확인하세요.", Dock = DockStyle.Fill});}};
        }
        public NubiPane(object application, object window, string packageRoot, string officeHost)
        {
            if(officeHost!="word"&&officeHost!="powerpoint")throw new OfficeFault("unsupported_office_host");
            officeVersion=()=>Convert.ToString(((dynamic)application).Version)??"";host=officeHost;root=packageRoot;views=new OfficeView(root);content=new ContentPort(application,window,host);Controls.Add(web);
            Load += async (_, __) => {try {await Initialize();} catch {Controls.Clear();Controls.Add(new Label{Text="누비를 시작하지 못했습니다. 설치 파일과 WebView2를 확인하세요.",Dock=DockStyle.Fill});}};
        }
        private async Task Initialize()
        {
            if (initialized) return;
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NubiOffice", "WebView", host);
            var env = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(env);
            worker = new WorkerProcess(root, host);
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false; core.Settings.AreDefaultScriptDialogsEnabled = false; core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false; core.Settings.IsStatusBarEnabled = false;
            core.SetVirtualHostNameToFolderMapping("nubi.local", Path.Combine(root, "web"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.NavigationStarting += (_, e) => {if (e.Uri != Page) e.Cancel = true;};
            core.FrameNavigationStarting += (_, e) => e.Cancel = true;
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += OnMessage;
            initialized = true; core.Navigate(Page);
        }
        private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (e.Source != Page || web.Source?.AbsoluteUri != Page || worker == null) return;
            string? id = null, method = null;
            try {
                if (e.WebMessageAsJson.Length > 250000) throw new OfficeFault("message_limit");
                var message = JObject.Parse(e.WebMessageAsJson); id = (string?)message["id"];
                if (id == null || !System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,100}$")) return;
                method = (string?)message["method"]; var payload = message["payload"] as JObject ?? new JObject(); JToken result;
                string Required(string key) => (string?)payload[key] ?? throw new OfficeFault("invalid_request");
                if(method=="document_skill_import"){
                    result=await catalogActions.ExecuteAsync(method,payload,async()=>{
                        var package=SkillPackageImport.Pick(Required("kind"),this);if(package==null)return new JObject{["cancelled"]=true};
                        var entry=((JArray)package["files"]!).Cast<JObject>().Single(f=>(string?)f["path"]=="SKILL.md");
                        string text;try{text=new System.Text.UTF8Encoding(false,true).GetString(Convert.FromBase64String((string)entry["data"]!));}catch{throw new OfficeFault("document_skill_package_invalid");}
                        var metadata=await worker!.Call("skillPackageMetadata",new JObject{["content"]=text});
                        var skill=new JObject{["id"]=Guid.NewGuid().ToString("D"),["host"]=host,["revision"]=1,["name"]=metadata["name"]!.DeepClone(),["instructions"]=metadata["description"]!.DeepClone(),["questions"]=new JArray(),["package"]=package};
                        return DocumentSkillCatalog.Save(host,skill);
                    });Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                }
                if(method=="document_skill_catalog"||method=="document_skill_manifest"||method=="document_skill_resource"){
                    if(method=="document_skill_catalog"){
                        var list=DocumentSkillCatalog.List(host);list["entries"]=new JArray(((JArray)list["entries"]!).Where(s=>s["package"]!=null));result=list;
                    }else if(method=="document_skill_manifest")result=DocumentSkillCatalog.Manifest(host,Required("skillId"),(int?)payload["revision"]??0);
                    else result=DocumentSkillCatalog.Resource(host,Required("skillId"),(int?)payload["revision"]??0,Required("packageSha256"),Required("path"),(int?)payload["offset"]??0);
                    Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                }
                if(method=="document_skill_list"||method=="document_skill_save"||method=="document_skill_remove"){
                    if(method=="document_skill_list")result=DocumentSkillCatalog.List(host);
                    else result=catalogActions.Execute(method!,payload,()=>method=="document_skill_save"
                        ?DocumentSkillCatalog.Save(host,payload["skill"] is JObject userSkill&&userSkill["package"]==null?userSkill:throw new OfficeFault("document_skill_invalid"))
                        :DocumentSkillCatalog.Remove(host,Required("skillId"),(int?)payload["revision"]??0));
                    Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                }
                if(method=="runStart"&&payload["documentSkill"]!=null){
                    var selected=payload["documentSkill"] as JObject??throw new OfficeFault("document_skill_invalid");
                    var registered=DocumentSkillCatalog.Read(host,(string?)selected["id"]??"");
                    if(!JToken.DeepEquals(selected,DocumentSkillCatalog.Public(registered)))throw new OfficeFault("document_skill_changed");
                    payload["documentSkill"]=DocumentSkillCatalog.Public(registered);
                }
                if(method=="runStart"){payload["visualAvailable"]=views.Available;payload["skillPackagesAvailable"]=true;try{payload["officeRuntime"]=new JObject{["host"]=host,["platform"]="win32",["officeVersion"]=officeVersion(),["processBitness"]=IntPtr.Size*8,["observedAt"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()};}catch{payload["officeRuntime"]=new JObject{["host"]=host,["state"]="unavailable"};}}
                if(method=="runCancel"||method=="disconnect"){viewEpoch++;views.Clear();}
                if(method=="view_image"){result=views.Image(Required("viewId"));Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;}
                if(method=="view_receipt"){result=views.Receipt(Required("operationId"));Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;}
                if(method=="view_observe"||method=="view_act"){
                    if(observingView)throw new OfficeFault("view_busy");observingView=true;int epoch=viewEpoch;
                    try {
                        string fingerprint=Required("expectedFingerprint");string? scopeId=(string?)payload["scopeId"],documentId=(string?)payload["documentId"];
                        JObject Binding(){
                            var observed=content!=null?content.Read(scopeId??throw new OfficeFault("invalid_request"),0):documentId!=null?documents.Read(documentId):engine.Read(scopeId??throw new OfficeFault("invalid_request"));
                            if((string?)observed["fingerprint"]!=fingerprint)throw new OfficeFault("view_source_changed");
                            return new JObject{["host"]=host,["scopeId"]=scopeId,["documentId"]=documentId??(string?)observed["documentId"],["fingerprint"]=fingerprint};
                        }
                        var binding=Binding();bool focus=(bool?)payload["focus"]==true;
                        IntPtr Window(bool show)=>content!=null?content.ViewWindow(scopeId!, (string?)payload["targetId"],show):documentId!=null?documents.ViewWindow(documentId,(string?)payload["sheet"],(string?)payload["address"],show):port.ViewWindow(engine.BoundState(scopeId!,fingerprint),(string?)payload["address"],show);
                        var window=Window(focus);
                        JObject Validate(){if(epoch!=viewEpoch||IsDisposed)throw new OfficeFault("cancelled");var fresh=Binding();if(Window(false)!=window)throw new OfficeFault("view_window_changed");return fresh;}
                        result=method=="view_act"?await views.Act(window,Handle,binding,payload,Validate):await views.Observe(window,Handle,binding,Validate);
                        if(epoch!=viewEpoch||IsDisposed){views.Clear();throw new OfficeFault("cancelled");}
                        if(focus&&result is JObject observedView)views.MarkFocused(window,observedView);
                        Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                    } finally {observingView=false;}
                }
                if(method=="template_catalog_list"||method=="template_catalog_rename"||method=="template_catalog_remove"||method=="template_catalog_use"||method=="template_catalog_receipt"||method=="template_catalog_index"){
                    if(method=="template_catalog_list")result=TemplateCatalog.List(host);
                    else if(method=="template_catalog_receipt")result=catalogActions.Receipt(Required("operationId"));
                    else result=catalogActions.Execute(method!,payload,()=>{
                        if(method=="template_catalog_rename"||method=="template_catalog_remove")return TemplateCatalog.Change(host,Required("templateId"),(int?)payload["revision"]??0,(string?)payload["name"],method=="template_catalog_remove");
                        if(method=="template_catalog_index"){if(host!="excel")throw new OfficeFault("unsupported_operation");return port.IndexTemplate(Required("templateId"));}
                        if(content!=null)return content.LoadTemplate(Required("templateId"));
                        var opened=port.OpenTemplateCopy(Required("templateId"));if((bool?)opened["copied"]==true)opened["scope"]=engine.Selection();return opened;
                    });
                    Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                }
                if(content!=null) {
                    if(method=="selection")result=content.Selection();
                    else if(method!=null&&method.StartsWith("office_",StringComparison.Ordinal))result=content.Dispatch(method,payload);
                    else if(method=="history")result=new JArray();
                    else if(new[]{"session","connect","login","cancelLogin","disconnect","selectProvider","selectModel","refreshModels","runStart","runLookup","runStatus","runCancel","toolResult"}.Contains(method))result=await worker.Call(method!,payload);
                    else throw new OfficeFault("unsupported_operation");
                    Reply(new JObject{["id"]=id,["ok"]=true,["result"]=result});return;
                }
                switch (method) {
                    case "document_open": result = documents.Open(payload); break;
                    case "document_save": result = documents.Save(Required("documentId"), Required("expectedFingerprint"), Required("title")); break;
                    case "document_read": result = documents.Read(Required("documentId")); break;
                    case "document_reconcile": result = documents.Reconcile(payload); break;
                    case "document_focus": documents.Focus(Required("documentId")); result = new JObject { ["focused"] = true }; break;
                    case "selection": result = engine.Selection(); break;
                    case "template_register": result = catalogActions.Execute(method!,payload,()=>port.RegisterTemplate(engine.BoundState(Required("scopeId"), Required("expectedFingerprint")), payload["record"] as JObject ?? throw new OfficeFault("template_record_invalid"))); break;
                    case "template_open": var template = port.OpenTemplateCopy(); if ((bool?)template["copied"] == true) template["scope"] = engine.Selection(); result = template; break;
                    case "read": result = engine.Read(Required("scopeId")); break;
                    case "workbook_sheets": result = engine.ListSheets(Required("scopeId"), (int?)payload["offset"] ?? 0); break;
                    case "workbook_structure": result = engine.InspectSheet(Required("scopeId"), Required("sheetId"), Required("part"), (int?)payload["offset"] ?? 0); break;
                    case "workbook_range": result = engine.ReadWorkbookRange(Required("scopeId"), Required("sheetId"), Required("address")); break;
                    case "apply": result = engine.Apply(Required("scopeId"), Required("operationId"), payload["plan"] as JObject ?? throw new OfficeFault("invalid_plan")); break;
                    case "reconcile": result = engine.Reconcile(Required("scopeId"), Required("operationId"), payload["plan"] as JObject ?? throw new OfficeFault("invalid_plan")); break;
                    case "restore": result = engine.Restore(Required("changeId")); break;
                    case "history": result = engine.History(); break;
                    case "focus": engine.Focus(Required("scopeId")); result = new JObject { ["focused"] = true }; break;
                    case "session": case "connect": case "login": case "cancelLogin": case "disconnect": case "selectProvider": case "selectModel": case "refreshModels": case "runStart": case "runLookup": case "runStatus": case "runCancel": case "toolResult":
                        result = await worker.Call(method!, payload); break;
                    default: throw new OfficeFault("unknown_method");
                }
                Reply(new JObject { ["id"] = id, ["ok"] = true, ["result"] = result });
            } catch (Exception error) {if (id != null) Reply(new JObject { ["id"] = id, ["ok"] = false, ["error"] = SafeError(error, method) });}
        }
        private static string SafeError(Exception error, string? method)
        {
            if (error is OfficeFault fault) return fault.Code;
            // Only a read rejection can be retried by the worker. Never label
            // a possibly executed write/save as safe to replay.
            bool read = method == "office_read" || method == "office_read_text" || method == "office_receipt" || method == "read" || method == "workbook_sheets" || method == "workbook_structure" || method == "workbook_range" || method == "reconcile" || method == "document_reconcile" || method == "document_read";
            if (read && error is COMException com &&
                (com.ErrorCode == unchecked((int)0x80010001) || com.ErrorCode == unchecked((int)0x8001010A))) return method?.StartsWith("office_",StringComparison.Ordinal)==true?"office_busy":"excel_busy";
            return "office_failed";
        }
        private void Reply(JObject message) {if (!IsDisposed && web.CoreWebView2 != null && web.Source?.AbsoluteUri == Page) web.CoreWebView2.PostWebMessageAsJson(message.ToString(Formatting.None));}
        protected override void Dispose(bool disposing) {if (disposing) {viewEpoch++;views.Dispose();worker?.Dispose(); worker = null; port?.Dispose(); content?.Dispose(); web.Dispose();} base.Dispose(disposing);}
    }
}

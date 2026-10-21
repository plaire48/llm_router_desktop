using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using OfficeX.Core;
using Nubi.Office.Capture;

namespace Nubi.OfficeBridge {
 // A dedicated STA process owns one existing Office document. It has no model,
 // network listener, shell executor, Office launcher or encrypted file reader.
 static class Program {
  static OpenDocuments documents;static object application,window,port,files,captureDocument;static Type portType;static Assembly host;
  static OfficeAutomationSession session;static string sessionId;static bool writeIssued;static string officeApp;static string windowHandle;static readonly HashSet<string> restored=new HashSet<string>();
  static readonly BindingFlags Instance=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
  static void Emit(object value,string overflowCode="native_office_frame_limit"){string text=Wire.Json(value);if(text.Length>300000)throw new OfficeFault(overflowCode);Console.Out.WriteLine(text);Console.Out.Flush();}
  static string Code(Exception e){while(e.InnerException!=null)e=e.InnerException;return Regex.IsMatch(e.Message??"","^[a-z][a-z_]{2,70}$")?e.Message:e is COMException?"native_office_not_available":"native_office_call_failed";}
  static object Invoke(object target,string method,params object[] args)=>target.GetType().GetMethod(method,Instance).Invoke(target,args);
  static object Get(object target,string member)=>host.GetType("OfficeX.ExcelHost.OfficeDispatch",true).GetMethod("Get").Invoke(null,new object[]{target,member,new object[0]});
  static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  static string ReadFrame(){var text=new StringBuilder();int c;while((c=Console.In.Read())>=0){if(c=='\n')return text.ToString();text.Append((char)c);if(text.Length>300000)throw new OfficeFault("native_office_frame_limit");}if(text.Length!=0)throw new OfficeFault("native_office_protocol_invalid");return null;}
  static JObject Parse(string text){using(var reader=new JsonTextReader(new StringReader(text)){DateParseHandling=DateParseHandling.None,MaxDepth=32}){var value=JObject.Load(reader,new JsonLoadSettings{DuplicatePropertyNameHandling=DuplicatePropertyNameHandling.Error});if(reader.Read())throw new OfficeFault("native_office_protocol_invalid");return value;}}
  static void Keys(JObject value,params string[] names){if(value==null||value.Properties().Any(p=>!names.Contains(p.Name)))throw new OfficeFault("native_office_protocol_invalid");}
  static List<OfficeStep> Steps(JToken value)=>value?.ToObject<List<OfficeStep>>(JsonSerializer.Create(Wire.Settings));
  static object Call(string name,JObject input){
   if(name=="bind_document"){
    Keys(input,"candidateId");if(port!=null)throw new OfficeFault("native_office_already_bound");
    var selected=documents.Select((string)input["candidateId"]);application=selected.Application;window=selected.Window;captureDocument=selected.Document;
    object hwnd=host.GetType("OfficeX.ExcelHost.OfficeWindow",true).GetMethod("Handle").Invoke(null,new[]{window,(object)officeApp});
    windowHandle=Convert.ToString(hwnd,CultureInfo.InvariantCulture);
    portType=host.GetType("OfficeX.ExcelHost.OfficeAutomationPort",true);port=Activator.CreateInstance(portType,Instance,null,new[]{application,(object)officeApp,hwnd},CultureInfo.InvariantCulture);
    ((IOfficeAutomationPort)port).CheckSource();session=new OfficeAutomationSession((IOfficeAutomationPort)port);
    var factoryType=typeof(Func<>).MakeGenericType(portType);var factory=Expression.Lambda(factoryType,Expression.Constant(port,portType)).Compile();
    files=Activator.CreateInstance(host.GetType("OfficeX.ExcelHost.OfficeFiles",true),Instance,null,new[]{application,(object)officeApp,factory},CultureInfo.InvariantCulture);
    documents.Retain(selected);
    string title=(string)portType.GetProperty("DocumentName").GetValue(port),documentId=(string)portType.GetProperty("DocumentId").GetValue(port);
    return new{app=officeApp,candidateId=selected.Id,documentId,documentTitle=title.Substring(0,Math.Min(title.Length,300)),officeVersion=Convert.ToString(Get(application,"Version"))};
   }
   if(port==null)throw new OfficeFault("native_office_selection_required",invocationStarted:false);
   ((IOfficeAutomationPort)port).CheckSource();
   if(name=="office_capture_template"){
    Keys(input,"path","outDir","maxAssets","renders");
    if(officeApp!="word")throw new OfficeFault("form_capture_unsupported_app");
    return ContentCapture.CaptureWord(new ComWordCaptureDocument(captureDocument,application,()=>((IOfficeAutomationPort)port).CheckSource()),input);
   }
   if(name=="inspect_office"){Keys(input,"steps");return session.Inspect(Steps(input["steps"]));}
   if(name=="execute_office_operations"){
    Keys(input,"snapshotId","summary","steps","checks");if(writeIssued)throw new OfficeFault("native_office_write_already_issued",invocationStarted:false);
    var plan=session.Prepare((string)input["snapshotId"],(string)input["summary"],Steps(input["steps"]),input["checks"]?.ToObject<List<OfficeCheck>>(JsonSerializer.Create(Wire.Settings)));
    // Preserve the existing native checkpoint implementation. No fallback that
    // silently applies without a recovery copy when company policy refuses it.
    var checkpoint=Wire.Object(Invoke(files,"PrepareCheckpoint",plan.Summary));
    if((bool?)checkpoint["available"]!=true)throw new OfficeFault("native_office_checkpoint_required",invocationStarted:false);
    CheckpointCatalog.Save(files,officeApp);
    writeIssued=true;
    // This private request can only be issued by the Workspace's frozen,
    // one-time approved plan. Apply rereads source and checks every mutation.
    var receipt=session.Apply(plan.Id,true,CancellationToken.None);
    return new {receipt.Kind,receipt.PlanId,receipt.Status,receipt.Error,receipt.FailedMember,receipt.NativeCode,receipt.ExceptionName,receipt.FailureStage,receipt.InputPath,receipt.InputRule,receipt.InvocationStarted,receipt.Mutated,receipt.CompletedWrites,receipt.WriteResultUncertain,receipt.Saved,receipt.Count,receipt.Results,receipt.Checks,checkpointId=(string)checkpoint["id"]};
   }
   if(name=="calculate_office"){Keys(input,"target");return Invoke(port,"Calculate",(string)input["target"],CancellationToken.None);}
   if(name=="window_identity"){Keys(input);return new{handle=windowHandle,app=officeApp};}
   if(name=="list_checkpoints"){Keys(input);CheckpointCatalog.Load(files,officeApp);return Invoke(files,"ListCheckpoints");}
   if(name=="restore_checkpoint"){Keys(input,"checkpointId");var id=(string)input["checkpointId"];if(id==null||!restored.Add(id))throw new OfficeFault("native_office_restore_already_requested");CheckpointCatalog.Load(files,officeApp);return Invoke(files,"Restore",id,CancellationToken.None);}
   if(name=="save_document"){Keys(input);return Invoke(port,"Save",false,CancellationToken.None);}
   throw new OfficeFault("native_office_method_invalid",invocationStarted:false);
  }
  [STAThread] static int Main(string[] args){
   Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
   try{
    if(Environment.OSVersion.Platform!=PlatformID.Win32NT||args.Length!=1||!new[]{"word","excel","powerpoint"}.Contains(args[0]))throw new OfficeFault("native_office_windows_required");
    string app=args[0];officeApp=app;host=Assembly.LoadFrom(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"OfficeX.ExcelHost.dll"));
    documents=new OpenDocuments(host,app);var choices=documents.Choices();
    if(choices.Length==0)throw new OfficeFault("native_office_not_available");
    sessionId=Guid.NewGuid().ToString("N");
    Emit(new{type="ready",protocol=1,sessionId,connection=new{app,selectionRequired=true,documents=choices}});
    int sequence=0;string line;var ids=new HashSet<string>();
    while((line=ReadFrame())!=null){
     var frame=Parse(line);Keys(frame,"type","sessionId","id","sequence","name","input");
     string id=(string)frame["id"],name=(string)frame["name"];
     if((string)frame["type"]!="call"||(string)frame["sessionId"]!=sessionId||frame["sequence"]?.Type!=JTokenType.Integer||(int)frame["sequence"]!=++sequence||!Regex.IsMatch(id??"","^[a-zA-Z0-9-]{1,100}$")||!ids.Add(id)||ids.Count>10000)throw new OfficeFault("native_office_protocol_invalid");
     try{var result=Call(name,frame["input"] as JObject);Emit(new{type="result",sessionId,id,sequence,result},name=="office_capture_template"?"form_capture_too_large":"native_office_frame_limit");}
     catch(Exception e){
      // Prepare/checkpoint/source failures before Apply are known not to have
      // edited the document. A failure after issue stays uncertain.
      if(name=="execute_office_operations"&&!writeIssued)Emit(new{type="result",sessionId,id,sequence,result=new{status="rejected",error=Code(e),mutated=false,completedWrites=0,writeResultUncertain=false,saved=false,invocationStarted=false}});
      else Emit(new{type="result",sessionId,id,sequence,error=Code(e)});
     }
    }
    return 0;
   }catch(Exception e){if(sessionId==null)Emit(new{type="startup_error",error=Code(e)});return 1;}
   finally{try{(files as IDisposable)?.Dispose();}catch{}try{(port as IDisposable)?.Dispose();}catch{}documents?.Dispose();}
  }
 }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Automation;
using System.Windows.Automation.Text;
namespace Nubi.TextEditorBridge {
 static class Program {
  static JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=2200000,RecursionLimit=24};
  sealed class Candidate {public AutomationElement Window;public int Pid;public long Start;public string Name,App;public DateTime At;}
  static Dictionary<string,Candidate> candidates=new Dictionary<string,Candidate>();static Candidate bound;static AutomationElement editor;static string runtime;
  static string S(Dictionary<string,object>d,string k)=>d.ContainsKey(k)?Convert.ToString(d[k]):"";
  static string Name(AutomationElement e)=>e.Current.Name.TrimStart('*',' ');
  static string Runtime(AutomationElement e)=>String.Join(",",e.GetRuntimeId());
  static string Hash(string s){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(s))).Replace("-","");}
  static bool Same(Candidate c){try{return Process.GetProcessById(c.Pid).StartTime.ToUniversalTime().Ticks==c.Start&&c.Window.Current.ProcessId==c.Pid&&Name(c.Window)==c.Name;}catch{return false;}}
  static object List(string app){if(app!="pdf")throw new Exception("editor_app_invalid");candidates.Clear();var result=new List<object>();var windows=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Window));foreach(AutomationElement window in windows){try{var p=Process.GetProcessById(window.Current.ProcessId);if(p.SessionId!=Process.GetCurrentProcess().SessionId)continue;var executable=System.IO.Path.GetFileName(p.MainModule.FileName).ToLowerInvariant();if(!new[]{"acrord32.exe","acrobat.exe","sumatrapdf.exe","foxitpdfreader.exe"}.Contains(executable))continue;if(window.Current.IsOffscreen)continue;var id=Guid.NewGuid().ToString();candidates[id]=new Candidate{Window=window,Pid=p.Id,Start=p.StartTime.ToUniversalTime().Ticks,Name=Name(window),App=app,At=DateTime.UtcNow};result.Add(new{id,title=Name(window),app});if(result.Count>=20)break;}catch{}}return result;}
  static object Inspect(){if(bound==null||!Same(bound)||Runtime(editor)!=runtime||editor.Current.IsOffscreen)throw new Exception("editor_binding_changed");object pattern;string text;bool readOnly=true;int start=0,end=0;if(editor.TryGetCurrentPattern(ValuePattern.Pattern,out pattern)){var value=(ValuePattern)pattern;text=value.Current.Value;// UIA cannot atomically compare and edit in the target app thread. Keep this adapter read-only.
readOnly=true;}else if(editor.TryGetCurrentPattern(TextPattern.Pattern,out pattern)){var textPattern=(TextPattern)pattern;text=textPattern.DocumentRange.GetText(1000001);var selected=textPattern.GetSelection();if(selected.Length==1){var prefix=textPattern.DocumentRange.Clone();prefix.MoveEndpointByRange(TextPatternRangeEndpoint.End,selected[0],TextPatternRangeEndpoint.Start);start=prefix.GetText(1000001).Length;end=start+selected[0].GetText(1000001).Length;}}else throw new Exception("editor_text_unavailable");if(text.Length>1000000||start>text.Length||end>text.Length)throw new Exception("editor_text_limit");return new{text,revision=Hash(text),selection=new{start,end},readOnly,dirty="unknown"};}
  static object Call(string method,Dictionary<string,object>a){
   if(method=="list")return List(S(a,"app"));
   if(method=="bind"){Candidate c;if(bound!=null||!candidates.TryGetValue(S(a,"candidateId"),out c)||DateTime.UtcNow-c.At>TimeSpan.FromMinutes(1)||!Same(c))throw new Exception("editor_selection_changed");var controls=c.Window.FindAll(TreeScope.Descendants,new OrCondition(new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Document),new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Edit)));var eligible=new List<AutomationElement>();foreach(AutomationElement e in controls){object p;if(!e.Current.IsOffscreen&&e.Current.IsEnabled&&(e.TryGetCurrentPattern(TextPattern.Pattern,out p)||e.TryGetCurrentPattern(ValuePattern.Pattern,out p)))eligible.Add(e);}if(eligible.Count!=1)throw new Exception("editor_document_ambiguous");bound=c;editor=eligible[0];runtime=Runtime(editor);return new{title=c.Name,app=c.App,snapshot=Inspect()};}
   if(method=="inspect")return Inspect();
   if(method=="replace")throw new Exception("editor_read_only");
   throw new Exception("editor_method_invalid");
  }
  static void Emit(object value){Console.WriteLine(json.Serialize(value));Console.Out.Flush();}
  static string Read(){var b=new StringBuilder();int c;while((c=Console.Read())>=0){if(c=='\n')return b.ToString();if(b.Length>=2200000)throw new Exception("editor_frame_limit");b.Append((char)c);}return null;}
  [STAThread] static int Main(){Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);Emit(new{type="ready",protocol=1});int seq=0;try{string line;while((line=Read())!=null){var f=json.Deserialize<Dictionary<string,object>>(line);var id=S(f,"id");if(Convert.ToInt32(f["sequence"])!=++seq||!Guid.TryParse(id,out var _))return 1;try{Emit(new{id,result=Call(S(f,"method"),(Dictionary<string,object>)f["args"])});}catch(Exception e){Emit(new{id,error=e.Message.StartsWith("editor_")?e.Message:"editor_native_failed"});}}return 0;}catch{return 1;}}
 }
}

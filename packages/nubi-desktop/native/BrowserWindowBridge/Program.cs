// Private inherited-pipe bridge. Never reparents, injects, captures or drives website input.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
class Program {
 const uint NOACTIVATE=0x10,NOOWNERZORDER=0x200; const int HIDE=0,SHOWNOACTIVATE=4;
 static readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=32768};
 static readonly object output=new object(); static Control dispatcher; static System.Windows.Forms.Timer tick;
 static IntPtr parent,hook,foregroundHook,lastBrowser; static int parentPid; static long parentStart; static string executable; static bool armed,visible,dragInside,escape,closing;
 static ArrivalPreview preview;static Binding previewSource;
 static RECT target; static POINT offset; static Binding bound,drag; static DateTime lastLayout=DateTime.MinValue; static string lastVisibility="";
 static readonly Dictionary<string,Binding> candidates=new Dictionary<string,Binding>();
 static DateTime nextHealth=DateTime.MinValue;static WinEvent callback=OnEvent;
 class Binding { public IntPtr hwnd;public string path;public int pid;public long start;public string id;public WINDOWPLACEMENT placement;public DateTime expires;public RECT before;public DateTime checkedAt; }
 [STAThread] static void Main(){
  SetThreadDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();dispatcher=new Control();var handle=dispatcher.Handle;
  hook=SetWinEventHook(10,11,IntPtr.Zero,callback,0,0,2);foregroundHook=SetWinEventHook(3,3,IntPtr.Zero,callback,0,0,2);
  tick=new System.Windows.Forms.Timer{Interval=32};tick.Tick+=(s,e)=>Pulse();tick.Start();
  var reader=new Thread(()=>{try{while(true){var line=ReadBounded();if(line==null)break;dispatcher.BeginInvoke((Action)(()=>Request(line)));}}catch{}finally{try{dispatcher.BeginInvoke((Action)(()=>Shutdown()));}catch{}}});reader.IsBackground=true;reader.Start();
  Emit(new{type="ready",protocol=1});Application.Run();
 }
 static string ReadBounded(){var b=new StringBuilder();int c;while((c=Console.In.Read())!=-1){if(c=='\n')return b.ToString();if(b.Length>=32768)throw new InvalidDataException();if(c!='\r')b.Append((char)c);}return b.Length==0?null:b.ToString();}
 static void Emit(object value){lock(output){Console.Out.WriteLine(json.Serialize(value));Console.Out.Flush();}}
 static string S(Dictionary<string,object> a,string k)=>a.ContainsKey(k)?Convert.ToString(a[k]):"";
 static int I(Dictionary<string,object> a,string k)=>a.ContainsKey(k)?Convert.ToInt32(a[k]):0;
 static bool B(Dictionary<string,object> a,string k)=>a.ContainsKey(k)&&Convert.ToBoolean(a[k]);
 static void Request(string line){string id="";try{
  var p=json.Deserialize<Dictionary<string,object>>(line);id=S(p,"id");var action=S(p,"action");var a=p.ContainsKey("args")?(Dictionary<string,object>)p["args"]:new Dictionary<string,object>();object result;
  if(action=="init"){
   if(parent!=IntPtr.Zero)throw new Exception("dock_already_initialized");var h=new IntPtr(long.Parse(S(a,"parent")));uint pid;GetWindowThreadProcessId(h,out pid);
   if(!IsWindow(h)||pid!=(uint)I(a,"parentPid"))throw new Exception("dock_parent_invalid");
   var input=S(a,"executable");var exe=input==""?"":Path.GetFullPath(input);if(exe!=""&&(!File.Exists(exe)||!exe.EndsWith(".exe",StringComparison.OrdinalIgnoreCase)))throw new Exception("dock_executable_invalid");
   parent=h;parentPid=(int)pid;parentStart=Process.GetProcessById(parentPid).StartTime.ToUniversalTime().Ticks;executable=exe;result=new{initialized=true};
  }else{
   if(parent==IntPtr.Zero||!ParentAlive())throw new Exception("dock_parent_invalid");
   switch(action){
    case "layout":
     armed=B(a,"armed");visible=B(a,"visible");target=new RECT{Left=I(a,"x"),Top=I(a,"y"),Right=I(a,"x")+I(a,"width"),Bottom=I(a,"y")+I(a,"height")};
     if(target.Right-target.Left<320||target.Bottom-target.Top<180){armed=false;visible=false;}
     RECT pr;GetClientRect(parent,out pr);POINT origin=new POINT();ClientToScreen(parent,ref origin);
     if(target.Left<origin.X||target.Top<origin.Y||target.Right>origin.X+pr.Right||target.Bottom>origin.Y+pr.Bottom){armed=false;visible=false;}
     offset=new POINT{X=target.Left-origin.X,Y=target.Top-origin.Y};lastLayout=DateTime.UtcNow;if(!visible||!armed)StopPreview(true);Follow();result=new{updated=true};break;
    case "chooseOffice":
     long officeHandle;if(!long.TryParse(S(a,"handle"),out officeHandle))throw new Exception("dock_window_changed");var officeWindow=new IntPtr(officeHandle);uint officePid;GetWindowThreadProcessId(officeWindow,out officePid);var officePath=Process.GetProcessById((int)officePid).MainModule.FileName;var officeName=Path.GetFileName(officePath).ToLowerInvariant();var officeApp=S(a,"app");if(!IsWindow(officeWindow)||GetAncestor(officeWindow,2)!=officeWindow||!((officeApp=="word"&&officeName=="winword.exe")||(officeApp=="excel"&&officeName=="excel.exe")||(officeApp=="powerpoint"&&officeName=="powerpnt.exe")))throw new Exception("dock_window_changed");var officeCandidate=Remember(officeWindow);result=new{candidateId=officeCandidate.id};break;
    case "choose":
     Binding selected=null;var requested=S(a,"candidateId");
     if(requested!=""){if(!candidates.TryGetValue(requested,out selected)||!Valid(selected))throw new Exception("dock_window_changed");}
     else{var top=IntPtr.Zero;if(lastBrowser!=IntPtr.Zero&&Matches(lastBrowser))top=lastBrowser;else EnumWindows((h,l)=>{if(Matches(h)&&!IsIconic(h)){top=h;return false;}return true;},IntPtr.Zero);if(top==IntPtr.Zero)throw new Exception("dock_browser_missing");selected=bound!=null&&bound.hwnd==top?bound:Remember(top);}
     result=new{candidateId=selected.id,browserName=BrowserName(selected.path),executable=selected.path};break;
    case "resolveProof":
     var nonce=S(a,"nonce");if(!Guid.TryParse(nonce,out var parsed))throw new Exception("dock_proof_invalid");var found=new List<IntPtr>();
     EnumWindows((h,l)=>{if(Matches(h)&&Title(h).Contains(nonce))found.Add(h);return true;},IntPtr.Zero);
     if(found.Count!=1)throw new Exception("dock_proof_pending");var candidate=S(a,"candidateId");Binding chosen=null;
     if(candidate!=""){if(!candidates.TryGetValue(candidate,out chosen)||!Valid(chosen)||chosen.hwnd!=found[0])throw new Exception("dock_window_mismatch");}else chosen=bound!=null&&bound.hwnd==found[0]?bound:Remember(found[0]);
     result=new{candidateId=chosen.id};break;
    case "recover":
     if(bound!=null)throw new Exception("dock_already_attached");
     var recovery=new Binding{hwnd=new IntPtr(long.Parse(S(a,"hwnd"))),path=S(a,"path"),pid=I(a,"pid"),start=long.Parse(S(a,"start")),placement=json.Deserialize<WINDOWPLACEMENT>(json.Serialize(a["placement"]))};
     if(!Identity(recovery))throw new Exception("dock_window_changed");bound=recovery;if(!Restore())throw new Exception("dock_restore_unconfirmed");result=new{restored=true};break;
    case "preview":
     Binding source;if(bound!=null||!candidates.TryGetValue(S(a,"candidateId"),out source)||!Valid(source))throw new Exception("dock_window_changed");
     if(!armed||!visible||DateTime.UtcNow-lastLayout>TimeSpan.FromSeconds(4))throw new Exception("dock_viewport_unavailable");
     if(!PreviewForeground(source))throw new Exception("dock_preview_interrupted");
     StopPreview();
     try{preview=new ArrivalPreview(parent,source.hwnd,new System.Drawing.Rectangle(target.Left,target.Top,target.Right-target.Left,target.Bottom-target.Top));previewSource=source;tick.Interval=16;result=new{preview=true,candidateId=source.id,displayMode="live-thumbnail"};}
     catch{StopPreview();result=new{preview=false,reason="dock_preview_unavailable"};}break;
    case "attach":
     if(bound!=null)throw new Exception("dock_already_attached");Binding next;if(!candidates.TryGetValue(S(a,"candidateId"),out next)||!Valid(next))throw new Exception("dock_window_changed");
     if(!armed||!visible||DateTime.UtcNow-lastLayout>TimeSpan.FromSeconds(4))throw new Exception("dock_viewport_unavailable");
     // Recheck at the actual move, not only on the preceding animation tick.
     if(IsIconic(parent)||!IsWindowVisible(parent)||!PreviewForeground(next))throw new Exception("dock_cancelled");
     bound=next;Emit(new{type="restoreRecord",hwnd=next.hwnd.ToInt64().ToString(),path=next.path,pid=next.pid,start=next.start.ToString(),placement=next.placement});if(IsZoomed(bound.hwnd))ShowWindow(bound.hwnd,9);ShowWindow(bound.hwnd,SHOWNOACTIVATE);Follow(true);RECT actual;GetWindowRect(bound.hwnd,out actual);
     if(Math.Abs(actual.Left-target.Left)>3||Math.Abs(actual.Top-target.Top)>3||Math.Abs(actual.Right-target.Right)>3||Math.Abs(actual.Bottom-target.Bottom)>3){Restore();throw new Exception("dock_bounds_unconfirmed");}
     StopPreview();result=new{docked=true,candidateId=next.id,displayMode="native-window-overlay"};break;
    case "detach": case "cancel":if(!Restore())throw new Exception("dock_restore_unconfirmed");result=new{detached=true};break;
    case "shutdown":if(!Restore())throw new Exception("dock_restore_unconfirmed");result=new{detached=true};Emit(new{id,result});Shutdown();return;
    default:throw new Exception("dock_action_invalid");
   }
  }Emit(new{id,result});
 }catch(Exception e){var message=e.Message;Emit(new{id,error=System.Text.RegularExpressions.Regex.IsMatch(message,"^dock_[a-z_]+$")?message:"dock_native_failed"});}}
 static bool ParentAlive(){try{return IsWindow(parent)&&Process.GetProcessById(parentPid).StartTime.ToUniversalTime().Ticks==parentStart;}catch{return false;}}
 static string Title(IntPtr h){var text=new StringBuilder(1024);GetWindowText(h,text,text.Capacity);return text.ToString();}
 [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd,uint flags);
 static string BrowserName(string file){switch(Path.GetFileName(file).ToLowerInvariant()){case "msedge.exe":return "Microsoft Edge";case "chrome.exe":return "Google Chrome";case "firefox.exe":return "Firefox";case "brave.exe":return "Brave";case "whale.exe":return "Whale";case "opera.exe":return "Opera";case "vivaldi.exe":return "Vivaldi";case "arc.exe":return "Arc";case "browser.exe":case "samsunginternet.exe":return "Samsung Browser";default:return Path.GetFileNameWithoutExtension(file);}}
 static bool Matches(IntPtr h){try{
  if(h==parent||!IsWindowVisible(h)||GetWindow(h,4)!=IntPtr.Zero)return false;var cls=new StringBuilder(128);GetClassName(h,cls,128);if(!cls.ToString().StartsWith("Chrome_WidgetWin_",StringComparison.Ordinal)&&cls.ToString()!="MozillaWindowClass")return false;
  uint pid;GetWindowThreadProcessId(h,out pid);var file=Process.GetProcessById((int)pid).MainModule.FileName;var name=Path.GetFileName(file).ToLowerInvariant();
  if(executable!=""&&String.Equals(file,executable,StringComparison.OrdinalIgnoreCase))return true;
  if(Array.IndexOf(new[]{"chrome.exe","msedge.exe","firefox.exe","brave.exe","whale.exe","opera.exe","vivaldi.exe","arc.exe"},name)>=0)return true;
  // browser.exe is ambiguous; Samsung must identify itself in product metadata.
  var product=FileVersionInfo.GetVersionInfo(file);return (name=="browser.exe"||name=="samsunginternet.exe")&&((product.CompanyName??"").IndexOf("Samsung",StringComparison.OrdinalIgnoreCase)>=0||(product.ProductName??"").IndexOf("Samsung",StringComparison.OrdinalIgnoreCase)>=0);
 }catch{return false;}}
 static Binding Remember(IntPtr h){uint pid;GetWindowThreadProcessId(h,out pid);var b=new Binding{hwnd=h,path=Process.GetProcessById((int)pid).MainModule.FileName,pid=(int)pid,start=Process.GetProcessById((int)pid).StartTime.ToUniversalTime().Ticks,id=Guid.NewGuid().ToString(),expires=DateTime.UtcNow.AddSeconds(60),placement=new WINDOWPLACEMENT{length=Marshal.SizeOf(typeof(WINDOWPLACEMENT))}};GetWindowPlacement(h,ref b.placement);GetWindowRect(h,out b.before);candidates[b.id]=b;return b;}
 static bool Identity(Binding b){try{uint pid;GetWindowThreadProcessId(b.hwnd,out pid);return IsWindow(b.hwnd)&&pid==b.pid&&Process.GetProcessById(b.pid).StartTime.ToUniversalTime().Ticks==b.start&&String.Equals(Process.GetProcessById(b.pid).MainModule.FileName,b.path,StringComparison.OrdinalIgnoreCase);}catch{return false;}}
 static bool Valid(Binding b)=>DateTime.UtcNow<b.expires&&Identity(b);
 static bool InTarget(POINT p)=>p.X>=target.Left&&p.X<target.Right&&p.Y>=target.Top&&p.Y<target.Bottom;
 static bool TargetExposed(POINT p,IntPtr source){IntPtr first=IntPtr.Zero;EnumWindows((h,l)=>{if(h==source||!IsWindowVisible(h)||IsIconic(h))return true;RECT r;if(GetWindowRect(h,out r)&&p.X>=r.Left&&p.X<r.Right&&p.Y>=r.Top&&p.Y<r.Bottom){first=h;return false;}return true;},IntPtr.Zero);return first==parent;}
 static void OnEvent(IntPtr h,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time){try{
  if(executable==null||closing)return;
  if(evt==3){if(Matches(hwnd))lastBrowser=hwnd;lastVisibility="";Follow();return;}if(obj!=0||hwnd==IntPtr.Zero)return;
  if(evt==10&&Matches(hwnd)){
   POINT point;GetCursorPos(out point);IntPtr hit;var packed=new IntPtr((point.Y<<16)|(point.X&65535));
   if(SendMessageTimeout(hwnd,0x84,IntPtr.Zero,packed,2,100,out hit)==IntPtr.Zero||hit.ToInt64()!=2)return; // titlebar move only, never resize
   drag=bound!=null&&bound.hwnd==hwnd?bound:Remember(hwnd);if(bound==drag){bound=null;Emit(new{type="released",reason="user_move"});}
   dragInside=false;escape=false;
  }else if(evt==11&&drag!=null&&drag.hwnd==hwnd){var b=drag;POINT point;GetCursorPos(out point);var drop=!escape&&armed&&InTarget(point)&&TargetExposed(point,hwnd);drag=null;dragInside=false;Emit(drop? (object)new{type="drop",candidateId=b.id}:new{type="leave"});}
 }catch{drag=null;}}
 static void Pulse(){try{
  if(parent==IntPtr.Zero)return;if(DateTime.UtcNow>=nextHealth){nextHealth=DateTime.UtcNow.AddMilliseconds(500);if(!ParentAlive()){Shutdown();return;}}
  if(preview!=null){
   if(!visible||!armed||IsIconic(parent)||!IsWindowVisible(parent)||!Valid(previewSource)||!PreviewForeground(previewSource)||preview.Expired||(GetAsyncKeyState(27)&0x8000)!=0)StopPreview(true);
   else{POINT origin=new POINT();ClientToScreen(parent,ref origin);try{preview.Update(new System.Drawing.Rectangle(origin.X+offset.X,origin.Y+offset.Y,target.Right-target.Left,target.Bottom-target.Top));}catch{StopPreview(true);}}
  }
  if(drag!=null){escape|=(GetAsyncKeyState(27)&0x8000)!=0;POINT point;GetCursorPos(out point);bool inside=!escape&&armed&&InTarget(point)&&TargetExposed(point,drag.hwnd);if(inside!=dragInside){dragInside=inside;Emit(new{type=inside?"enter":"leave",candidateId=drag.id});}}
  else if(bound!=null){if(IsIconic(bound.hwnd)){bound=null;Emit(new{type="released",reason="user_minimized"});}else Follow();}
  var expired=new List<string>();foreach(var pair in candidates)if(pair.Value!=bound&&pair.Value!=drag&&pair.Value.expires<DateTime.UtcNow)expired.Add(pair.Key);foreach(var id in expired)candidates.Remove(id);
 }catch{Restore();}}
 static bool Related(IntPtr h){if(h==parent||h==bound?.hwnd)return true;for(int n=0;n<8&&h!=IntPtr.Zero;n++){h=GetWindow(h,4);if(h==bound?.hwnd)return true;}return false;}
 static void Follow(bool force=false){if(bound==null)return;if(DateTime.UtcNow>=bound.checkedAt){bound.checkedAt=DateTime.UtcNow.AddMilliseconds(500);if(!Identity(bound)){bound=null;Emit(new{type="released",reason="window_closed"});return;}}
  bool show=visible&&!IsIconic(parent)&&IsWindowVisible(parent)&&Related(GetForegroundWindow());var key=show?"visible":"hidden";
  if(!show){if(IsWindowVisible(bound.hwnd))ShowWindow(bound.hwnd,HIDE);lastVisibility=key;return;}
  POINT origin=new POINT();ClientToScreen(parent,ref origin);var width=target.Right-target.Left;var height=target.Bottom-target.Top;
  target=new RECT{Left=origin.X+offset.X,Top=origin.Y+offset.Y,Right=origin.X+offset.X+width,Bottom=origin.Y+offset.Y+height};
  RECT r;GetWindowRect(bound.hwnd,out r);if(force||r.Left!=target.Left||r.Top!=target.Top||r.Right!=target.Right||r.Bottom!=target.Bottom)SetWindowPos(bound.hwnd,IntPtr.Zero,target.Left,target.Top,width,height,NOACTIVATE|NOOWNERZORDER);
  RECT check;GetWindowRect(bound.hwnd,out check);if(Math.Abs(check.Left-target.Left)>3||Math.Abs(check.Top-target.Top)>3||Math.Abs(check.Right-target.Right)>3||Math.Abs(check.Bottom-target.Bottom)>3){ShowWindow(bound.hwnd,HIDE);if(!force){visible=false;Emit(new{type="viewportBlocked"});}return;}
  if(!IsWindowVisible(bound.hwnd))ShowWindow(bound.hwnd,SHOWNOACTIVATE);if(lastVisibility!=key){SetWindowPos(bound.hwnd,IntPtr.Zero,0,0,0,0,NOACTIVATE|NOOWNERZORDER|1|2);lastVisibility=key;}
 }
 static bool PreviewForeground(Binding source){var foreground=GetForegroundWindow();return foreground==parent||foreground==source.hwnd;}
 static void StopPreview(bool notify=false){bool was=preview!=null;preview?.Dispose();preview=null;previewSource=null;if(tick!=null)tick.Interval=32;if(was&&notify)Emit(new{type="previewCancelled"});}
 static bool Restore(){StopPreview();var old=bound;lastVisibility="";if(old!=null&&Identity(old)){
  if(!SetWindowPlacement(old.hwnd,ref old.placement)){ShowWindow(old.hwnd,SHOWNOACTIVATE);return false;}
  if(old.placement.showCmd!=HIDE)ShowWindow(old.hwnd,SHOWNOACTIVATE);
  var readback=new WINDOWPLACEMENT{length=Marshal.SizeOf(typeof(WINDOWPLACEMENT))};
  if(!GetWindowPlacement(old.hwnd,ref readback)||readback.normal.Left!=old.placement.normal.Left||readback.normal.Top!=old.placement.normal.Top||readback.normal.Right!=old.placement.normal.Right||readback.normal.Bottom!=old.placement.normal.Bottom)return false;
 }bound=null;Emit(new{type="restored"});return true;}
 static void Shutdown(){if(closing)return;closing=true;Restore();if(hook!=IntPtr.Zero)UnhookWinEvent(hook);if(foregroundHook!=IntPtr.Zero)UnhookWinEvent(foregroundHook);tick?.Stop();Application.ExitThread();}
 [StructLayout(LayoutKind.Sequential)] struct POINT{public int X,Y;}
 [StructLayout(LayoutKind.Sequential)] struct RECT{public int Left,Top,Right,Bottom;}
 [StructLayout(LayoutKind.Sequential)] struct WINDOWPLACEMENT{public int length,flags,showCmd;public POINT min,max;public RECT normal;}
 delegate void WinEvent(IntPtr h,uint evt,IntPtr hwnd,int obj,int child,uint thread,uint time);delegate bool EnumProc(IntPtr h,IntPtr l);
 [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min,uint max,IntPtr module,WinEvent callback,uint pid,uint thread,uint flags);
 [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr h);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr l);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h,uint cmd);
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h,out RECT r);
 [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h,ref POINT p);
 [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
 [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
 [DllImport("user32.dll")] static extern bool GetWindowPlacement(IntPtr h,ref WINDOWPLACEMENT p);
 [DllImport("user32.dll")] static extern bool SetWindowPlacement(IntPtr h,ref WINDOWPLACEMENT p);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int hgt,uint flags);
 [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h,uint message,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}

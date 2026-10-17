using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using OfficeX.Core;

namespace Nubi.OfficeBridge {
 // Discovery and selection stay on the same STA as the existing Office port.
 // Native OM is obtained from an existing Office window, never from a new app
 // instance or a file parser. Candidate IDs are private, short-lived handles.
 sealed class OpenDocuments : IDisposable {
  internal sealed class Entry {
   internal string Id,Title;internal object Application,Window,Document;
   internal IntPtr Handle;internal int Pid;internal long Started;
  }
  readonly Dictionary<string,Entry> entries=new Dictionary<string,Entry>();
  readonly Assembly host;readonly string app;readonly DateTime expires=DateTime.UtcNow.AddMinutes(10);
  internal OpenDocuments(Assembly host,string app){this.host=host;this.app=app;Discover();}
  object Get(object value,string name)=>host.GetType("OfficeX.ExcelHost.OfficeDispatch",true).GetMethod("Get").Invoke(null,new object[]{value,name,new object[0]});
  internal static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
  static long Identity(object value){var p=Marshal.GetIUnknownForObject(value);try{return p.ToInt64();}finally{Marshal.Release(p);}}
  object Document(object win){if(app!="excel")return Get(win,app=="word"?"Document":"Presentation");var sheet=Get(win,"ActiveSheet");try{return Get(sheet,"Parent");}finally{Release(sheet);}}
  IntPtr Handle(object win)=>new IntPtr(Convert.ToInt32(host.GetType("OfficeX.ExcelHost.OfficeWindow",true).GetMethod("Handle").Invoke(null,new[]{win,(object)app})));
  void Discover(){
   var expected=app=="word"?"WINWORD":app=="excel"?"EXCEL":"POWERPNT";
   var childClass=app=="word"?"_WwG":app=="excel"?"EXCEL7":"paneClassDC";
   int session=Process.GetCurrentProcess().SessionId;
   EnumWindows((top,unused)=>{
    try{
     if(entries.Count>=64)return false;if(!IsWindowVisible(top))return true;
     uint pid;GetWindowThreadProcessId(top,out pid);
     using(var process=Process.GetProcessById((int)pid)){
      if(process.SessionId!=session||!String.Equals(process.ProcessName,expected,StringComparison.OrdinalIgnoreCase))return true;
      long started=process.StartTime.ToUniversalTime().Ticks;
      EnumChildWindows(top,(child,arg)=>{
       var cls=new StringBuilder(128);GetClassName(child,cls,cls.Capacity);if(cls.ToString()!=childClass)return true;
       object win=null,application=null,document=null;
       try{
        var iid=new Guid("00020400-0000-0000-C000-000000000046");
        if(AccessibleObjectFromWindow(child,0xFFFFFFF0,ref iid,out win)!=0||win==null)return true;
        if(Handle(win)!=top)return true;
        application=Get(win,"Application");document=Document(win);
        string title=Convert.ToString(Get(document,"Name"));if(String.IsNullOrWhiteSpace(title))return true;
        var entry=new Entry{Id=Guid.NewGuid().ToString("N"),Title=title.Substring(0,Math.Min(300,title.Length)),Application=application,Window=win,Document=document,Handle=top,Pid=(int)pid,Started=started};
        entries.Add(entry.Id,entry);win=application=document=null;return false;
       }catch{return true;}finally{Release(document);Release(application);Release(win);}
      },IntPtr.Zero);
     }
    }catch{/* An inaccessible/busy window is never substituted with ActiveObject. */}
    return true;
   },IntPtr.Zero);
  }
  internal object[] Choices()=>entries.Values.Select((e,i)=>(object)new{candidateId=e.Id,documentTitle=e.Title,windowNumber=i+1}).ToArray();
  internal Entry Select(string id){
   Entry entry;if(DateTime.UtcNow>=expires||id==null||!entries.TryGetValue(id,out entry))throw new OfficeFault("native_office_selection_changed");
   uint pid;GetWindowThreadProcessId(entry.Handle,out pid);
   using(var process=Process.GetProcessById(entry.Pid))if(!IsWindow(entry.Handle)||pid!=entry.Pid||process.StartTime.ToUniversalTime().Ticks!=entry.Started)throw new OfficeFault("native_office_selection_changed");
   var current=Document(entry.Window);try{if(Handle(entry.Window)!=entry.Handle||Identity(current)!=Identity(entry.Document))throw new OfficeFault("native_office_selection_changed");}finally{Release(current);}
   // One explicit user selection activates this exact window once. Future
   // operations still use OfficeAutomationPort.CheckSource, never auto-switch.
   host.GetType("OfficeX.ExcelHost.OfficeDispatch",true).GetMethod("Call").Invoke(null,new object[]{entry.Window,"Activate",new object[0]});
   var active=Get(entry.Application,app=="word"?"ActiveDocument":app=="excel"?"ActiveWorkbook":"ActivePresentation");
   try{if(Identity(active)!=Identity(entry.Document))throw new OfficeFault("native_office_selection_changed");}finally{Release(active);}
   return entry;
  }
  internal void Retain(Entry selected){foreach(var pair in entries.ToArray())if(pair.Value!=selected){Release(pair.Value.Document);Release(pair.Value.Window);Release(pair.Value.Application);entries.Remove(pair.Key);}}
  public void Dispose(){foreach(var e in entries.Values){Release(e.Document);Release(e.Window);Release(e.Application);}entries.Clear();}
  delegate bool EnumProc(IntPtr hwnd,IntPtr arg);
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumProc callback,IntPtr arg);
  [DllImport("user32.dll")]static extern bool EnumChildWindows(IntPtr hwnd,EnumProc callback,IntPtr arg);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr hwnd,StringBuilder text,int size);
  [DllImport("oleacc.dll")]static extern int AccessibleObjectFromWindow(IntPtr hwnd,uint id,ref Guid iid,[MarshalAs(UnmanagedType.Interface)]out object result);
 }
}

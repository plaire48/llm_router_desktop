using System;
using System.Collections.Generic;
using System.Linq;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows.Automation;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

internal static class Program
{
    [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left,Top,Right,Bottom; }
    [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window,uint flags);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
    private static string Hash(byte[] bytes) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
    [MTAThread] private static void Main()
    {
        // Separate process: UI Automation must not synchronously inspect the
        // Office UI from that same UI thread. Never scan another application.
        SetProcessDPIAware();
        Console.InputEncoding=new System.Text.UTF8Encoding(false);Console.OutputEncoding=new System.Text.UTF8Encoding(false);
        string stage="request";bool dispatched=false;
        try {var input=Console.ReadLine();if(input==null||input.Length>4096)throw new Exception();var p=JObject.Parse(input.TrimStart('\ufeff'));
            var requested=new IntPtr((long)p["window"]!);var window=GetAncestor(requested,2);uint expected=(uint)p["processId"]!;
            GetWindowThreadProcessId(window,out uint actual);
            if(actual!=expected||actual==0||!IsWindowVisible(window)||IsIconic(window)||!GetWindowRect(window,out var rect))throw new InvalidOperationException("view_window_unavailable");
            if(GetAncestor(GetForegroundWindow(),2)!=window)throw new InvalidOperationException("view_window_not_foreground");
            int width=rect.Right-rect.Left,height=rect.Bottom-rect.Top;if(width<100||height<100||width>10000||height>10000||(long)width*height>16000000)throw new InvalidOperationException("view_window_unavailable");
            var action=(string?)p["action"];var target=p["target"] as JObject;
            stage="uia";var excluded=new IntPtr((long?)p["excludeWindow"]??0);var elements=new JArray();int visited=0;bool truncated=false;
            var observedElements=new Dictionary<string,AutomationElement>();
            var queue=new Queue<(AutomationElement element,int depth)>();queue.Enqueue((AutomationElement.FromHandle(window),0));
            while(queue.Count>0&&visited<160){var next=queue.Dequeue();visited++;
                try {var info=next.element.Current;if((excluded!=IntPtr.Zero&&info.NativeWindowHandle==excluded.ToInt64())||((long?)p["cursorWindow"]!=0&&info.NativeWindowHandle==(long?)p["cursorWindow"])||info.IsPassword)continue;
                    if(!info.IsOffscreen){var bounds=info.BoundingRectangle;var name=info.Name??"";if(name.Length>160)name=name.Substring(0,160);
                        if(name.Length>0){observedElements["ui-"+visited]=next.element;elements.Add(new JObject{["focused"]=info.HasKeyboardFocus,["actions"]=new JArray(new[]{InvokePattern.Pattern,SelectionItemPattern.Pattern,ScrollPattern.Pattern}.Where(pattern=>next.element.TryGetCurrentPattern(pattern,out _)).Select(pattern=>pattern.ProgrammaticName)),["runtimeId"]=new JArray(next.element.GetRuntimeId()),["id"]="ui-"+visited,["name"]=name,["type"]=info.ControlType.ProgrammaticName,["enabled"]=info.IsEnabled,["bounds"]=new JArray(bounds.X-rect.Left,bounds.Y-rect.Top,bounds.Width,bounds.Height)});}
                    }
                    if(next.depth<8){var walker=TreeWalker.ControlViewWalker;var child=walker.GetFirstChild(next.element);int siblings=0;
                        while(child!=null&&siblings++<80&&queue.Count<160){queue.Enqueue((child,next.depth+1));child=walker.GetNextSibling(child);}if(child!=null)truncated=true;
                    }else truncated=true;
                }catch(ElementNotAvailableException){truncated=true;}
            }
            truncated=truncated||queue.Count>0;
            if(action!=null){
                stage="input_validate";
                if(!new[]{"hover","click","scroll_up","scroll_down"}.Contains(action)||target==null||p["observedAt"]?.Type!=JTokenType.Integer||(long?)p["observedAt"]>DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()+1000||(long?)p["observedAt"]<DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-120000)throw new InvalidOperationException("view_action_invalid");
                var match=elements.OfType<JObject>().SingleOrDefault(item=>JToken.DeepEquals(item["runtimeId"],target["runtimeId"])&&JToken.DeepEquals(item["bounds"],target["bounds"])&&(string?)item["name"]==(string?)target["name"]&&(string?)item["type"]==(string?)target["type"]);
                if(match==null||(bool?)match["enabled"]!=true)throw new InvalidOperationException("view_target_changed");
                var b=(JArray)match["bounds"]!;double x=rect.Left+(double)b[0]+(double)b[2]/2,y=rect.Top+(double)b[1]+(double)b[3]/2;
                if((double)b[2]<=0||(double)b[3]<=0||x<rect.Left||x>=rect.Right||y<rect.Top||y>=rect.Bottom)throw new InvalidOperationException("view_target_changed");
                if(excluded!=IntPtr.Zero&&GetWindowRect(excluded,out var mask)&&x>=mask.Left&&x<mask.Right&&y>=mask.Top&&y<mask.Bottom)throw new InvalidOperationException("view_target_excluded");
                if(GetAncestor(GetForegroundWindow(),2)!=window)throw new InvalidOperationException("view_window_changed");
                var hit=AutomationElement.FromPoint(new System.Windows.Point(x,y));
                var cursorWindow=(long?)p["cursorWindow"]??0;
                bool ownMarker=cursorWindow!=0&&hit.Current.NativeWindowHandle==cursorWindow&&hit.Current.ProcessId==expected;
                bool targetHit=ownMarker;
                for(int depth=0;hit!=null&&depth<12&&!targetHit;depth++){
                    if(JToken.DeepEquals(new JArray(hit.GetRuntimeId()),match["runtimeId"]))targetHit=true;
                    else hit=TreeWalker.ControlViewWalker.GetParent(hit);
                }
                if(!targetHit)throw new InvalidOperationException("view_target_obscured");
                var element=observedElements[(string)match["id"]!];Action perform=()=>{};
                // Semantic control patterns never move the OS pointer or send
                // mouse/keyboard input. There is deliberately no physical fallback.
                if(action=="click"){
                    if(element.TryGetCurrentPattern(InvokePattern.Pattern,out var invoke))perform=()=>((InvokePattern)invoke).Invoke();
                    else if(element.TryGetCurrentPattern(SelectionItemPattern.Pattern,out var select))perform=()=>((SelectionItemPattern)select).Select();
                    else throw new InvalidOperationException("view_pattern_unsupported");
                }else if(action=="scroll_up"||action=="scroll_down"){
                    if(!element.TryGetCurrentPattern(ScrollPattern.Pattern,out var scroll)||!((ScrollPattern)scroll).Current.VerticallyScrollable)throw new InvalidOperationException("view_pattern_unsupported");
                    perform=()=>((ScrollPattern)scroll).Scroll(ScrollAmount.NoAmount,action=="scroll_up"?ScrollAmount.SmallDecrement:ScrollAmount.SmallIncrement);
                }
                stage="semantic_action";dispatched=true;perform();
                // A fresh observation is made by the parent in a new helper call.
                // Invoking a pattern is not application or document verification.
                Console.WriteLine(new JObject{["dispatched"]=true,["action"]=action,["backend"]=action=="hover"?"virtual_marker":"uia_pattern",["systemPointerUsed"]=false,["applicationVerified"]=false}.ToString(Formatting.None));return;
            }
            string? image=null,imageHash=null,imageUnavailableReason=null;int imageWidth=0,imageHeight=0;string imageStatus="unavailable";
            // Pixels are optional evidence. An allowed UIA observation survives a
            // capture/encoding failure; never substitute a different capture API.
            // Identity/foreground checks below remain mandatory for either path.
            try {stage="capture";using(var bitmap=new Bitmap(width,height,PixelFormat.Format24bppRgb)){
                using(var graphics=Graphics.FromImage(bitmap)){var dc=graphics.GetHdc();bool captured;try{captured=PrintWindow(window,dc,2);}finally{graphics.ReleaseHdc(dc);}if(!captured)throw new InvalidOperationException("view_capture_failed");
                    if(excluded!=IntPtr.Zero&&GetWindowRect(excluded,out var mask))graphics.FillRectangle(Brushes.White,mask.Left-rect.Left,mask.Top-rect.Top,mask.Right-mask.Left,mask.Bottom-mask.Top);
                }
                stage="encode";var colors=new HashSet<int>();for(int y=0;y<height;y+=Math.Max(1,height/30))for(int x=0;x<width;x+=Math.Max(1,width/30))colors.Add(bitmap.GetPixel(x,y).ToArgb());
                if(colors.Count>3){for(int edge=960;edge>=480;edge-=160){double scale=Math.Min(1,Math.Min((double)edge/width,640.0/height));imageWidth=(int)(width*scale);imageHeight=(int)(height*scale);
                    using(var resized=new Bitmap(bitmap,imageWidth,imageHeight))using(var stream=new MemoryStream()){resized.Save(stream,ImageFormat.Png);var bytes=stream.ToArray();if(bytes.Length<=90000){image=Convert.ToBase64String(bytes);imageHash=Hash(bytes);imageStatus="captured";break;}}
                }}
            }}catch(Exception error) when (error is ExternalException||error is ArgumentException||(error is InvalidOperationException&&error.Message=="view_capture_failed")){
                image=null;imageHash=null;imageWidth=0;imageHeight=0;imageStatus="unavailable";
                imageUnavailableReason=stage=="encode"?"view_encode_failed":"view_capture_failed";
            }
            stage="validate";GetWindowThreadProcessId(window,out actual);if(actual!=expected||GetAncestor(GetForegroundWindow(),2)!=window)throw new InvalidOperationException("view_window_changed");
            Console.WriteLine(new JObject{["elements"]=elements,["truncated"]=truncated,["window"]=window.ToInt64(),["processId"]=actual,["width"]=width,["height"]=height,["imageStatus"]=imageStatus,["imageUnavailableReason"]=imageUnavailableReason,["imageWidth"]=imageWidth,["imageHeight"]=imageHeight,["imageSha256"]=imageHash,["image"]=image,["observedAt"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.ToString(Formatting.None));
        }catch(Exception error){var code=error is InvalidOperationException&&error.Message.StartsWith("view_")?error.Message:"view_inspection_failed";Console.WriteLine(new JObject{["error"]=code,["dispatched"]=dispatched,["stage"]=stage,["errorType"]=error.GetType().Name,["hresult"]=error.HResult}.ToString(Formatting.None));}
    }
}

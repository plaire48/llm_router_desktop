using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace Nubi.Office.Host
{
    // This graphic has no input-device capability. It never captures the mouse,
    // moves the system pointer, or activates an Office window.
    internal sealed class OfficeCursorOverlay : Form
    {
        [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
        [StructLayout(LayoutKind.Sequential)] private struct PointNative {public int X,Y;}
        [StructLayout(LayoutKind.Sequential)] private struct SizeNative {public int Width,Height;}
        [StructLayout(LayoutKind.Sequential,Pack=1)] private struct Blend {public byte Operation,Flags,Alpha,Format;}
        [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr window,IntPtr dest,ref PointNative position,ref SizeNative size,IntPtr source,ref PointNative origin,uint key,ref Blend blend,uint flags);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window,uint flags);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int width,int height,uint flags);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window,int command);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
        [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out Rect rect);
        [DllImport("user32.dll",CharSet=CharSet.Unicode)] private static extern bool SystemParametersInfo(uint action,uint parameter,out bool value,uint flags);
        private const int MoveMilliseconds=160,ClickMilliseconds=240;
        private readonly Timer timer=new Timer{Interval=16};
        private readonly Func<bool> motionPreference;
        private IntPtr ownerWindow;
        private Rect ownerBounds;
        private DateTime expires,lastMark;
        private Point start,target,current;
        private bool hasAnchor,moving,motionEnabled;
        private long moveStarted,clickStarted;
        private TaskCompletionSource<bool>? arrival;
        public bool MarkerVisible=>IsHandleCreated&&IsWindowVisible(Handle);
        public bool Moving=>moving;
        public bool MotionEnabled=>motionEnabled;
        public OfficeCursorOverlay():this(ReadMotionPreference){}
        internal OfficeCursorOverlay(Func<bool> preference)
        {
            motionPreference=preference;
            FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;
            AutoScaleMode=AutoScaleMode.None;Size=new Size(58,60);
            AccessibleName="누비 AI Agent 작업 위치";
            timer.Tick+=(_,__)=>TickMarker();
        }
        private static bool ReadMotionPreference()=>SystemParametersInfo(0x1042,0,out var enabled,0)&&enabled;
        protected override bool ShowWithoutActivation=>true;
        protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x00000020|0x00000080|0x00080000;return p;}}
        protected override void WndProc(ref Message message)
        {
            if(message.Msg==0x84){message.Result=new IntPtr(-1);return;}
            if(message.Msg==0x21){message.Result=new IntPtr(3);return;}
            base.WndProc(ref message);
        }
        private static bool SameBounds(Rect a,Rect b)=>a.Left==b.Left&&a.Top==b.Top&&a.Right==b.Right&&a.Bottom==b.Bottom;
        private bool OwnerCurrent()=>GetAncestor(GetForegroundWindow(),2)==ownerWindow&&GetWindowRect(ownerWindow,out var now)&&SameBounds(now,ownerBounds);
        private static double Elapsed(long since)=>(Stopwatch.GetTimestamp()-since)*1000d/Stopwatch.Frequency;
        public bool Mark(IntPtr window,JArray bounds)
        {
            if(InvokeRequired)return (bool)Invoke(new Func<bool>(()=>Mark(window,bounds)));
            if(bounds.Count!=4||GetAncestor(GetForegroundWindow(),2)!=window||!GetWindowRect(window,out var rect)){Dismiss();return false;}
            double width=(double)bounds[2],height=(double)bounds[3];
            if(width<=0||height<=0){Dismiss();return false;}
            // Arrow tip (18,18) points inside the actually observed element.
            int x=rect.Left+(int)(double)bounds[0]+Math.Min(18,(int)width/2)-18;
            int y=rect.Top+(int)(double)bounds[1]+Math.Min(18,(int)height/2)-18;
            if(x<rect.Left||y<rect.Top||x+Width>rect.Right||y+Height>rect.Bottom){Dismiss();return false;}
            bool reuse=hasAnchor&&ownerWindow==window&&SameBounds(ownerBounds,rect)&&(DateTime.UtcNow-lastMark).TotalSeconds<30;
            arrival?.TrySetResult(false);
            ownerWindow=window;ownerBounds=rect;motionEnabled=motionPreference();
            target=new Point(x,y);start=reuse?current:target;
            moving=motionEnabled&&start!=target;current=moving?start:target;clickStarted=0;
            moveStarted=Stopwatch.GetTimestamp();lastMark=DateTime.UtcNow;expires=lastMark.AddSeconds(8);hasAnchor=true;
            arrival=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            if(!RenderMarker(current,0)||!SetWindowPos(Handle,new IntPtr(-1),current.X,current.Y,Width,Height,0x0010|0x0040)){Dismiss();return false;}
            if(!moving)arrival.TrySetResult(true);
            timer.Start();return MarkerVisible;
        }
        public Task<bool> WaitForArrival()=>arrival?.Task??Task.FromResult(false);
        private void TickMarker()
        {
            if(!OwnerCurrent()){Dismiss();return;}
            if(DateTime.UtcNow>expires){HideMarker(false);return;}
            bool repaint=moving||clickStarted!=0;
            if(moving){
                double progress=Math.Min(1,Elapsed(moveStarted)/MoveMilliseconds),eased=1-Math.Pow(1-progress,3);
                current=new Point((int)Math.Round(start.X+(target.X-start.X)*eased),(int)Math.Round(start.Y+(target.Y-start.Y)*eased));
                if(progress>=1)moving=false;
            }
            double pulse=clickStarted==0?0:Math.Min(1,Elapsed(clickStarted)/ClickMilliseconds);
            if(repaint&&!RenderMarker(current,pulse)){Dismiss();return;}
            if(!moving)arrival?.TrySetResult(true);
            if(pulse>=1)clickStarted=0;
        }
        // A pulse means the semantic click was dispatched, never task success.
        public void IndicateClick()
        {
            if(InvokeRequired){BeginInvoke(new Action(IndicateClick));return;}
            if(!MarkerVisible||!OwnerCurrent()||!motionEnabled)return;
            clickStarted=Stopwatch.GetTimestamp();RenderMarker(current,0.01);
        }
        public void Settle()
        {
            if(InvokeRequired){BeginInvoke(new Action(Settle));return;}
            if(!MarkerVisible)return;
            if(!OwnerCurrent()){Dismiss();return;}
            SetWindowPos(Handle,new IntPtr(-1),0,0,0,0,0x0010|0x0001|0x0002);
            expires=DateTime.UtcNow.AddMilliseconds(1200);
        }
        public void Dismiss(){if(IsDisposed)return;if(InvokeRequired){BeginInvoke(new Action(Dismiss));return;}HideMarker(true);}
        private void HideMarker(bool forget)
        {
            timer.Stop();moving=false;clickStarted=0;arrival?.TrySetResult(false);
            if(forget)hasAnchor=false;
            if(IsHandleCreated)ShowWindow(Handle,0);
        }
        private bool RenderMarker(Point position,double pulse)
        {
            using(var bitmap=new Bitmap(Width,Height,PixelFormat.Format32bppPArgb)){
                using(var graphics=Graphics.FromImage(bitmap)){graphics.Clear(Color.Transparent);DrawMarker(graphics,pulse);}
                var dc=CreateCompatibleDC(IntPtr.Zero);if(dc==IntPtr.Zero)return false;
                IntPtr pixels=IntPtr.Zero,previous=IntPtr.Zero;
                try {
                    pixels=bitmap.GetHbitmap(Color.FromArgb(0));previous=SelectObject(dc,pixels);
                    if(previous==IntPtr.Zero||previous==new IntPtr(-1))return false;
                    var point=new PointNative{X=position.X,Y=position.Y};var size=new SizeNative{Width=Width,Height=Height};var origin=new PointNative();
                    var blend=new Blend{Alpha=255,Format=1};
                    return UpdateLayeredWindow(Handle,IntPtr.Zero,ref point,ref size,dc,ref origin,0,ref blend,2);
                } finally {
                    if(previous!=IntPtr.Zero&&previous!=new IntPtr(-1))SelectObject(dc,previous);
                    if(pixels!=IntPtr.Zero)DeleteObject(pixels);DeleteDC(dc);
                }
            }
        }
        private static void DrawMarker(Graphics graphics,double pulse)
        {
            graphics.SmoothingMode=SmoothingMode.AntiAlias;
            var blue=Color.FromArgb(27,100,218);
            if(pulse>0&&pulse<1){float radius=(float)(4+12*pulse);using(var ring=new Pen(Color.FromArgb((int)(140*(1-pulse)),blue),2))graphics.DrawEllipse(ring,18-radius,18-radius,radius*2,radius*2);}
            // Independently drawn rounded arrowhead, matching the reference's
            // compact black face and white edge. No permanent text badge.
            using(var arrow=new GraphicsPath()){
                arrow.AddBezier(18,18,16,17,15,19,16,22);
                arrow.AddLine(16,22,24,44);
                arrow.AddBezier(24,44,25,47,28,47,29,44);
                arrow.AddLine(29,44,34,34);
                arrow.AddLine(34,34,43,30);
                arrow.AddBezier(43,30,46,29,46,26,43,25);
                arrow.AddLine(43,25,20,17);
                arrow.AddBezier(20,17,19,17,18,17,18,18);
                arrow.CloseFigure();
                using(var shadow=new Pen(Color.FromArgb(55,0,0,0),5)){shadow.LineJoin=LineJoin.Round;graphics.TranslateTransform(0,1);graphics.DrawPath(shadow,arrow);graphics.TranslateTransform(0,-1);}
                using(var fill=new SolidBrush(Color.FromArgb(26,26,28)))using(var outline=new Pen(Color.White,2)){outline.LineJoin=LineJoin.Round;graphics.FillPath(fill,arrow);graphics.DrawPath(outline,arrow);}
            }
        }

        protected override void Dispose(bool disposing){if(disposing){HideMarker(true);timer.Dispose();}base.Dispose(disposing);}
    }
}

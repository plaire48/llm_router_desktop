using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// DWM composes the chosen window directly. No bitmap, screenshot, file, IPC
// pixels, input injection or website API is involved. The thumbnail belongs
// to this helper's top-level window, as required by DwmRegisterThumbnail.
sealed class ArrivalPreview : IDisposable {
 sealed class Surface : Form {
  internal Surface(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;BackColor=Color.FromArgb(241,247,254);}
  protected override bool ShowWithoutActivation=>true;
  protected override CreateParams CreateParams{get{var p=base.CreateParams;p.ExStyle|=0x08000000|0x80|0x20;return p;}}
  protected override void WndProc(ref Message m){if(m.Msg==0x84){m.Result=new IntPtr(-1);return;}if(m.Msg==0x21){m.Result=new IntPtr(3);return;}base.WndProc(ref m);}
 }
 sealed class Owner : IWin32Window {public IntPtr Handle{get;private set;}internal Owner(IntPtr handle){Handle=handle;}}
 Surface surface;IntPtr thumbnail;readonly Stopwatch clock=Stopwatch.StartNew();
 internal bool Expired=>clock.ElapsedMilliseconds>1200;
 internal ArrivalPreview(IntPtr parent,IntPtr source,Rectangle bounds){
  try{
   surface=new Surface{Bounds=bounds};var handle=surface.Handle;
   if(DwmRegisterThumbnail(handle,source,out thumbnail)!=0)throw new InvalidOperationException("dock_preview_unavailable");
   Update(bounds);surface.Show(new Owner(parent));
  }catch{Dispose();throw;}
 }
 internal void Update(Rectangle bounds){
  if(surface==null)return;surface.Bounds=bounds;
  // Critically damped arrival: no oscillation over text, settles in 440 ms.
  double t=Math.Min(1,clock.Elapsed.TotalMilliseconds/440),spring=1-(1+8*t)*Math.Exp(-8*t);
  spring/=1-9*Math.Exp(-8);double scale=.88+.12*spring;
  int w=(int)Math.Round(bounds.Width*scale),h=(int)Math.Round(bounds.Height*scale);
  int left=(bounds.Width-w)/2,top=Math.Min(bounds.Height-h,(bounds.Height-h)/2+(int)Math.Round(14*(1-spring)));
  var props=new Properties{flags=1|4|8|16,destination=new Rect{left=left,top=top,right=left+w,bottom=top+h},opacity=255,visible=true,clientOnly=false};
  if(DwmUpdateThumbnailProperties(thumbnail,ref props)!=0)throw new InvalidOperationException("dock_preview_unavailable");
 }
 public void Dispose(){if(thumbnail!=IntPtr.Zero){DwmUnregisterThumbnail(thumbnail);thumbnail=IntPtr.Zero;}if(surface!=null){surface.Dispose();surface=null;}}
 [StructLayout(LayoutKind.Sequential)]struct Rect{public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)]struct Properties{public uint flags;public Rect destination,source;public byte opacity;[MarshalAs(UnmanagedType.Bool)]public bool visible;[MarshalAs(UnmanagedType.Bool)]public bool clientOnly;}
 [DllImport("dwmapi.dll")]static extern int DwmRegisterThumbnail(IntPtr destination,IntPtr source,out IntPtr thumbnail);
 [DllImport("dwmapi.dll")]static extern int DwmUpdateThumbnailProperties(IntPtr thumbnail,ref Properties properties);
 [DllImport("dwmapi.dll")]static extern int DwmUnregisterThumbnail(IntPtr thumbnail);
}

using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed class SlideContentDocument : ContentDocument
    {
        public SlideContentDocument(object document,bool created):base(document,created){}
        public override void Capture(dynamic window)
        {
            using(var com=new ComObjects()){
                dynamic selection=com.Keep(window.Selection);int type=selection.Type;
                if(type==1){dynamic range=com.Keep(selection.SlideRange);for(int i=1;i<=range.Count;i++){dynamic slide=com.Keep(range[i]);Allowed.Add("s-"+slide.SlideID);}}
                else if(type==2){dynamic slides=com.Keep(selection.SlideRange),slide=com.Keep(slides[1]),shapes=com.Keep(selection.ShapeRange);for(int i=1;i<=shapes.Count;i++){dynamic shape=com.Keep(shapes[i]);Allowed.Add("s-"+slide.SlideID+"/h-"+shape.Id);}}
                // A text cursor/subrange is not authority over the whole shape.
            }
        }
        private static string Notes(dynamic slide,ComObjects com)
        {
            dynamic page=com.Keep(slide.NotesPage),shapes=com.Keep(page.Shapes);string notes="";
            for(int i=1;i<=shapes.Count;i++){dynamic shape=com.Keep(shapes[i]);if((int)shape.Type==14){dynamic placeholder=com.Keep(shape.PlaceholderFormat);if((int)placeholder.Type==2){dynamic frame=com.Keep(shape.TextFrame),range=com.Keep(frame.TextRange);notes=(string)range.Text;}}}
            return notes;
        }
        private static JArray RunDetails(dynamic range,ComObjects com)
        {
            dynamic runs=com.Keep(range.Runs());int count=runs.Count;
            var result=new JArray();if(count>128)throw new OfficeFault("evidence_limit");int previewRemaining=4000;
            for(int i=1;i<=count;i++){
                dynamic run=com.Keep(range.Runs(i,1)),font=com.Keep(run.Font),color=com.Keep(font.Color);
                string text=(string)run.Text;int previewLength=Math.Min(previewRemaining,text.Length);previewRemaining-=previewLength;
                var item=new JObject{["index"]=i,["text"]=text.Substring(0,previewLength),["fontName"]=(string)font.Name,["fontSize"]=(float)font.Size,["bold"]=(int)font.Bold,["italic"]=(int)font.Italic,["underline"]=(int)font.Underline,["colorRgb"]=(int)color.RGB};
                if(previewLength<text.Length){item["truncated"]=true;item["textLength"]=text.Length;item["textHash"]=Hash(text);}
                result.Add(item);
            }
            return result;
        }
        public override List<JObject> Items()
        {
            EnsureOpen();using(var com=new ComObjects()){
                dynamic slides=com.Keep(Doc.Slides),page=com.Keep(Doc.PageSetup);var items=new List<JObject>();
                int count=slides.Count;if(count>200)throw new OfficeFault("evidence_limit");
                for(int i=1;i<=count;i++){
                    dynamic slide=com.Keep(slides[i]),shapes=com.Keep(slide.Shapes),layout=com.Keep(slide.CustomLayout),design=com.Keep(slide.Design);
                    string id="s-"+slide.SlideID,notes=Notes(slide,com);
                    var slideItem=new JObject{["id"]=id,["kind"]="slide",["index"]=i,["layout"]=(string)layout.Name,["design"]=(string)design.Name,["width"]=(float)page.SlideWidth,["height"]=(float)page.SlideHeight,["notes"]=notes.Length>4000?notes.Substring(0,4000):notes,["editable"]=notes.Length<=4000&&(Created||Allowed.Contains(id))};
                    if(notes.Length>4000){slideItem["truncated"]=true;slideItem["notesTruncated"]=true;slideItem["notesLength"]=notes.Length;slideItem["notesHash"]=Hash(notes);}
                    items.Add(slideItem);if(items.Count>2000)throw new OfficeFault("evidence_limit");
                    for(int j=1;j<=shapes.Count;j++){
                        dynamic shape=com.Keep(shapes[j]);string shapeId=id+"/h-"+shape.Id;
                        var value=new JObject{["id"]=shapeId,["kind"]="shape",["slideId"]=id,["name"]=(string)shape.Name,["shapeType"]=(int)shape.Type,["left"]=(float)shape.Left,["top"]=(float)shape.Top,["width"]=(float)shape.Width,["height"]=(float)shape.Height,["rotation"]=(float)shape.Rotation,["editable"]=false};
                        if((int)shape.HasTextFrame==-1){
                            dynamic frame=com.Keep(shape.TextFrame),range=com.Keep(frame.TextRange),font=com.Keep(range.Font),runs=com.Keep(range.Runs()),paragraphs=com.Keep(range.Paragraphs()),frame2=com.Keep(shape.TextFrame2),range2=com.Keep(frame2.TextRange);
                            string text=range.Text;
                            bool uniform=runs.Count<=1&&paragraphs.Count<=1;
                            value["text"]=text.Length>4000?text.Substring(0,4000):text;value["fontName"]=(string)font.Name;value["fontSize"]=(float)font.Size;value["bold"]=(int)font.Bold;value["italic"]=(int)font.Italic;
                            if(text.Length>4000){value["truncated"]=true;value["textLength"]=text.Length;value["textHash"]=Hash(text);slideItem["editable"]=false;}
                            value["runs"]=RunDetails(range,com);
                            value["overflow"]=(float)range2.BoundHeight>(float)shape.Height-(float)frame2.MarginTop-(float)frame2.MarginBottom+1 || (float)range2.BoundWidth>(float)shape.Width-(float)frame2.MarginLeft-(float)frame2.MarginRight+1;
                            value["editable"]=text.Length<=4000&&uniform&&(int)frame.AutoSize==0&&(Created||Allowed.Contains(shapeId)||Allowed.Contains(id));
                        }
                        items.Add(value);if(items.Count>2000)throw new OfficeFault("evidence_limit");
                    }
                }
                return items;
            }
        }
        public override string Fingerprint(List<JObject> items)=>Hash(new JArray(items).ToString(Formatting.None));
        public override string ReadText(string itemId,string field)
        {
            EnsureOpen();using(var com=new ComObjects()){
                dynamic slide=Slide(itemId,com);string slideId="s-"+slide.SlideID;
                if(field=="notes"&&itemId==slideId)return Notes(slide,com);
                if(field=="text"&&itemId.StartsWith(slideId+"/h-",StringComparison.Ordinal)){
                    dynamic shape=Shape(slide,itemId,com);
                    if(itemId!=slideId+"/h-"+shape.Id||(int)shape.HasTextFrame!=-1)throw new OfficeFault("unsupported_target");
                    dynamic frame=com.Keep(shape.TextFrame),range=com.Keep(frame.TextRange);return (string)range.Text;
                }
            }
            throw new OfficeFault("unsupported_target");
        }
        public override void Validate(JObject op,List<JObject> before)
        {
            if((int)Doc.ReadOnly==-1)throw new OfficeFault("document_not_writable");
            string? type=(string?)op["type"];
            if(type=="replace_text"){
                Keys(op,"type","targetId","text");String(op,"text");string id=String(op,"targetId",100);
                if(!before.Any(i=>(string?)i["id"]==id&&(string?)i["kind"]=="shape"&&(bool?)i["editable"]==true))throw new OfficeFault("unsupported_target");
            }else if(type=="duplicate_slide"){
                Keys(op,"type","targetId");string id=String(op,"targetId",100);
                if(!before.Any(i=>(string?)i["id"]==id&&(string?)i["kind"]=="slide"&&(bool?)i["editable"]==true))throw new OfficeFault("out_of_scope");
            }else if(type=="add_slide"){
                Keys(op,"type","title","bullets","notes");if(!Created)throw new OfficeFault("out_of_scope");ValidateContent(op);
            }else if(type=="set_slide_content"){
                Keys(op,"type","targetId","title","bullets","notes");ValidateContent(op);
                if(!Created||!before.Any(i=>(string?)i["id"]==(string?)op["targetId"]&&(string?)i["kind"]=="slide"&&(bool?)i["editable"]==true))throw new OfficeFault("out_of_scope");
            }else throw new OfficeFault("unsupported_operation");
        }
        private static void ValidateContent(JObject op)
        {
            if(!String(op,"title",160).Any()||!(op["bullets"] is JArray bullets)||bullets.Count>8||bullets.Any(b=>b.Type!=JTokenType.String||b.Value<string>()!.Length>350||string.IsNullOrWhiteSpace(b.Value<string>())||b.Value<string>()!.Any(char.IsControl)))throw new OfficeFault("invalid_plan");
            var notes=(string?)op["notes"];if(notes==null||notes.Length>4000||notes.Any(c=>char.IsControl(c)&&c!='\r'&&c!='\n'&&c!='\t'))throw new OfficeFault("invalid_plan");
        }
        private dynamic Slide(string id,ComObjects com)
        {
            var pieces=id.Split('/');if(!pieces[0].StartsWith("s-")||!int.TryParse(pieces[0].Substring(2),out int n))throw new OfficeFault("unsupported_target");
            dynamic slides=com.Keep(Doc.Slides);return com.Keep(slides.FindBySlideID(n));
        }
        private static dynamic Shape(dynamic slide,string id,ComObjects com)
        {
            var pieces=id.Split('/');if(pieces.Length!=2||!pieces[1].StartsWith("h-")||!int.TryParse(pieces[1].Substring(2),out int n))throw new OfficeFault("unsupported_target");
            dynamic shapes=com.Keep(slide.Shapes);for(int i=1;i<=shapes.Count;i++){dynamic shape=com.Keep(shapes[i]);if((int)shape.Id==n)return shape;}throw new OfficeFault("unsupported_target");
        }
        private static void Fill(dynamic slide,JObject op,ComObjects com)
        {
            dynamic shapes=com.Keep(slide.Shapes),title=com.Keep(shapes.Title),titleFrame=com.Keep(title.TextFrame),titleRange=com.Keep(titleFrame.TextRange),placeholders=com.Keep(shapes.Placeholders),body=com.Keep(placeholders[2]),bodyFrame=com.Keep(body.TextFrame),bodyRange=com.Keep(bodyFrame.TextRange),titleFrame2=com.Keep(title.TextFrame2),bodyFrame2=com.Keep(body.TextFrame2);
            titleFrame.AutoSize=0;bodyFrame.AutoSize=0;titleFrame2.AutoSize=0;bodyFrame2.AutoSize=0;
            titleRange.Text=(string)op["title"]!;bodyRange.Text=string.Join("\r",((JArray)op["bullets"]!).Values<string>());
            dynamic notePage=com.Keep(slide.NotesPage),noteShapes=com.Keep(notePage.Shapes);
            for(int i=1;i<=noteShapes.Count;i++){dynamic shape=com.Keep(noteShapes[i]);if((int)shape.Type==14){dynamic format=com.Keep(shape.PlaceholderFormat);if((int)format.Type==2){dynamic frame=com.Keep(shape.TextFrame),text=com.Keep(frame.TextRange);text.Text=(string)op["notes"]!;return;}}}
            if(!string.IsNullOrEmpty((string?)op["notes"]))throw new OfficeFault("unsupported_target");
        }
        public override JObject Apply(JObject op)
        {
            using(var com=new ComObjects()){
                string type=(string)op["type"]!;
                if(type=="add_slide"){
                    dynamic slides=com.Keep(Doc.Slides),slide=com.Keep(slides.Add(slides.Count+1,2));Fill(slide,op,com);return new JObject{["targetId"]="s-"+slide.SlideID};
                }
                string id=(string)op["targetId"]!;dynamic target=Slide(id,com);
                if(type=="duplicate_slide"){
                    dynamic range=com.Keep(target.Duplicate()),copy=com.Keep(range[1]);string newId="s-"+copy.SlideID;Allowed.Add(newId);return new JObject{["targetId"]=newId};
                }
                if(type=="set_slide_content"){Fill(target,op,com);return new JObject{["targetId"]=id};}
                dynamic shape=Shape(target,id,com),frame=com.Keep(shape.TextFrame),text=com.Keep(frame.TextRange);text.Text=(string)op["text"]!;return new JObject{["targetId"]=id};
            }
        }
        public override JArray Check(JObject op,JObject expected,List<JObject> before,List<JObject> after)
        {
            string id=(string)expected["targetId"]!,type=(string)op["type"]!;var changed=after.Where(i=>(string?)i["id"]==id||(string?)i["slideId"]==id).ToArray();var checks=new JArray();
            if(type=="replace_text")checks.Add(CheckResult("도형 내용",changed.Length==1&&(string?)changed[0]["text"]==(string?)op["text"]));
            if(type=="add_slide"||type=="set_slide_content"){
                var texts=changed.Where(i=>i["text"]!=null).Select(i=>(string?)i["text"]).ToArray();
                checks.Add(CheckResult("제목과 본문",texts.Contains((string?)op["title"])&&texts.Contains(string.Join("\r",((JArray)op["bullets"]!).Values<string>()))));
                checks.Add(CheckResult("발표자 노트",changed.Any(i=>(string?)i["notes"]==(string?)op["notes"])));
            }
            if(type=="duplicate_slide")checks.Add(CheckResult("슬라이드 복제",after.Count(i=>(string?)i["kind"]=="slide")==before.Count(i=>(string?)i["kind"]=="slide")+1));
            checks.Add(CheckResult("텍스트 넘침",changed.All(i=>(bool?)i["overflow"]!=true)));
            // Ignore slide indexes after insertion, but never ignore source text
            // or original shape geometry. New clone IDs do not replace originals.
            bool preserved=before.All(old=>{
                var next=after.FirstOrDefault(i=>(string?)i["id"]==(string?)old["id"]);if(next==null)return false;
                var a=(JObject)old.DeepClone();var b=(JObject)next.DeepClone();a.Remove("index");b.Remove("index");
                if(type=="set_slide_content"&&((string?)a["id"]==id||(string?)a["slideId"]==id))return true;
                if(type=="replace_text"&&(string?)a["id"]==id){
                    a.Remove("text");b.Remove("text");a.Remove("overflow");b.Remove("overflow");
                    // Compare per-run font attributes, not the deliberately
                    // replaced text. Mixed runs remain read-only.
                    foreach(var item in new[]{a,b})if(item["runs"] is JArray details)foreach(var run in details.OfType<JObject>())run.Remove("text");
                }
                return JToken.DeepEquals(a,b);
            });checks.Add(CheckResult("원본 내용과 도형 배치 보존",preserved));return checks;
        }
        public override string Extension => (bool)Doc.HasVBProject?".pptm":".pptx";
        public override ContentDocument CreateCopy(string path)
        {
            using(var com=new ComObjects()){
                string before=Fingerprint(Items());
                Doc.SaveCopyAs(path,System.IO.Path.GetExtension(path).Equals(".pptm",StringComparison.OrdinalIgnoreCase)?25:24);
                if(Fingerprint(Items())!=before)throw new OfficeFault("source_changed");
                dynamic application=com.Keep(Doc.Application),presentations=com.Keep(application.Presentations);
                int security=(int)application.AutomationSecurity;
                try{
                    application.AutomationSecurity=3; // msoAutomationSecurityForceDisable
                    object opened=presentations.Open(FileName:path,ReadOnly:0,Untitled:0,WithWindow:-1);
                    return new SlideContentDocument(opened,false);
                }finally{application.AutomationSecurity=security;}
            }
        }
        public override void Save(string path){Doc.SaveAs(path,Extension==".pptm"?25:24);}
        public override IntPtr ViewWindow(string? target,bool focus)
        {
            EnsureOpen();if(target!=null&&!Items().Any(i=>(string?)i["id"]==target))throw new OfficeFault("unsupported_target");
            using(var com=new ComObjects()){
                dynamic windows=com.Keep(Doc.Windows),window=com.Keep(windows[1]);
                if(focus){window.Activate();if(target!=null){dynamic slide=Slide(target,com),view=com.Keep(window.View);view.GotoSlide((int)slide.SlideIndex);if(target.Contains("/")){dynamic shape=Shape(slide,target,com);shape.Select(-1);}}}
                dynamic application=com.Keep(Doc.Application),active=com.Keep(application.ActivePresentation),activeWindow=com.Keep(application.ActiveWindow);
                if(!OfficeView.SameCom(active,Doc))throw new OfficeFault("view_window_changed");
                return new IntPtr((int)activeWindow.HWND);
            }
        }
        public override void Focus(){using(var com=new ComObjects()){dynamic windows=com.Keep(Doc.Windows),window=com.Keep(windows[1]);window.Activate();}}
    }
}

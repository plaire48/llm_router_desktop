using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Validation;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed partial class WordContentDocument : ContentDocument
    {
        private static readonly XNamespace W="http://schemas.openxmlformats.org/wordprocessingml/2006/main";
        private static readonly Dictionary<string,int> Styles=new Dictionary<string,int>{{"Normal",-1},{"Title",-63},{"Heading1",-2},{"Heading2",-3},{"Heading3",-4}};
        public WordContentDocument(object document,bool created):base(document,created){}
        public override void Capture(dynamic window)
        {
            using(var com=new ComObjects()){
                dynamic selection=com.Keep(window.Selection),range=com.Keep(selection.Range),paragraphs=com.Keep(Doc.Paragraphs);
                int start=range.Start,end=range.End;
                // A cursor is not authorization to replace its entire paragraph.
                for(int i=1;i<=paragraphs.Count;i++){dynamic p=com.Keep(paragraphs[i]),r=com.Keep(p.Range);if(start<end&&start<=r.Start&&end>=r.End-1)Allowed.Add("p-"+i);}
            }
            CaptureFields(window);
        }
        public override List<JObject> Items()
        {
            EnsureOpen();using(var com=new ComObjects()){
                dynamic paragraphs=com.Keep(Doc.Paragraphs),revisions=com.Keep(Doc.Revisions);
                int count=paragraphs.Count;if(count>2000)throw new OfficeFault("evidence_limit");
                bool writable=!(bool)Doc.ReadOnly&&(int)Doc.ProtectionType==-1&&!(bool)Doc.TrackRevisions&&revisions.Count==0;
                var items=FieldItems(writable);if(count+items.Count>2000)throw new OfficeFault("evidence_limit");
                for(int i=1;i<=count;i++){
                    dynamic p=com.Keep(paragraphs[i]),r=com.Keep(p.Range),font=com.Keep(r.Font),style=com.Keep(r.Style),fields=com.Keep(r.Fields),controls=com.Keep(r.ContentControls),bookmarks=com.Keep(r.Bookmarks),tables=com.Keep(r.Tables),shapes=com.Keep(r.InlineShapes);
                    string value=((string)r.Text).TrimEnd('\r','\a'),xml=(string)r.WordOpenXML;
                    if(xml.Length>8000000)throw new OfficeFault("evidence_limit");
                    var body=XDocument.Parse(xml).Descendants(W+"body").FirstOrDefault();var paragraph=body?.Descendants(W+"p").FirstOrDefault();
                    int runs=paragraph?.Elements(W+"r").Count()??0;
                    var format=(paragraph?.Element(W+"pPr")?.ToString()??"")+string.Join("",paragraph?.Elements(W+"r").Select(x=>x.Element(W+"rPr")?.ToString()??"")??Enumerable.Empty<string>());
                    bool plain=paragraph!=null&&!paragraph.Ancestors(W+"sdt").Any()&&paragraph.Elements().All(e=>e.Name==W+"pPr"||e.Name==W+"r")&&paragraph.Elements(W+"r").All(rn=>rn.Elements().All(e=>e.Name==W+"rPr"||e.Name==W+"t"));
                    bool safe=writable&&plain&&tables.Count==0&&fields.Count==0&&controls.Count==0&&bookmarks.Count==0&&shapes.Count==0&&runs<=1&&value.Length<=4000&&!value.Any(char.IsControl);
                    var item=new JObject{["id"]="p-"+i,["kind"]="paragraph",["text"]=value.Length>4000?value.Substring(0,4000):value,["truncated"]=value.Length>4000,["style"]=(string)style.NameLocal,["outlineLevel"]=(int)p.OutlineLevel,["inTable"]=tables.Count>0,["fields"]=(int)fields.Count,["controls"]=(int)controls.Count,["fontSize"]=(float)font.Size,["formatFingerprint"]=Hash(format),["editable"]=safe&&(Created||Allowed.Contains("p-"+i))};
                    if(value.Length>4000){item["textLength"]=value.Length;item["textHash"]=Hash(value);}
                    items.Add(item);
                }
                return items;
            }
        }
        public override string Fingerprint(List<JObject> items)
        {
            using(var com=new ComObjects()){dynamic content=com.Keep(Doc.Content);string xml=content.WordOpenXML;if(xml.Length>8000000)throw new OfficeFault("evidence_limit");return Hash(xml);}
        }
        public override string ReadText(string itemId,string field)
        {
            EnsureOpen();if(field!="text")throw new OfficeFault("unsupported_target");
            using(var com=new ComObjects()){
                if(itemId.StartsWith("p-",StringComparison.Ordinal)&&int.TryParse(itemId.Substring(2),out int index)&&itemId=="p-"+index){
                    dynamic paragraphs=com.Keep(Doc.Paragraphs);if(index<1||index>paragraphs.Count)throw new OfficeFault("unsupported_target");
                    dynamic paragraph=com.Keep(paragraphs[index]),range=com.Keep(paragraph.Range);return ((string)range.Text).TrimEnd('\r','\a');
                }
                if(itemId.StartsWith("cc-",StringComparison.Ordinal)){
                    dynamic controls=com.Keep(Doc.ContentControls);
                    for(int i=1;i<=controls.Count;i++){dynamic control=com.Keep(controls[i]);if(itemId=="cc-"+(string)control.ID){dynamic range=com.Keep(control.Range);return (string)range.Text;}}
                }
            }
            throw new OfficeFault("unsupported_target");
        }
        public override void Validate(JObject op,List<JObject> before)
        {
            if((bool)Doc.ReadOnly||(int)Doc.ProtectionType!=-1||(bool)Doc.TrackRevisions)throw new OfficeFault("document_not_writable");
            var type=(string?)op["type"];
            if(type=="fill_field"){
                Keys(op,"type","targetId","text");String(op,"text");string id=String(op,"targetId",100);
                if(!before.Any(p=>(string?)p["id"]==id&&(string?)p["kind"]=="field"&&(bool?)p["editable"]==true))throw new OfficeFault("unsupported_target");
            }else if(type=="replace_text"){
                Keys(op,"type","targetId","text");String(op,"text");var id=String(op,"targetId",100);
                if(!before.Any(p=>(string?)p["id"]==id&&(string?)p["kind"]=="paragraph"&&(bool?)p["editable"]==true))throw new OfficeFault("unsupported_target");
            }else if(type=="append_paragraph"){
                Keys(op,"type","text","style");if(!Created)throw new OfficeFault("out_of_scope");if(!String(op,"text").Any()||!Styles.ContainsKey(String(op,"style",30)))throw new OfficeFault("invalid_plan");
            }else if(type=="append_table"){
                Keys(op,"type","rows");if(!Created)throw new OfficeFault("out_of_scope");var rows=op["rows"] as JArray;
                if(rows==null||rows.Count<1||rows.Count>30||!(rows[0] is JArray first)||first.Count<1||first.Count>8||rows.Any(r=>!(r is JArray cells)||cells.Count!=first.Count||cells.Any(c=>c.Type!=JTokenType.String||c.Value<string>()!.Length>500||c.Value<string>()!.Any(char.IsControl))))throw new OfficeFault("invalid_plan");
            }else throw new OfficeFault("unsupported_operation");
        }
        public override JObject Apply(JObject op)
        {
            if((string?)op["type"]=="fill_field")return FillField(op);
            using(var com=new ComObjects()){
                if((string?)op["type"]=="replace_text"){
                    int i=int.Parse(((string)op["targetId"]!).Substring(2));dynamic paragraphs=com.Keep(Doc.Paragraphs),p=com.Keep(paragraphs[i]),r=com.Keep(p.Range);
                    // Keep the paragraph mark and its paragraph/section style.
                    r.End=r.End-1;r.Text=(string)op["text"]!;return new JObject{["targetId"]=(string)op["targetId"]!};
                }
                dynamic content=com.Keep(Doc.Content);int start=content.End-1;
                dynamic range=com.Keep(Doc.Range(start,start));
                if((string?)op["type"]=="append_paragraph"){
                    range.Text=(string)op["text"]!+"\r";
                    dynamic written=com.Keep(Doc.Range(start,start+((string)op["text"]!).Length));written.Style=Styles[(string)op["style"]!];
                    dynamic paragraphs=com.Keep(Doc.Paragraphs);return new JObject{["targetId"]="p-"+((int)paragraphs.Count-1)};
                }
                var rows=(JArray)op["rows"]!;dynamic tables=com.Keep(Doc.Tables),table=com.Keep(tables.Add(range,rows.Count,((JArray)rows[0]).Count));
                for(int r=0;r<rows.Count;r++)for(int c=0;c<((JArray)rows[r]).Count;c++){dynamic cell=com.Keep(table.Cell(r+1,c+1)),cellRange=com.Keep(cell.Range);cellRange.Text=(string)rows[r][c]!;}
                dynamic borders=com.Keep(table.Borders);borders.Enable=1;
                dynamic tableRows=com.Keep(table.Rows),header=com.Keep(tableRows[1]),headerRange=com.Keep(header.Range),headerFont=com.Keep(headerRange.Font);header.HeadingFormat=-1;headerFont.Bold=-1;
                table.AutoFitBehavior(2);return new JObject{["tableIndex"]=(int)tables.Count};
            }
        }
        public override JArray Check(JObject op,JObject expected,List<JObject> before,List<JObject> after)
        {
            var checks=new JArray();string type=(string)op["type"]!;var target=after.FirstOrDefault(p=>(string?)p["id"]==(string?)expected["targetId"]);
            if(type=="fill_field")return CheckField(op,expected,after);
            if(type=="replace_text"||type=="append_paragraph")checks.Add(CheckResult("문단 내용",target!=null&&(string?)target["text"]==(string?)op["text"]));
            if(type=="append_paragraph"){
                int level=(string?)op["style"]=="Heading1"?1:(string?)op["style"]=="Heading2"?2:(string?)op["style"]=="Heading3"?3:10;
                checks.Add(CheckResult("문단 제목 체계",target!=null&&(int?)target["outlineLevel"]==level));
            }
            if(type=="replace_text"){
                checks.Add(CheckResult("선택 밖 문단 보존",before.Count==after.Count&&before.All(p=>{
                    var next=after.FirstOrDefault(a=>(string?)a["id"]==(string?)p["id"]);if(next==null)return false;
                    return (string?)p["id"]==(string?)op["targetId"]?(string?)p["formatFingerprint"]==(string?)next["formatFingerprint"]:JToken.DeepEquals(p,next);
                })));
            }
            if(type=="append_table")using(var com=new ComObjects()){
                dynamic tables=com.Keep(Doc.Tables),table=com.Keep(tables[(int)expected["tableIndex"]!]);var rows=(JArray)op["rows"]!;bool equal=true;
                for(int r=0;r<rows.Count;r++)for(int c=0;c<((JArray)rows[r]).Count;c++){dynamic cell=com.Keep(table.Cell(r+1,c+1)),range=com.Keep(cell.Range);equal&=((string)range.Text).TrimEnd('\r','\a')==(string?)rows[r][c];}
                checks.Add(CheckResult("표 전체 내용",equal));
            }
            if(Created)using(var com=new ComObjects()){
                dynamic content=com.Keep(Doc.Content);string xml=content.WordOpenXML;
                var document=XDocument.Parse(xml).Descendants(W+"document").First();
                // Validate an in-memory element, not a ZIP package. This avoids
                // .NET Framework OPC/IsolatedStorage spilling plaintext to disk.
                var root=new DocumentFormat.OpenXml.Wordprocessing.Document(document.ToString());
                var errors=new OpenXmlValidator(FileFormatVersions.Office2016){MaxNumberOfErrors=20}.Validate(root).Take(20).ToArray();
                checks.Add(CheckResult("Word 2016 문서 XML 구조",errors.Length==0));
            }
            return checks;
        }
        public override string Extension => (bool)Doc.HasVBProject?".docm":".docx";
        public override ContentDocument CreateCopy(string path)
        {
            // Word has no Presentation.SaveCopyAs equivalent. SaveAs2 changes
            // this open document to the copy; the original disk path is untouched.
            // Old scopes retain their bound path and fail after this transition.
            Doc.SaveAs2(FileName:path,FileFormat:(int)Doc.SaveFormat,AddToRecentFiles:false,CompatibilityMode:0);
            if(!SavedAt(path))throw new OfficeFault("document_save_uncertain");
            // Acquire an owned COM reference for the new scope. Reusing the
            // managed RCW directly would release the same acquisition twice.
            using(var com=new ComObjects()){
                dynamic windows=com.Keep(Doc.Windows),window=com.Keep(windows[1]);
                return new WordContentDocument((object)window.Document,false);
            }
        }
        public override void Save(string path){Doc.SaveAs2(FileName:path,FileFormat:Extension==".docm"?13:12);}
        public override IntPtr ViewWindow(string? target,bool focus)
        {
            EnsureOpen();if(target!=null&&!Items().Any(i=>(string?)i["id"]==target))throw new OfficeFault("unsupported_target");
            using(var com=new ComObjects()){
                if(focus){Doc.Activate();if(target!=null){
                    if(!target.StartsWith("p-")&&!target.StartsWith("cc-"))throw new OfficeFault("unsupported_target");
                    if(target.StartsWith("p-")&&int.TryParse(target.Substring(2),out int index)){dynamic paragraphs=com.Keep(Doc.Paragraphs),paragraph=com.Keep(paragraphs[index]),range=com.Keep(paragraph.Range);range.Select();}
                    else if(target.StartsWith("cc-")){dynamic controls=com.Keep(Doc.ContentControls);for(int i=1;i<=controls.Count;i++){dynamic control=com.Keep(controls[i]);if((string)control.ID==target.Substring(3)){dynamic range=com.Keep(control.Range);range.Select();break;}}}
                }}
                dynamic application=com.Keep(Doc.Application),active=com.Keep(application.ActiveDocument),window=com.Keep(application.ActiveWindow);
                if(!OfficeView.SameCom(active,Doc))throw new OfficeFault("view_window_changed");
                return new IntPtr((int)window.Hwnd);
            }
        }
        public override void Focus(){Doc.Activate();}
    }
}

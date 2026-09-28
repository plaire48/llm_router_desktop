using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Excel = Microsoft.Office.Interop.Excel;
using Region = Nubi.Office.Core.Region;

namespace Nubi.Office.Host
{
    // Only generated drafts owned by this pane. Never resolve through ActiveWorkbook.
    public sealed class DocumentPort
    {
        private readonly Excel.Application app;
        private readonly string draftDirectory, saveDirectory;
        private sealed class Entry { public Excel.Workbook Book = null!; public JArray Specs = null!; public bool Saved; public bool Calculated; public string? SavePath; public string? SaveFingerprint; public JObject? SaveReceipt; }
        private readonly Dictionary<string, Entry> documents = new Dictionary<string, Entry>();
        private readonly Dictionary<string, JObject> opened = new Dictionary<string, JObject>();
        // Evaluation injects private artifact directories at host construction;
        // model/tool payloads cannot override production storage locations.
        public DocumentPort(Excel.Application application, string? draftDirectory = null, string? saveDirectory = null) { app = application; this.draftDirectory=Path.GetFullPath(draftDirectory??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"NubiOffice","Drafts"));this.saveDirectory=Path.GetFullPath(saveDirectory??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),"NubiOffice")); }
        private static string Hash(string path) { using (var sha=SHA256.Create()) using(var file=File.OpenRead(path)) return BitConverter.ToString(sha.ComputeHash(file)).Replace("-", "").ToLowerInvariant(); }
        private Entry Get(string id) { if(!documents.TryGetValue(id,out var e))throw new OfficeFault("document_closed");try {var ignored=e.Book.Name;}catch{throw new OfficeFault("document_closed");}return e; }
        public JObject Open(JObject payload)
        {
            var fileName=(string?)payload["fileName"]??"";var hash=(string?)payload["sha256"]??"";
            if(!Regex.IsMatch(fileName,@"^[a-f0-9-]{36}\.xlsx$")||!Regex.IsMatch(hash,@"^[a-f0-9]{64}$"))throw new OfficeFault("document_file_invalid");
            if(opened.TryGetValue(fileName,out var receipt)){if((string?)receipt["sourceHash"]!=hash)throw new OfficeFault("operation_collision");return (JObject)receipt.DeepClone();}
            // Retain recent receipts, not an arbitrary lifetime revision budget.
            if(opened.Count>=128){var expired=opened.FirstOrDefault(pair=>pair.Value["error"]==null&&pair.Value["documentId"]!=null&&!documents.ContainsKey((string)pair.Value["documentId"]!));if(expired.Key!=null)opened.Remove(expired.Key);}
            var path=Path.Combine(draftDirectory,fileName);
            if(!File.Exists(path)||new FileInfo(path).Length>10000000||Hash(path)!=hash)throw new OfficeFault("document_file_invalid");
            var specs=payload["specs"] as JArray??throw new OfficeFault("document_schema_invalid");
            if(specs.Count<1||specs.Count>8||specs.ToString(Formatting.None).Length>150000)throw new OfficeFault("document_schema_invalid");
            foreach(var s in specs){var a=Region.Parse((string?)s["address"]??"");if(a.Row!=1||a.Column!=1||a.Rows*a.Columns>1000||s["cells"] is not JArray cells||cells.Count>1000)throw new OfficeFault("document_schema_invalid");}
            // No active content or external package relationships in generated workbooks.
            using(var zip=ZipFile.OpenRead(path))foreach(var entry in zip.Entries){
                if(Regex.IsMatch(entry.FullName,@"vba|externalLink|embedding|connections|queryTable",RegexOptions.IgnoreCase))throw new OfficeFault("document_file_invalid");
                if(entry.Length>4000000)throw new OfficeFault("document_file_invalid");
                if(entry.FullName.EndsWith(".rels",StringComparison.OrdinalIgnoreCase)){using(var stream=new StreamReader(entry.Open()))if(Regex.IsMatch(stream.ReadToEnd(),"TargetMode\\s*=\\s*[\"']External",RegexOptions.IgnoreCase))throw new OfficeFault("document_file_invalid");}
            }
            var previous=(string?)payload["previousId"];
            if(previous!=null){var old=Get(previous);if(old.Saved||!old.Book.Saved)throw new OfficeFault("cells_changed");if((string?)Read(previous)["fingerprint"]!=(string?)payload["expectedFingerprint"])throw new OfficeFault("cells_changed");}
            var events=app.EnableEvents;var security=app.GetType().InvokeMember("AutomationSecurity",BindingFlags.GetProperty,null,app,null);
            receipt=new JObject{["error"]="document_open_uncertain",["sourceHash"]=hash};opened[fileName]=receipt;
            try{
                app.EnableEvents=false;app.GetType().InvokeMember("AutomationSecurity",BindingFlags.SetProperty,null,app,new object[]{3});
                var book=app.Workbooks.Open(path,UpdateLinks:0,ReadOnly:false,AddToMru:false,IgnoreReadOnlyRecommended:true);
                var id=Guid.NewGuid().ToString("N");documents[id]=new Entry{Book=book,Specs=(JArray)specs.DeepClone()};receipt["documentId"]=id;
                if(book.Worksheets.Count!=specs.Count)throw new OfficeFault("document_file_invalid");
                // Excel may interpret OOXML character widths using its local normal font.
                // Apply requested dimensions and print scaling through Excel before readback.
                foreach(JObject spec in specs){var sheet=(Excel.Worksheet)book.Worksheets[(string)spec["name"]!];foreach(var w in (JArray)spec["columnWidths"]!)((Excel.Range)sheet.Columns[(int)w["index"]!]).ColumnWidth=(double)w["size"]!;foreach(var h in (JArray)spec["rowHeights"]!)((Excel.Range)sheet.Rows[(int)h["index"]!]).RowHeight=(double)h["size"]!;sheet.PageSetup.Zoom=false;sheet.PageSetup.FitToPagesWide=1;sheet.PageSetup.FitToPagesTall=false;}

                // Repeated worksheet passes resolve acyclic cross-sheet dependencies without
                // recalculating unrelated user workbooks. Circular references are rejected.
                for(var pass=0;pass<specs.Count;pass++)foreach(Excel.Worksheet sheet in book.Worksheets)sheet.Calculate();
                var calculated=app.CalculationState==Excel.XlCalculationState.xlDone;
                foreach(Excel.Worksheet sheet in book.Worksheets)if(sheet.CircularReference!=null)calculated=false;
                documents[id].Calculated=calculated;
                var observed=Read(id);foreach(var property in observed.Properties())receipt[property.Name]=property.Value.DeepClone();receipt.Remove("error");
                if(previous!=null){Get(previous).Book.Close(SaveChanges:false);documents.Remove(previous);}
                book.Saved=true;book.Activate();return (JObject)receipt.DeepClone();
            }catch(OfficeFault){throw;}catch{throw new OfficeFault("document_open_uncertain");}finally{app.GetType().InvokeMember("AutomationSecurity",BindingFlags.SetProperty,null,app,new[]{security});app.EnableEvents=events;}
        }
        public JObject Read(string id, bool includeStyle = false)
        {
            var e=Get(id);if(e.Book.Worksheets.Count!=e.Specs.Count||e.Book.Date1904)throw new OfficeFault("cells_changed");var sheets=new JArray();var fingerprintParts=new JArray();
            foreach(JObject spec in e.Specs){
                var name=(string)spec["name"]!;Excel.Worksheet sheet;
                try {sheet=(Excel.Worksheet)e.Book.Worksheets[name];}catch{throw new OfficeFault("document_closed");}
                var area=Region.Parse((string)spec["address"]!);var wanted=new HashSet<string>(((JArray)spec["cells"]!).Select(c=>(string)c["address"]!));var cells=new JArray();var full=new JArray();
                for(var r=1;r<=area.Rows;r++)for(var c=1;c<=area.Columns;c++){
                    var cell=(Excel.Range)sheet.Cells[r,c];var value=cell.Value2;var formula=Convert.ToBoolean(cell.HasFormula)?Convert.ToString(cell.Formula):null;
                    var error=value is ErrorWrapper||(value is int code&&code< -2146800000);
                    var item=new JObject{["address"]=Region.Cell(r,c),["value"]=value==null?JValue.CreateNull():error?new JValue("#EXCEL_ERROR"):JToken.FromObject(value),["formula"]=formula,["displayText"]=Convert.ToString(cell.Text),["error"]=error};
                    var observed=(JObject)item.DeepClone();
                    var f=new JObject();foreach(var key in CellStyle.Fields)f[key]=Style(cell,key);
                    item["style"]=f;item["rowHeight"]=Convert.ToDouble(cell.RowHeight);item["columnWidth"]=Convert.ToDouble(cell.ColumnWidth);item["merge"]=Convert.ToBoolean(cell.MergeCells)?cell.MergeArea.get_Address(false,false,Excel.XlReferenceStyle.xlA1):null;item["hiddenRow"]=Convert.ToBoolean(cell.EntireRow.Hidden);item["hiddenColumn"]=Convert.ToBoolean(cell.EntireColumn.Hidden);full.Add(item);
                    if(includeStyle){observed["style"]=f.DeepClone();observed["merge"]=item["merge"]?.DeepClone();observed["rowHeight"]=item["rowHeight"]?.DeepClone();observed["columnWidth"]=item["columnWidth"]?.DeepClone();}
                    if(includeStyle||value!=null||formula!=null||wanted.Contains(Region.Cell(r,c)))cells.Add(observed);
                }
                bool layout=true;var layoutIssues=new JArray();
                void CompareLayout(bool match,string address,string field,JToken? expected,JToken? actual){layout&=match;if(!match&&layoutIssues.Count<80)layoutIssues.Add(new JObject{["address"]=address,["field"]=field,["expected"]=expected?.DeepClone(),["actual"]=actual?.DeepClone()});}
                foreach(JObject f in (JArray)spec["formats"]!){var a=Region.Parse((string)f["address"]!);foreach(var p in ((JObject)f["style"]!).Properties())for(var r=a.Row;r<a.Row+a.Rows;r++)for(var c=a.Column;c<a.Column+a.Columns;c++){var cell=(Excel.Range)sheet.Cells[r,c];CompareLayout(Equal(Style(cell,p.Name),p.Value),Region.Cell(r,c),p.Name,p.Value,Style(cell,p.Name));}}
                foreach(JObject c in (JArray)spec["cells"]!)if(c["numberFormat"]!=null){var cell=sheet.get_Range((string)c["address"]!);var later=((JArray)spec["formats"]!).OfType<JObject>().LastOrDefault(f=>f["style"]?["numberFormat"]!=null&&Region.Parse((string)f["address"]!).Contains(Region.Parse((string)c["address"]!)));var expected=later?["style"]?["numberFormat"]??c["numberFormat"]!;CompareLayout(Equal(Style(cell,"numberFormat"),expected),(string)c["address"]!,"numberFormat",expected,Style(cell,"numberFormat"));}
                foreach(var m in (JArray)spec["merges"]!){var range=sheet.get_Range((string)m!);var first=(Excel.Range)range.Cells[1,1];var actualMerge=Convert.ToBoolean(first.MergeCells)?first.MergeArea.get_Address(false,false,Excel.XlReferenceStyle.xlA1):"";CompareLayout(actualMerge!=""&&Region.Parse(actualMerge).Address==Region.Parse((string)m!).Address,(string)m!,"merge",m,actualMerge);}
                foreach(var w in (JArray)spec["columnWidths"]!){var actual=Convert.ToDouble(((Excel.Range)sheet.Columns[(int)w["index"]!]).ColumnWidth);CompareLayout(Math.Abs(actual-(double)w["size"]!)<0.2,Region.Cell(1,(int)w["index"]!),"columnWidth",w["size"],actual);}
                foreach(var h in (JArray)spec["rowHeights"]!){var actual=Convert.ToDouble(((Excel.Range)sheet.Rows[(int)h["index"]!]).RowHeight);CompareLayout(Math.Abs(actual-(double)h["size"]!)<0.8,Region.Cell((int)h["index"]!,1),"rowHeight",h["size"],actual);}
                foreach(var border in (JArray)spec["borders"]!){var a=Region.Parse((string)border["address"]!);for(var r=a.Row;r<a.Row+a.Rows;r++)for(var c=a.Column;c<a.Column+a.Columns;c++){var cell=(Excel.Range)sheet.Cells[r,c];if(Convert.ToBoolean(cell.MergeCells))cell=cell.MergeArea;foreach(var side in new[]{Excel.XlBordersIndex.xlEdgeTop,Excel.XlBordersIndex.xlEdgeBottom,Excel.XlBordersIndex.xlEdgeLeft,Excel.XlBordersIndex.xlEdgeRight}){var edge=cell.Borders[side];CompareLayout(Convert.ToInt32(edge.LineStyle)==(int)Excel.XlLineStyle.xlContinuous&&ColorHex(edge.Color)==(string?)border["color"],Region.Cell(r,c),side.ToString(),border["color"],ColorHex(edge.Color));}}}
                var print=sheet.PageSetup;layout&=Equals(print.Zoom,false)&&print.Orientation==((string?)spec["page"]?["orientation"]=="landscape"?Excel.XlPageOrientation.xlLandscape:Excel.XlPageOrientation.xlPortrait)&&Convert.ToInt32(print.FitToPagesWide)==1&&Convert.ToInt32(print.FitToPagesTall)==0&&print.PaperSize==Excel.XlPaperSize.xlPaperA4;
                var printArea=print.PrintArea.Split('!').Last().Replace("$","");CompareLayout(Region.Parse(printArea).Address==area.Address,area.Address,"printArea",area.Address,printArea);if(!layout&&layoutIssues.Count==0)layoutIssues.Add(new JObject{["field"]="printSetup",["actual"]=print.Orientation.ToString()});
                fingerprintParts.Add(new JObject{["name"]=sheet.Name,["cells"]=full,["printArea"]=print.PrintArea,["orientation"]=(int)print.Orientation,["layoutVerified"]=layout,["usedRange"]=sheet.UsedRange.get_Address(false,false,Excel.XlReferenceStyle.xlA1)});
                sheets.Add(new JObject{["name"]=name,["cells"]=cells,["layoutVerified"]=layout,["layoutIssues"]=layoutIssues});
            }
            var result=new JObject{["documentId"]=id,["sheets"]=sheets,["fingerprint"]=SheetState.Hash(fingerprintParts.ToString(Formatting.None)),["calculated"]=e.Calculated&&app.CalculationState==Excel.XlCalculationState.xlDone};
            if(result.ToString(Formatting.None).Length>190000)throw new OfficeFault("evidence_limit");return result;
        }
        public JObject Save(string id,string fingerprint,string title)
        {
            var e=Get(id);if(e.Saved)throw new OfficeFault("document_already_saved");if(!e.Book.Saved)throw new OfficeFault("cells_changed");if((string?)Read(id)["fingerprint"]!=fingerprint)throw new OfficeFault("cells_changed");
            var name=Regex.Replace(title,@"[\\/:*?""<>|\x00-\x1f]","_").Trim().TrimEnd('.');if(name.Length==0)name="문서";if(name.Length>60)name=name.Substring(0,60);
            var dir=saveDirectory;Directory.CreateDirectory(dir);var path=Path.Combine(dir,name+"-"+Guid.NewGuid().ToString("N")+".xlsx");
            e.Saved=true;e.SavePath=path;e.SaveFingerprint=fingerprint; // Record before SaveAs; reconcile lost replies by reading, never replay.
            try {e.Book.SaveAs(path,Excel.XlFileFormat.xlOpenXMLWorkbook,AddToMru:true);return SavedReceipt(id,e);}
            catch{throw new OfficeFault("document_save_uncertain");}
        }
        // Used only by the evaluation host, never exposed as a product tool.
        public JObject ReopenSavedForEvaluation(string id)
        {
            var e=Get(id);if(!e.Saved||e.SavePath==null)throw new OfficeFault("document_not_saved");
            SavedReceipt(id,e);e.Book.Close(SaveChanges:false);
            e.Book=app.Workbooks.Open(e.SavePath,UpdateLinks:0,ReadOnly:true,AddToMru:false);
            for(var pass=0;pass<e.Specs.Count;pass++)foreach(Excel.Worksheet sheet in e.Book.Worksheets)sheet.Calculate();
            e.Calculated=app.CalculationState==Excel.XlCalculationState.xlDone;
            foreach(Excel.Worksheet sheet in e.Book.Worksheets)if(sheet.CircularReference!=null)e.Calculated=false;
            return Read(id,includeStyle:true);
        }
        private JObject SavedReceipt(string id,Entry e)
        {
            var path=e.SavePath;if(path==null||!e.Book.Saved||!String.Equals(e.Book.FullName,path,StringComparison.OrdinalIgnoreCase)||!File.Exists(path)||(string?)Read(id)["fingerprint"]!=e.SaveFingerprint)throw new OfficeFault("document_save_uncertain");
            var hash=Hash(path);if(e.SaveReceipt!=null&&(string?)e.SaveReceipt["sha256"]!=hash)throw new OfficeFault("cells_changed");
            e.SaveReceipt=new JObject{["saved"]=true,["documentId"]=id,["path"]=path,["sha256"]=hash,["bytes"]=new FileInfo(path).Length};return (JObject)e.SaveReceipt.DeepClone();
        }
        // This endpoint never opens, closes, recalculates, or writes a workbook.
        // The UI/STA queue orders it after a timed-out native operation.
        public JObject Reconcile(JObject payload)
        {
            var operation=(string?)payload["operation"];
            if(operation=="document_open"){
                var fileName=(string?)payload["fileName"]??"";
                if(!opened.TryGetValue(fileName,out var receipt))return new JObject{["outcome"]="not_started"};
                if((string?)receipt["sourceHash"]!=(string?)payload["sha256"])throw new OfficeFault("operation_collision");
                if(receipt["error"]!=null)return new JObject{["outcome"]="uncertain"};
                var id=(string)receipt["documentId"]!;var fresh=Read(id);
                if(!Get(id).Book.Saved||(string?)fresh["fingerprint"]!=(string?)receipt["fingerprint"])throw new OfficeFault("cells_changed");
                return new JObject{["outcome"]="complete",["result"]=fresh};
            }
            if(operation=="document_save"){
                var id=(string?)payload["documentId"]??"";var e=Get(id);
                if(!e.Saved)return new JObject{["outcome"]="not_started"};
                if((string?)payload["expectedFingerprint"]!=e.SaveFingerprint)throw new OfficeFault("cells_changed");
                try{return new JObject{["outcome"]="complete",["result"]=SavedReceipt(id,e)};}
                catch(OfficeFault fault) when(fault.Message=="document_save_uncertain"){return new JObject{["outcome"]="uncertain"};}
            }
            throw new OfficeFault("unsupported_operation");
        }
        public IntPtr ViewWindow(string id,string? sheet,string? address,bool focus)
        {
            var entry=Get(id);if(focus){entry.Book.Activate();var target=(Excel.Worksheet)(sheet!=null?entry.Book.Worksheets[sheet]:entry.Book.ActiveSheet);target.Activate();if(address!=null){var region=Region.Parse(address);if((long)region.Rows*region.Columns>1000)throw new OfficeFault("range_limit");app.Goto(target.get_Range(region.Address),true);}}
            if(!OfficeView.SameCom(app.ActiveWorkbook,entry.Book))throw new OfficeFault("view_window_changed");
            return new IntPtr(app.ActiveWindow.Hwnd);
        }
        public void Focus(string id){Get(id).Book.Activate();}
        private static bool Equal(JToken? a,JToken? b){if(a==null||b==null)return a==b;if((a.Type==JTokenType.Float||a.Type==JTokenType.Integer)&&(b.Type==JTokenType.Float||b.Type==JTokenType.Integer))return Math.Abs((double)a-(double)b)<0.01;if(a.Type==JTokenType.String&&b.Type==JTokenType.String)return CanonicalFormat(a.ToString())==CanonicalFormat(b.ToString());return JToken.DeepEquals(a,b);}
        private static string CanonicalFormat(string value)=>Regex.Replace(value,"\"([^\\x00-\\x7f\"]+)\"","$1");
        private static string ColorHex(object value){var c=ColorTranslator.FromOle(Convert.ToInt32(value));return $"#{c.R:X2}{c.G:X2}{c.B:X2}";}
        private static JToken Style(Excel.Range cell,string key){switch(key){
            case "bold":return Convert.ToBoolean(cell.Font.Bold);case "italic":return Convert.ToBoolean(cell.Font.Italic);case "fontName":return Convert.ToString(cell.Font.Name)!;case "fontSize":return Convert.ToDouble(cell.Font.Size);case "fontColor":return ColorHex(cell.Font.Color);case "fillColor":return Convert.ToInt32(cell.Interior.Pattern)==(int)Excel.XlPattern.xlPatternNone?JValue.CreateNull():new JValue(ColorHex(cell.Interior.Color));case "numberFormat":return CanonicalFormat(Convert.ToString(cell.NumberFormat)!);case "wrapText":return Convert.ToBoolean(cell.WrapText);case "horizontalAlignment":var h=Convert.ToInt32(cell.HorizontalAlignment);return new Dictionary<int,string>{{1,"general"},{-4131,"left"},{-4108,"center"},{-4152,"right"},{5,"fill"},{-4130,"justify"},{7,"centerAcrossSelection"},{-4117,"distributed"}}.TryGetValue(h,out var hv)?hv:"unsupported";case "verticalAlignment":var v=Convert.ToInt32(cell.VerticalAlignment);return new Dictionary<int,string>{{-4160,"top"},{-4108,"center"},{-4107,"bottom"},{-4130,"justify"},{-4117,"distributed"}}.TryGetValue(v,out var vv)?vv:"unsupported";default:throw new OfficeFault("invalid_format");}}
    }
}

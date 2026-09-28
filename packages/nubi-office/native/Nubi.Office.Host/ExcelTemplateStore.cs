using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;
using System.Xml;
using System.Xml.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Excel = Microsoft.Office.Interop.Excel;

namespace Nubi.Office.Host
{
    public sealed partial class ExcelPort
    {
        private readonly System.Collections.Generic.Dictionary<string,JObject> catalogCandidates=new System.Collections.Generic.Dictionary<string,JObject>();
        private const string TemplateNamespace = "urn:nubi:office:template:1";
        private static object Member(object value, string name, BindingFlags flags, params object[] args) => value.GetType().InvokeMember(name, flags | BindingFlags.OptionalParamBinding, null, value, args)!;
        private static object Parts(Excel.Workbook book) => Member(book, "CustomXMLParts", BindingFlags.GetProperty);
        private static object MatchingParts(Excel.Workbook book) => Member(Parts(book), "SelectByNamespace", BindingFlags.InvokeMethod, TemplateNamespace);
        private static JObject ReadTemplateRecord(Excel.Workbook book)
        {
            var parts = MatchingParts(book); if (Convert.ToInt32(Member(parts, "Count", BindingFlags.GetProperty)) != 1) throw new OfficeFault("template_record_invalid");
            var part = Member(parts, "Item", BindingFlags.GetProperty, 1); var xml = Convert.ToString(Member(part, "XML", BindingFlags.GetProperty)) ?? "";
            if (xml.Length > 160000) throw new OfficeFault("template_record_invalid");
            using (var input = new StringReader(xml)) using (var reader = XmlReader.Create(input, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
            {
                var root = XElement.Load(reader); var data = root.Element(XName.Get("record", TemplateNamespace));
                if (root.Name != XName.Get("template", TemplateNamespace) || (string?)data?.Attribute("encoding") != "base64") throw new OfficeFault("template_record_invalid");
                var json = Encoding.UTF8.GetString(Convert.FromBase64String(data!.Value)); if (json.Length > 30000) throw new OfficeFault("template_record_invalid");
                var record = JObject.Parse(json); ValidateTemplateRecord(record); return record;
            }
        }
        private static void ValidateTemplateRecord(JObject record)
        {
            if ((int?)record["schemaVersion"] != 1 || !Regex.IsMatch((string?)record["id"] ?? "", "^[a-f0-9-]{36}$") || record.ToString(Newtonsoft.Json.Formatting.None).Length > 30000) throw new OfficeFault("template_record_invalid");
            var profile = record["profile"] as JObject ?? throw new OfficeFault("template_record_invalid");
            var range = Region.Parse((string?)profile["address"] ?? "");
            if ((long)range.Rows * range.Columns > 1000 || string.IsNullOrWhiteSpace((string?)profile["worksheet"]) || profile["fields"] is not JArray fields || fields.Count < 1 || fields.Count > 30) throw new OfficeFault("template_record_invalid");
        }
        private static void WriteTemplateRecord(Excel.Workbook book, JObject record)
        {
            var matches = MatchingParts(book); var count = Convert.ToInt32(Member(matches, "Count", BindingFlags.GetProperty));
            for (var i = count; i > 0; i--) Member(Member(matches, "Item", BindingFlags.GetProperty, i), "Delete", BindingFlags.InvokeMethod);
            var data = Convert.ToBase64String(Encoding.UTF8.GetBytes(record.ToString(Newtonsoft.Json.Formatting.None)));
            var xml = new XElement(XName.Get("template", TemplateNamespace), new XElement(XName.Get("record", TemplateNamespace), new XAttribute("encoding", "base64"), data)).ToString(SaveOptions.DisableFormatting);
            Member(Parts(book), "Add", BindingFlags.InvokeMethod, xml, Type.Missing);
        }
        private string? Destination(string title)
        {
            using (var dialog = new SaveFileDialog { Title = title, Filter = "Excel 통합 문서 (*.xlsx)|*.xlsx", DefaultExt = "xlsx", AddExtension = true, OverwritePrompt = true })
            {
                if (dialog.ShowDialog() != DialogResult.OK) return null;
                var path = Path.GetFullPath(dialog.FileName);
                if (!path.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase) || File.Exists(path)) throw new OfficeFault("template_destination_exists");
                foreach (Excel.Workbook open in app.Workbooks) if (string.Equals(open.FullName, path, StringComparison.OrdinalIgnoreCase)) throw new OfficeFault("template_destination_exists");
                return path;
            }
        }
        private object DisableAutomaticMacros() {var security = Member(app, "AutomationSecurity", BindingFlags.GetProperty); Member(app, "AutomationSecurity", BindingFlags.SetProperty, 3); return security;}
        private void CheckTemplateHost() {if (!app.Ready || !app.EnableEvents) throw new OfficeFault("template_excel_not_ready");}
        private static void CheckTemplateFormat(Excel.Workbook book) {if (book.FileFormat != Excel.XlFileFormat.xlOpenXMLWorkbook) throw new OfficeFault("template_format_unsupported");}
        private SheetState ReadTemplateScope(Excel.Workbook book, JObject record)
        {
            var sheet = (Excel.Worksheet)book.Worksheets[(string)record["profile"]!["worksheet"]!];
            var state = new SheetState {DocumentId = Guid.NewGuid().ToString("N"), SheetId = Guid.NewGuid().ToString("N"), Address = (string)record["profile"]!["address"]!};
            var key = state.DocumentId + ":" + state.SheetId; identities.Add(key, (Identity(book), Identity(sheet)));
            try {return Read(state);} finally {identities.Remove(key);}
        }

        // Excel owns every document byte. Do not use File.Copy, ZIP readers,
        // plaintext JSON sidecars, or suppress Excel/NASCA save/open events.
        public JObject RegisterTemplate(SheetState source, JObject record)
        {
            CheckTemplateHost(); ValidateTemplateRecord(record); var pair = Resolve(source); CheckTemplateFormat(pair.book);
            if ((string?)record["profile"]?["worksheet"] != source.Worksheet || (string?)record["profile"]?["address"] != source.Address) throw new OfficeFault("template_record_invalid");
            var path = Destination("분석한 양식을 새 파일로 등록"); if (path == null) return new JObject { ["cancelled"] = true };
            if (Read(source).Fingerprint() != source.Fingerprint()) throw new OfficeFault("cells_changed");
            Excel.Workbook? copy = null; var security = DisableAutomaticMacros();
            try
            {
                if (File.Exists(path)) throw new OfficeFault("template_destination_exists");
                pair.book.SaveCopyAs(path);
                copy = app.Workbooks.Open(path, UpdateLinks: 0, ReadOnly: false, AddToMru: false, IgnoreReadOnlyRecommended: true);
                WriteTemplateRecord(copy, record); copy.Save(); copy.Close(SaveChanges: false); copy = null;
                // Reopen through the authorized Excel process to check persistence.
                copy = app.Workbooks.Open(path, UpdateLinks: 0, ReadOnly: true, AddToMru: false, IgnoreReadOnlyRecommended: true);
                if (!JToken.DeepEquals(ReadTemplateRecord(copy), record)) throw new OfficeFault("template_save_uncertain");
                if (Read(source).Fingerprint() != source.Fingerprint()) throw new OfficeFault("cells_changed");
                catalogCandidates[(string)record["id"]!]=new JObject{["path"]=path,["record"]=record.DeepClone()};
                return new JObject { ["saved"] = true, ["id"] = record["id"], ["path"] = path, ["metadataVerified"] = true, ["comparison"] = new JObject { ["before"] = WorkbookEngine.Describe(source), ["after"] = WorkbookEngine.Describe(ReadTemplateScope(copy, record)) }, ["protectionMode"] = "nasca_excel_managed", ["nascaEncryptionVerified"] = false };
            }
            catch (OfficeFault) { throw; } catch { throw new OfficeFault("template_save_uncertain"); }
            finally {try {copy?.Close(SaveChanges: false);} finally {Member(app, "AutomationSecurity", BindingFlags.SetProperty, security); pair.book.Activate(); pair.sheet.Activate();}}
        }
        public JObject IndexTemplate(string id)
        {
            if(!catalogCandidates.TryGetValue(id,out var candidate))throw new OfficeFault("template_not_found");
            var record=(JObject)candidate["record"]!;
            var entry=TemplateCatalog.Add("excel",id,(string)record["name"]!, (string)record["purpose"]!, (string)candidate["path"]!,
                new JObject{["record"]=record.DeepClone()}, ((JArray)record["profile"]!["fields"]!).Count,((JArray)record["profile"]!["fields"]!).Count);
            return new JObject{["catalogued"]=true,["id"]=id,["entry"]=entry};
        }
        public JObject OpenTemplateCopy(string? catalogId=null)
        {
            CheckTemplateHost(); string sourcePath;
            JObject? catalogRecord=catalogId==null?null:TemplateCatalog.Read("excel",catalogId);
            if(catalogRecord!=null){sourcePath=(string)catalogRecord["path"]!;if(!File.Exists(sourcePath))throw new OfficeFault("template_file_missing");}
            else using (var dialog = new OpenFileDialog { Title = "등록한 양식 선택", Filter = "Excel 통합 문서 (*.xlsx)|*.xlsx", CheckFileExists = true })
            {if (dialog.ShowDialog() != DialogResult.OK) return new JObject { ["cancelled"] = true }; sourcePath = Path.GetFullPath(dialog.FileName);}
            // An already-open template may have unsaved edits. Do not close it or
            // silently reinterpret those edits as a registered template version.
            foreach (Excel.Workbook open in app.Workbooks) if (string.Equals(open.FullName, sourcePath, StringComparison.OrdinalIgnoreCase)) throw new OfficeFault("template_already_open");
            Excel.Workbook? source = null; Excel.Workbook? copy = null; var security = DisableAutomaticMacros();
            try
            {
                source = app.Workbooks.Open(sourcePath, UpdateLinks: 0, ReadOnly: true, AddToMru: false, IgnoreReadOnlyRecommended: true); CheckTemplateFormat(source);
                var record = ReadTemplateRecord(source);
                if(catalogRecord!=null&&!JToken.DeepEquals(catalogRecord["snapshot"]?["record"],record))throw new OfficeFault("template_source_changed");
                var before = ReadTemplateScope(source, record); var path = Destination("양식을 복사할 새 문서 위치"); if (path == null) return new JObject { ["cancelled"] = true };
                if (File.Exists(path)) throw new OfficeFault("template_destination_exists");
                source.SaveCopyAs(path); source.Close(SaveChanges: false); source = null;
                copy = app.Workbooks.Open(path, UpdateLinks: 0, ReadOnly: false, AddToMru: false, IgnoreReadOnlyRecommended: true);
                if (!JToken.DeepEquals(ReadTemplateRecord(copy), record)) throw new OfficeFault("template_record_invalid");
                var sheet = (Excel.Worksheet)copy.Worksheets[(string)record["profile"]!["worksheet"]!];
                copy.Activate(); sheet.Activate(); sheet.get_Range((string)record["profile"]!["address"]!).Select();
                // The caller captures a NEW scope bound to this copy, never the source.
                var result = new JObject { ["copied"] = true, ["record"] = record, ["path"] = path, ["comparison"] = new JObject { ["before"] = WorkbookEngine.Describe(before), ["after"] = WorkbookEngine.Describe(ReadTemplateScope(copy, record)) }, ["protectionMode"] = "nasca_excel_managed", ["nascaEncryptionVerified"] = false };
                if(catalogRecord!=null)result["entry"]=TemplateCatalog.Public(catalogRecord);
                copy = null; return result;
            }
            catch (OfficeFault) {throw;} catch {throw new OfficeFault("template_open_failed");}
            finally {try {source?.Close(SaveChanges: false); copy?.Close(SaveChanges: false);} finally {Member(app, "AutomationSecurity", BindingFlags.SetProperty, security);}}
        }
    }
}

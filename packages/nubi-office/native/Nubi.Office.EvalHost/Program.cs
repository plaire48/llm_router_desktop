using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Nubi.Office.Host;
using Excel = Microsoft.Office.Interop.Excel;

// Evaluation-only host: a PRIVATE Excel instance and generated fixture books.
// Production ExcelPort + WorkbookEngine are used without simulated COM fallback.
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        Excel.Application? app = null; Excel.Workbook? book = null; Excel.Worksheet? sheet = null; ExcelPort? port = null;
        WorkbookEngine? engine = null; DocumentPort? documents = null; string selection = "A1:B2", auditRange = "A1:F10";
        JArray sourceDefinitions = new JArray();
        JArray AuditSources()
        {
            var snapshots = new JArray();
            foreach (var definition in sourceDefinitions) {
                var sourceSheet = (Excel.Worksheet)book!.Worksheets[(string)definition["name"]!];
                sourceSheet.Activate(); sourceSheet.get_Range((string)definition["auditRange"]!).Select();
                snapshots.Add(engine!.Selection());
            }
            sheet!.Activate();sheet.get_Range(selection).Select();return snapshots;
        }
        try
        {
            string? line;
            while ((line = Console.ReadLine()) != null)
            {
                var request = JObject.Parse(line); var p = (JObject?)request["payload"] ?? new JObject();
                try
                {
                    JToken result;
                    switch ((string?)request["method"])
                    {
                        case "init":
                            if (app == null) {app = new Excel.Application {Visible = false, DisplayAlerts = false, AskToUpdateLinks = false}; port = new ExcelPort(app);}
                            for(var index=app.Workbooks.Count;index>0;index--)app.Workbooks[index].Close(false);
                            book=null;sheet=null;engine=null;
                            var evaluationDirectory=Path.GetFullPath((string)p["evaluationDirectory"]!);
                            Directory.CreateDirectory(evaluationDirectory);
                            documents=new DocumentPort(app,Path.Combine(evaluationDirectory,"drafts"),Path.Combine(evaluationDirectory,"saved"));
                            if((string?)p["mode"]=="document"){
                                result=new JObject{["host"]=new JObject{["evaluationProtocol"]=4,["platform"]="Windows",["excelVersion"]=app.Version,["excelBuild"]=app.Build.ToString(),["processBits"]=IntPtr.Size*8,["excel2016EditionVerified"]=false}};
                                break;
                            }
                            book = app.Workbooks.Add(); sheet = (Excel.Worksheet)book.Worksheets[1]; sheet.Name = "CaseSheet";
                            selection = (string)p["range"]!; auditRange = (string)p["auditRange"]!;
                            foreach (var entry in ((JObject)p["cells"]!).Properties())
                            {
                                var cell = sheet.get_Range(entry.Name); var data = (JObject)entry.Value;
                                if (data["formula"] != null) cell.Formula = (string)data["formula"]!;
                                else if (data["value"] is JValue value) cell.Value2 = value.Type == JTokenType.String ? "'" + (string)value! : value.Value;
                                if (data["bold"] != null) cell.Font.Bold = (bool)data["bold"]!;
                                if (data["numberFormat"] != null) cell.NumberFormat = (string)data["numberFormat"]!;
                            }
                            sourceDefinitions = p["sourceSheets"] is JArray sources ? (JArray)sources.DeepClone() : new JArray();
                            foreach (var definition in sourceDefinitions) {
                                var sourceSheet = (Excel.Worksheet)book.Worksheets.Add(After: book.Worksheets[book.Worksheets.Count]);
                                sourceSheet.Name = (string)definition["name"]!;
                                foreach (var entry in ((JObject)definition["cells"]!).Properties()) {
                                    var cell = sourceSheet.get_Range(entry.Name); var data = (JObject)entry.Value;
                                    if (data["formula"] != null) cell.Formula = (string)data["formula"]!;
                                    else if (data["value"] is JValue value) cell.Value2 = value.Type == JTokenType.String ? "'" + (string)value! : value.Value;
                                    if (data["numberFormat"] != null) cell.NumberFormat = (string)data["numberFormat"]!;
                                }
                            }
                            foreach(var merge in p["merges"] as JArray??new JArray())sheet.get_Range((string)merge!).Merge();
                            app.CalculateFullRebuild(); engine = new WorkbookEngine(port!);sheet.Activate();
                            sheet.get_Range(auditRange).Select(); var before = engine.Selection();
                            sheet.get_Range(selection).Select();
                            result = new JObject { ["scope"] = engine.Selection(), ["before"] = before, ["sourcesBefore"] = AuditSources(),
                                ["host"] = new JObject { ["evaluationProtocol"] = 4, ["platform"] = "Windows", ["excelVersion"] = app.Version, ["excelBuild"] = app.Build.ToString(), ["processBits"] = IntPtr.Size * 8,
                                    ["excel2016EditionVerified"] = false, ["note"] = "Version 16.0 alone does not establish the Office edition or VSTO installation." }};
                            break;
                        case "document_open": result=documents!.Open(p);break;
                        case "document_read": result=documents!.Read((string)p["documentId"]!);break;
                        case "document_audit": result=documents!.Read((string)p["documentId"]!,includeStyle:true);break;
                        case "document_save": result=documents!.Save((string)p["documentId"]!,(string)p["expectedFingerprint"]!,(string)p["title"]!);break;
                        case "document_reconcile": result=documents!.Reconcile(p);break;
                        case "document_reopen": result=documents!.ReopenSavedForEvaluation((string)p["documentId"]!);break;
                        case "read": result = engine!.Read((string)p["scopeId"]!); break;
                        case "workbook_sheets": result = engine!.ListSheets((string)p["scopeId"]!, (int?)p["offset"] ?? 0); break;
                        case "workbook_structure": result = engine!.InspectSheet((string)p["scopeId"]!, (string)p["sheetId"]!, (string)p["part"]!, (int?)p["offset"] ?? 0); break;
                        case "workbook_range": result = engine!.ReadWorkbookRange((string)p["scopeId"]!, (string)p["sheetId"]!, (string)p["address"]!); break;
                        case "apply": result = engine!.Apply((string)p["scopeId"]!, (string)p["operationId"]!, (JObject)p["plan"]!); break;
                        case "reconcile": result = engine!.Reconcile((string)p["scopeId"]!, (string)p["operationId"]!, (JObject)p["plan"]!); break;
                        case "restore": result = engine!.Restore((string)p["changeId"]!); break;
                        case "history": result = engine!.History(); break;
                        case "audit": sheet!.get_Range(auditRange).Select(); result = engine!.Selection(); sheet.get_Range(selection).Select(); break;
                        case "auditSources": result = AuditSources(); break;
                        case "saveReopen":
                            var path = Path.GetFullPath((string)p["path"]!);
                            if (Path.GetExtension(path) != ".xlsx" || File.Exists(path)) throw new OfficeFault("invalid_artifact_path");
                            app!.CalculateFullRebuild(); book!.SaveAs(path, Excel.XlFileFormat.xlOpenXMLWorkbook); book.Close(false);
                            book = app.Workbooks.Open(path, UpdateLinks: 0, ReadOnly: true); sheet = (Excel.Worksheet)book.Worksheets[1]; sheet.get_Range(auditRange).Select();
                            result = engine!.Selection(); break;
                        default: throw new OfficeFault("unknown_method");
                    }
                    Console.WriteLine(new JObject { ["id"] = request["id"], ["ok"] = true, ["result"] = result }.ToString(Formatting.None));
                }
                catch (Exception error)
                {
                    Console.WriteLine(new JObject { ["id"] = request["id"], ["ok"] = false,
                        ["error"] = error is OfficeFault fault ? fault.Code : app == null ? "excel_unavailable" : "excel_evaluation_failed" }.ToString(Formatting.None));
                }
            }
        }
        finally
        {
            port?.Dispose(); try {book?.Close(false);} catch { }
            try {app?.Quit();} catch { }
            if (sheet != null) Marshal.FinalReleaseComObject(sheet);
            if (book != null) Marshal.FinalReleaseComObject(book);
            if (app != null) Marshal.FinalReleaseComObject(app);
        }
    }
}

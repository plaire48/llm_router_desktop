using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Excel = Microsoft.Office.Interop.Excel;

namespace Nubi.Office.Host
{
    // Excel 2016 COM only. NubiPane dispatches every call on Excel's UI/STA.
    // Detached JSON can be analyzed concurrently; COM objects never leave here.
    public sealed partial class ExcelPort
    {
        private readonly Dictionary<string, (long workbook, long sheet)> readSheets = new Dictionary<string, (long, long)>();
        private const int PageSize = 20;
        private string ReadId(Excel.Workbook book, Excel.Worksheet sheet)
        {
            var bookId = Identity(book); var sheetId = Identity(sheet);
            var existing = readSheets.FirstOrDefault(p => p.Value.workbook == bookId && p.Value.sheet == sheetId).Key;
            if (existing != null) return existing;
            if (readSheets.Count >= 1024) throw new OfficeFault("session_limit");
            var id = Guid.NewGuid().ToString("N"); readSheets.Add(id, (bookId, sheetId)); return id;
        }
        private Excel.Worksheet ReadSheet(SheetState anchor, string sheetId)
        {
            var book = Resolve(anchor).book;
            if (!readSheets.TryGetValue(sheetId, out var identity) || identity.workbook != Identity(book)) throw new OfficeFault("out_of_scope");
            foreach (Excel.Worksheet sheet in book.Worksheets) if (Identity(sheet) == identity.sheet) return sheet;
            throw new OfficeFault("document_closed");
        }
        private static JObject Page(JArray items, int offset, int count) => new JObject {
            ["items"] = items, ["offset"] = offset, ["total"] = count,
            ["nextOffset"] = offset + items.Count < count ? new JValue(offset + items.Count) : JValue.CreateNull()
        };
        private static void CheckOffset(int offset) { if (offset < 0 || offset > 100000) throw new OfficeFault("invalid_request"); }
        public JObject ListSheets(SheetState anchor, int offset)
        {
            CheckOffset(offset); var book = Resolve(anchor).book; var items = new JArray(); var count = book.Worksheets.Count;
            for (var i = offset + 1; i <= Math.Min(count, offset + PageSize); i++)
            {
                var sheet = (Excel.Worksheet)book.Worksheets[i];
                items.Add(new JObject { ["sheetId"] = ReadId(book, sheet), ["name"] = sheet.Name,
                    ["visibility"] = sheet.Visible.ToString(), ["protected"] = sheet.ProtectContents });
            }
            var result = Page(items, offset, count); result["kind"] = "worksheet_catalog";
            result["documentId"] = anchor.DocumentId; result["workbook"] = book.Name;
            result["readOnly"] = book.ReadOnly; result["date1904"] = book.Date1904;
            result["calculationState"] = app.CalculationState.ToString();
            return result;
        }
        public JObject InspectSheet(SheetState anchor, string sheetId, string part, int offset)
        {
            CheckOffset(offset); var sheet = ReadSheet(anchor, sheetId); var items = new JArray(); int count;
            switch (part)
            {
                case "tables":
                    var tables = sheet.ListObjects; count = tables.Count;
                    for (var i = offset + 1; i <= Math.Min(count, offset + PageSize); i++) {
                        var table = (Excel.ListObject)tables[i]; items.Add(new JObject { ["name"] = table.Name,
                            ["address"] = table.Range.get_Address(false, false, Excel.XlReferenceStyle.xlA1),
                            ["showHeaders"] = table.ShowHeaders, ["showTotals"] = table.ShowTotals });
                    }
                    break;
                case "charts":
                    var charts = (Excel.ChartObjects)sheet.ChartObjects(Type.Missing); count = charts.Count;
                    for (var i = offset + 1; i <= Math.Min(count, offset + PageSize); i++) {
                        var chart = (Excel.ChartObject)charts.Item(i); items.Add(new JObject { ["name"] = chart.Name,
                            ["chartType"] = chart.Chart.ChartType.ToString(), ["anchor"] = chart.TopLeftCell.get_Address(false, false, Excel.XlReferenceStyle.xlA1) });
                    }
                    break;
                case "pivots":
                    var pivots = (Excel.PivotTables)sheet.PivotTables(Type.Missing); count = pivots.Count;
                    for (var i = offset + 1; i <= Math.Min(count, offset + PageSize); i++) {
                        var pivot = (Excel.PivotTable)pivots.Item(i); items.Add(new JObject { ["name"] = pivot.Name,
                            ["address"] = pivot.TableRange2.get_Address(false, false, Excel.XlReferenceStyle.xlA1) });
                    }
                    break;
                case "names":
                    // Includes workbook and sheet scoped names. Never evaluate
                    // RefersTo: it may refer to another file or an external source.
                    var names = Resolve(anchor).book.Names; count = names.Count;
                    for (var i = offset + 1; i <= Math.Min(count, offset + PageSize); i++) {
                        var name = (Excel.Name)names.Item(i); items.Add(new JObject { ["name"] = name.Name, ["refersTo"] = Convert.ToString(name.RefersTo), ["visible"] = name.Visible });
                    }
                    break;
                case "layout":
                    count = 1;
                    if (offset == 0) items.Add(new JObject {
                        ["usedRangeHint"] = sheet.UsedRange.get_Address(false, false, Excel.XlReferenceStyle.xlA1),
                        ["printArea"] = sheet.PageSetup.PrintArea, ["orientation"] = sheet.PageSetup.Orientation.ToString(),
                        ["autoFilterMode"] = sheet.AutoFilterMode, ["filterMode"] = sheet.FilterMode,
                        ["hint"] = "UsedRange may include formatted empty cells. Read explicit bounded ranges; this is not a full cell scan."
                    });
                    break;
                default: throw new OfficeFault("unsupported_operation");
            }
            var result = Page(items, offset, count); result["kind"] = "worksheet_structure";
            result["documentId"] = anchor.DocumentId; result["sheetId"] = sheetId; result["worksheet"] = sheet.Name;
            result["part"] = part; return result;
        }
        public SheetState ReadRange(SheetState anchor, string sheetId, string address)
        {
            var area = Region.Parse(address); if ((long)area.Rows * area.Columns > 1000) throw new OfficeFault("range_limit");
            var sheet = ReadSheet(anchor, sheetId); var identity = readSheets[sheetId];
            var target = new SheetState { DocumentId = anchor.DocumentId, SheetId = sheetId,
                Workbook = anchor.Workbook, Worksheet = sheet.Name, Address = area.Address };
            // Reuse the existing Excel 2016 reader without granting a write scope.
            var key = target.DocumentId + ":" + sheetId;
            var hadPrevious = identities.TryGetValue(key, out var previous);
            identities[key] = identity;
            try { return Read(target); }
            finally { if (hadPrevious) identities[key] = previous; else identities.Remove(key); }
        }
    }
}

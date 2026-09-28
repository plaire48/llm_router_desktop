using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Runtime.InteropServices;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;
using Excel = Microsoft.Office.Interop.Excel;
using Region = Nubi.Office.Core.Region;

namespace Nubi.Office.Host
{
    // All entry points are called by NubiPane on Excel's UI/STA thread.
    public sealed partial class ExcelPort : IWorkbookPort, IWorkbookReadPort, IDisposable
    {
        private readonly Excel.Application app;
        private readonly Dictionary<string, (long workbook, long sheet)> identities = new Dictionary<string, (long, long)>();
        public ExcelPort(Excel.Application application) { app = application; app.WorkbookBeforeClose += OnClosing; app.SheetBeforeDelete += OnDeleting; }
        private void OnClosing(Excel.Workbook book, ref bool cancel) { var id = Identity(book); foreach (var key in identities.Where(p => p.Value.workbook == id).Select(p => p.Key).ToArray()) identities.Remove(key); foreach (var key in readSheets.Where(p => p.Value.workbook == id).Select(p => p.Key).ToArray()) readSheets.Remove(key); }
        private void OnDeleting(object sheet) {var id = Identity(sheet); foreach (var key in identities.Where(p => p.Value.sheet == id).Select(p => p.Key).ToArray()) identities.Remove(key);foreach (var key in readSheets.Where(p => p.Value.sheet == id).Select(p => p.Key).ToArray()) readSheets.Remove(key);}
        public void Dispose() {app.WorkbookBeforeClose -= OnClosing; app.SheetBeforeDelete -= OnDeleting; identities.Clear();readSheets.Clear();}
        private static long Identity(object value) { var ptr = Marshal.GetIUnknownForObject(value); try {return ptr.ToInt64();} finally {Marshal.Release(ptr);} }
        private (Excel.Workbook book, Excel.Worksheet sheet) Resolve(SheetState target)
        {
            if (!identities.TryGetValue(target.DocumentId + ":" + target.SheetId, out var ids)) throw new OfficeFault("document_closed");
            foreach (Excel.Workbook book in app.Workbooks)
                if (Identity(book) == ids.workbook)
                    foreach (Excel.Worksheet sheet in book.Worksheets)
                        if (Identity(sheet) == ids.sheet) return (book, sheet);
            throw new OfficeFault("document_closed");
        }
        public SheetState CaptureSelection()
        {
            var selected = app.Selection as Excel.Range ?? throw new OfficeFault("select_cells");
            if (selected.Areas.Count != 1) throw new OfficeFault("single_range_required");
            var sheet = (Excel.Worksheet)selected.Worksheet; var book = (Excel.Workbook)sheet.Parent;
            var state = new SheetState {DocumentId = Guid.NewGuid().ToString("N"), SheetId = Guid.NewGuid().ToString("N"), Workbook = book.Name, Worksheet = sheet.Name,
                Address = selected.get_Address(false, false, Excel.XlReferenceStyle.xlA1)};
            var bookIdentity = Identity(book); var sheetIdentity = Identity(sheet);
            var existing = identities.FirstOrDefault(p => p.Value.workbook == bookIdentity && p.Value.sheet == sheetIdentity).Key;
            if (existing != null) {var parts = existing.Split(':'); state.DocumentId = parts[0]; state.SheetId = parts[1];}
            else {
                if (identities.Count >= 32) identities.Remove(identities.Keys.First());
                identities.Add(state.DocumentId + ":" + state.SheetId, (bookIdentity, sheetIdentity));
            }
            return Read(state);
        }
        public SheetState Read(SheetState target)
        {
            var pair = Resolve(target); var region = Region.Parse(target.Address);
            if ((long)region.Rows * region.Columns > 1000) throw new OfficeFault("range_limit");
            var range = pair.sheet.get_Range(region.Address); var values = range.Value2; var formulas = range.Formula;
            object? Item(object data, int row, int col) => data is Array array ? array.GetValue(row + 1, col + 1) : data;
            var rows = new JArray();
            for (var r = 0; r < region.Rows; r++)
            {
                var columns = new JArray();
                for (var c = 0; c < region.Columns; c++)
                {
                    var cell = (Excel.Range)range.Cells[r + 1, c + 1]; var value = Item(values, r, c); var formula = Item(formulas, r, c) as string;
                    var invalid = value is ErrorWrapper || (value is int errorCode && errorCode < -2146800000);
                    var fill = cell.Interior; var font = cell.Font;
                    columns.Add(new JObject { ["value"] = value == null ? JValue.CreateNull() : invalid ? new JValue("#EXCEL_ERROR") : JToken.FromObject(value),
                        ["formula"] = Convert.ToBoolean(cell.HasFormula) && formula != null ? new JValue(formula) : JValue.CreateNull(), ["error"] = invalid,
                        ["bold"] = Convert.ToBoolean(font.Bold), ["italic"] = Convert.ToBoolean(font.Italic),
                        ["fontName"] = Convert.ToString(font.Name), ["fontSize"] = Convert.ToDouble(font.Size), ["fontColor"] = HexColor(Convert.ToInt32(font.Color)),
                        ["fillColor"] = Convert.ToInt32(fill.Pattern) == (int)Excel.XlPattern.xlPatternNone ? JValue.CreateNull() : new JValue(HexColor(Convert.ToInt32(fill.Color))),
                        ["numberFormat"] = Convert.ToString(cell.NumberFormat), ["wrapText"] = Convert.ToBoolean(cell.WrapText),
                        ["horizontalAlignment"] = AlignmentName(Horizontal, cell.HorizontalAlignment), ["verticalAlignment"] = AlignmentName(Vertical, cell.VerticalAlignment),
                        ["displayText"] = Convert.ToString(cell.Text), ["locked"] = Convert.ToBoolean(cell.Locked),
                        ["mergedAddress"] = Convert.ToBoolean(cell.MergeCells) ? new JValue(cell.MergeArea.get_Address(false, false, Excel.XlReferenceStyle.xlA1)) : JValue.CreateNull(),
                        ["arrayFormula"] = Convert.ToBoolean(cell.HasArray), ["hiddenRow"] = Convert.ToBoolean(cell.EntireRow.Hidden), ["hiddenColumn"] = Convert.ToBoolean(cell.EntireColumn.Hidden),
                        ["rowHeight"] = Convert.ToDouble(cell.RowHeight), ["columnWidth"] = Convert.ToDouble(cell.ColumnWidth) });
                    var metadata = (JObject)columns.Last!;
                    var borders = new JObject();
                    foreach (var edge in new[] { Excel.XlBordersIndex.xlEdgeLeft, Excel.XlBordersIndex.xlEdgeTop, Excel.XlBordersIndex.xlEdgeRight, Excel.XlBordersIndex.xlEdgeBottom, Excel.XlBordersIndex.xlDiagonalDown, Excel.XlBordersIndex.xlDiagonalUp })
                    {
                        var border = (Excel.Border)cell.Borders[edge]; var style = Convert.ToInt32(border.LineStyle);
                        if (style != (int)Excel.XlLineStyle.xlLineStyleNone) borders[edge.ToString()] = new JObject { ["style"] = style, ["weight"] = Convert.ToDouble(border.Weight), ["color"] = Convert.ToInt32(border.Color) };
                    }
                    metadata["borders"] = borders;
                    ReadValidation(cell, metadata);
                }
                rows.Add(columns);
            }
            return new SheetState {DocumentId = target.DocumentId, SheetId = target.SheetId, Workbook = pair.book.Name, Worksheet = pair.sheet.Name, Address = region.Address, Date1904 = pair.book.Date1904, ReadOnly = pair.book.ReadOnly, Protected = pair.sheet.ProtectContents, Cells = rows};
        }
        public void Write(SheetState target, IReadOnlyList<CellPatch> patches)
        {
            var pair = Resolve(target); var area = Region.Parse(target.Address); var range = pair.sheet.get_Range(area.Address);
            if (pair.book.ReadOnly || pair.sheet.ProtectContents || !app.Ready) throw new OfficeFault("workbook_not_writable");
            // Recheck live target metadata, including merge anchors, before mutation.
            var live = Read(target);
            foreach (var patch in patches)
            {
                WorkbookEngine.ValidateTarget(live, area.Row + patch.Row, area.Column + patch.Column, patch.Field);
            }
            var events = app.EnableEvents; var screen = app.ScreenUpdating;
            // Value/font/wrap changes can auto-grow rows. Preserve the template's row geometry.
            var heights = patches.Select(p => p.Row).Distinct().ToDictionary(row => row, row => Convert.ToDouble(((Excel.Range)range.Rows[row + 1]).RowHeight));
            try
            {
                app.EnableEvents = false; app.ScreenUpdating = false;
                foreach (var patch in patches)
                {
                    var cell = (Excel.Range)range.Cells[patch.Row + 1, patch.Column + 1];
                    switch (patch.Field)
                    {
                        case "value": cell.Value2 = patch.Value.Type == JTokenType.Null ? null : patch.Value.Type == JTokenType.String ? "'" + patch.Value.ToString() : ((JValue)patch.Value).Value; break;
                        case "formula": cell.Formula = patch.Value.ToString(); break;
                        case "bold": cell.Font.Bold = (bool)patch.Value; break;
                        case "italic": cell.Font.Italic = (bool)patch.Value; break;
                        case "fontName": cell.Font.Name = patch.Value.ToString(); break;
                        case "fontSize": cell.Font.Size = (double)patch.Value; break;
                        case "fontColor": cell.Font.Color = ColorTranslator.ToOle(ColorTranslator.FromHtml(patch.Value.ToString())); break;
                        case "horizontalAlignment": cell.HorizontalAlignment = Horizontal[patch.Value.ToString()]; break;
                        case "verticalAlignment": cell.VerticalAlignment = Vertical[patch.Value.ToString()]; break;
                        case "wrapText": cell.WrapText = (bool)patch.Value; break;
                        case "fillColor": if (patch.Value.Type == JTokenType.Null) cell.Interior.Pattern = Excel.XlPattern.xlPatternNone; else cell.Interior.Color = ColorTranslator.ToOle(ColorTranslator.FromHtml(patch.Value.ToString())); break;
                        case "numberFormat": cell.NumberFormat = patch.Value.ToString(); break;
                        default: throw new OfficeFault("unsupported_operation");
                    }
                }
                range.Calculate();
            }
            finally {try {foreach (var height in heights) ((Excel.Range)range.Rows[height.Key + 1]).RowHeight = height.Value;} finally {app.EnableEvents = events; app.ScreenUpdating = screen;}}
        }
        public IntPtr ViewWindow(SheetState target,string? address,bool focus)
        {
            var pair=Resolve(target);var region=Region.Parse(address??target.Address);var allowed=Region.Parse(target.Address);
            if(region.Row<allowed.Row||region.Column<allowed.Column||region.Row+region.Rows>allowed.Row+allowed.Rows||region.Column+region.Columns>allowed.Column+allowed.Columns)throw new OfficeFault("out_of_scope");
            if(focus){pair.book.Activate();pair.sheet.Activate();app.Goto(pair.sheet.get_Range(region.Address),true);}
            if(!OfficeView.SameCom(app.ActiveWorkbook,pair.book)||!OfficeView.SameCom(app.ActiveSheet,pair.sheet))throw new OfficeFault("view_window_changed");
            return new IntPtr(app.ActiveWindow.Hwnd);
        }
        public void Focus(SheetState target) { var pair = Resolve(target); pair.book.Activate(); pair.sheet.Activate(); pair.sheet.get_Range(target.Address).Select(); }
        private static string HexColor(int ole) {var c = ColorTranslator.FromOle(ole); return $"#{c.R:X2}{c.G:X2}{c.B:X2}";}
        private static readonly Dictionary<string, int> Horizontal = new Dictionary<string, int> { ["general"] = 1, ["left"] = -4131, ["center"] = -4108, ["right"] = -4152, ["fill"] = 5, ["justify"] = -4130, ["centerAcrossSelection"] = 7, ["distributed"] = -4117 };
        private static readonly Dictionary<string, int> Vertical = new Dictionary<string, int> { ["top"] = -4160, ["center"] = -4108, ["bottom"] = -4107, ["justify"] = -4130, ["distributed"] = -4117 };
        private static string AlignmentName(Dictionary<string, int> map, object value) => map.FirstOrDefault(pair => pair.Value == Convert.ToInt32(value)).Key ?? "unsupported";
        private static void ReadValidation(Excel.Range cell, JObject data)
        {
            data["validation"] = null; data["validationValid"] = null;
            Excel.Validation rule;
            int type;
            try {rule = cell.Validation; type = rule.Type;}
            catch (COMException error) when ((uint)error.ErrorCode == 0x800A03EC) {return;}
            try
            {
                var description = new JObject { ["type"] = type, ["ignoreBlank"] = rule.IgnoreBlank };
                if (type != 0) description["formula1"] = rule.Formula1;
                if (type != 0 && type != 3 && type != 7)
                {
                    description["operator"] = rule.Operator;
                    if (rule.Operator == (int)Excel.XlFormatConditionOperator.xlBetween || rule.Operator == (int)Excel.XlFormatConditionOperator.xlNotBetween) description["formula2"] = rule.Formula2;
                }
                if (type == 3) { description["inCellDropdown"] = rule.InCellDropdown; description["listSeparator"] = Convert.ToString(cell.Application.International[Excel.XlApplicationInternational.xlListSeparator]); }
                data["validation"] = description; data["validationValid"] = rule.Value;
            }
            catch (COMException) {data["validation"] = new JObject { ["type"] = type, ["status"] = "unreadable" };}
        }
    }
}

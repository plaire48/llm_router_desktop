using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Nubi.Office.Core
{
    public sealed class OfficeFault : Exception
    {
        public string Code { get; }
        public OfficeFault(string code) : base(code) { Code = code; }
    }

    public sealed class Region
    {
        public int Row, Column, Rows, Columns;
        public string Address => Cell(Row, Column) + ":" + Cell(Row + Rows - 1, Column + Columns - 1);
        public static Region Parse(string text)
        {
            var m = Regex.Match(text ?? "", @"^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})(?::\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6}))?$", RegexOptions.IgnoreCase);
            if (!m.Success) throw new OfficeFault("invalid_range");
            int Col(string s) { var n = 0; foreach (var c in s.ToUpperInvariant()) n = n * 26 + c - 'A' + 1; return n; }
            var row = int.Parse(m.Groups[2].Value); var col = Col(m.Groups[1].Value);
            var endRow = m.Groups[4].Success ? int.Parse(m.Groups[4].Value) : row;
            var endCol = m.Groups[3].Success ? Col(m.Groups[3].Value) : col;
            if (endRow < row || endCol < col || endRow > 1048576 || endCol > 16384) throw new OfficeFault("invalid_range");
            return new Region { Row = row, Column = col, Rows = endRow - row + 1, Columns = endCol - col + 1 };
        }
        public bool Contains(Region other) => other.Row >= Row && other.Column >= Column && other.Row + other.Rows <= Row + Rows && other.Column + other.Columns <= Column + Columns;
        public static string Cell(int row, int col) { var letters = ""; while (col > 0) { col--; letters = (char)('A' + col % 26) + letters; col /= 26; } return letters + row; }
    }

    // Pure data only; no COM references cross into the agent or recovery ledger.
    public sealed class SheetState
    {
        public string DocumentId { get; set; } = "";
        public string SheetId { get; set; } = "";
        public string Workbook { get; set; } = "";
        public string Worksheet { get; set; } = "";
        public string Address { get; set; } = "";
        public bool Date1904 { get; set; }
        public bool ReadOnly { get; set; }
        public bool Protected { get; set; }
        public JArray Cells { get; set; } = new JArray();
        public SheetState Clone() => JsonConvert.DeserializeObject<SheetState>(JsonConvert.SerializeObject(this))!;
        public string Fingerprint() => Hash(DocumentId + "|" + SheetId + "|" + Address + "|" + Date1904 + "|" + ReadOnly + "|" + Protected + "|" + Cells.ToString(Formatting.None));
        public static string Hash(string value) { using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(Encoding.UTF8.GetBytes(value))); }
    }

    public interface IWorkbookPort
    {
        SheetState CaptureSelection();
        SheetState Read(SheetState target);
        void Write(SheetState target, IReadOnlyList<CellPatch> patches);
        void Focus(SheetState target);
    }
    // Read capabilities are separate from the mutation port. A discovered sheet
    // never becomes an editable scope merely because an agent read it.
    public interface IWorkbookReadPort
    {
        JObject ListSheets(SheetState anchor, int offset);
        JObject InspectSheet(SheetState anchor, string sheetId, string part, int offset);
        SheetState ReadRange(SheetState anchor, string sheetId, string address);
    }
    public sealed class CellPatch
    {
        public int Row { get; set; }
        public int Column { get; set; }
        public string Field { get; set; } = "";
        public JToken Value { get; set; } = JValue.CreateNull();
    }
    public sealed class Change
    {
        public string Id = "", ScopeId = "";
        public SheetState Before = new SheetState(), After = new SheetState();
        public List<CellPatch> Patches = new List<CellPatch>();
        public bool Restored, Partial;
        public bool Recoverable = true;
    }

    public sealed class WorkbookEngine
    {
        private static readonly string[] LayoutFields = { "locked", "mergedAddress", "arrayFormula", "validation", "rowHeight", "columnWidth", "hiddenRow", "hiddenColumn", "borders" };
        private readonly IWorkbookPort port;
        private readonly Dictionary<string, SheetState> scopes = new Dictionary<string, SheetState>();
        private readonly Dictionary<string, (string signature, JObject result)> ledger = new Dictionary<string, (string, JObject)>();
        private readonly Dictionary<string, Change> attempts = new Dictionary<string, Change>();
        private readonly List<Change> changes = new List<Change>();
        private readonly object gate = new object();
        public WorkbookEngine(IWorkbookPort port) { this.port = port; }
        public JObject Selection()
        {
            lock (gate)
            {
                var state = port.CaptureSelection(); ValidateState(state);
                if (scopes.Count >= 32) scopes.Remove(scopes.Keys.First());
                var id = Guid.NewGuid().ToString("N"); scopes.Add(id, state);
                return PublicState(id, state);
            }
        }
        private SheetState Scope(string id) { if (!scopes.TryGetValue(id, out var state)) throw new OfficeFault("scope_expired"); return state; }
        public JObject Read(string id) { lock (gate) { var live = port.Read(Scope(id)); ValidateState(live); return PublicState(id, live); } }
        public SheetState BoundState(string id, string fingerprint) { lock (gate) {var live = port.Read(Scope(id)); ValidateState(live); if (live.Fingerprint() != fingerprint) throw new OfficeFault("cells_changed"); return live.Clone();} }
        public static JObject Describe(SheetState state) {ValidateState(state); return PublicState("", state);}
        private IWorkbookReadPort Reader() => port as IWorkbookReadPort ?? throw new OfficeFault("workbook_read_unavailable");
        public JObject ListSheets(string id, int offset)
        {
            lock (gate) { var result = Reader().ListSheets(Scope(id), offset); result["sourceScopeId"] = id; return result; }
        }
        public JObject InspectSheet(string id, string sheetId, string part, int offset)
        {
            lock (gate) { var result = Reader().InspectSheet(Scope(id), sheetId, part, offset); result["sourceScopeId"] = id; return result; }
        }
        public JObject ReadWorkbookRange(string id, string sheetId, string address)
        {
            lock (gate)
            {
                var live = Reader().ReadRange(Scope(id), sheetId, address); ValidateState(live);
                var result = PublicState("", live); result.Remove("scopeId");
                result["sourceScopeId"] = id; result["sheetId"] = sheetId; result["readOnly"] = true; result["kind"] = "workbook_range";
                return result;
            }
        }
        private void CheckSources(string scopeId, JObject plan)
        {
            if (plan["sourceDependencies"] == null) return;
            if (!(plan["sourceDependencies"] is JArray sources) || sources.Count > 8) throw new OfficeFault("invalid_plan");
            foreach (var source in sources)
            {
                if (!(source is JObject item) || item.Count != 3 || item["sheetId"]?.Type != JTokenType.String || item["address"]?.Type != JTokenType.String || item["fingerprint"]?.Type != JTokenType.String) throw new OfficeFault("invalid_plan");
                var current = ReadWorkbookRange(scopeId, (string)item["sheetId"]!, (string)item["address"]!);
                if ((string?)current["fingerprint"] != (string?)item["fingerprint"]) throw new OfficeFault("source_changed");
            }
        }
        public void Focus(string id) { lock (gate) port.Focus(Scope(id)); }
        public JObject Apply(string scopeId, string operationId, JObject plan)
        {
            lock (gate)
            {
                if (operationId == null || !Regex.IsMatch(operationId, @"^[a-zA-Z0-9_-]{1,100}$")) throw new OfficeFault("invalid_operation_id");
                var signature = SheetState.Hash(scopeId + plan.ToString(Formatting.None));
                if (ledger.TryGetValue(operationId, out var old))
                {
                    if (old.signature != signature) throw new OfficeFault("operation_collision");
                    return (JObject)old.result.DeepClone();
                }
                if (ledger.Count >= 500) throw new OfficeFault("session_limit");
                var before = Scope(scopeId); var live = port.Read(before); ValidateState(live);
                if (live.Fingerprint() != before.Fingerprint()) throw new OfficeFault("cells_changed");
                CheckSources(scopeId, plan);
                var patches = Compile(before, plan); var expected = ApplyTo(before, patches); ValidateState(expected);
                if (patches.Count == 0) return new JObject { ["applied"] = false, ["changedCells"] = 0 };
                var change = new Change { Id = operationId, ScopeId = scopeId, Before = before.Clone(), Patches = patches };
                // Register the request BEFORE touching Excel; uncertain writes must never be retried.
                var result = new JObject { ["applied"] = false, ["error"] = "write_uncertain", ["changeId"] = operationId, ["recoverable"] = false };
                ledger.Add(operationId, (signature, result));
                attempts[operationId] = change;
                try
                {
                    port.Write(before, patches);
                    change.After = port.Read(before); ValidateState(change.After);
                    Verify(expected, change.After, patches);
                    result["applied"] = true; result.Remove("error");
                }
                catch (Exception failure)
                {
                    change.Partial = true;
                    if (failure is OfficeFault reason) result["cause"] = reason.Code;
                    try { change.After = port.Read(before); ValidateState(change.After); }
                    catch { return (JObject)result.DeepClone(); }
                    if (change.After.Fingerprint() == before.Fingerprint())
                    {
                        result["error"] = failure is OfficeFault fault ? fault.Code : "write_failed";
                        result["changedCells"] = 0;
                        return (JObject)result.DeepClone();
                    }
                    result["error"] = "partial_change";
                    // Include unintended changes in the guarded recovery record.
                    // Unchanged formulas may recalculate; their cached values are not edits.
                    for (var r = 0; r < before.Cells.Count; r++) for (var c = 0; c < before.Cells[r]!.Count(); c++)
                    {
                        var original = before.Cells[r]![c]!; var observed = change.After.Cells[r]![c]!;
                        foreach (var field in new[] { "value", "formula" }.Concat(CellStyle.Fields))
                        {
                            if (field == "value" && (original["formula"]?.Type == JTokenType.String || observed["formula"]?.Type == JTokenType.String)) continue;
                            if (Equivalent(original[field], observed[field])) continue;
                            var valueField = field == "value" || field == "formula";
                            if (change.Patches.Any(p => p.Row == r && p.Column == c && (p.Field == field || valueField && (p.Field == "value" || p.Field == "formula")))) continue;
                            change.Patches.Add(new CellPatch { Row = r, Column = c, Field = field, Value = observed[field]!.DeepClone() });
                        }
                    }
                }
                for (var r = 0; r < before.Cells.Count; r++) for (var c = 0; c < before.Cells[r]!.Count(); c++)
                    if (LayoutFields.Any(field => !Equivalent(before.Cells[r]![c]![field], change.After.Cells[r]![c]![field]))) change.Recoverable = false;
                changes.Add(change);
                if (changes.Count > 20) changes.RemoveAt(0);
                scopes[scopeId] = change.After.Clone();
                result["recoverable"] = change.Recoverable;
                result["changedCells"] = patches.Select(p => p.Row + ":" + p.Column).Distinct().Count();
                result["preview"] = Preview(change);
                result["snapshot"] = PublicState(scopeId, change.After);
                return (JObject)result.DeepClone();
            }
        }
        public JObject Reconcile(string scopeId,string operationId,JObject plan)
        {
            lock(gate)
            {
                if(!ledger.TryGetValue(operationId,out var receipt))return new JObject{["outcome"]="not_started"};
                if(receipt.signature!=SheetState.Hash(scopeId+plan.ToString(Formatting.None)))throw new OfficeFault("operation_collision");
                var attempt=attempts[operationId];var live=port.Read(attempt.Before);ValidateState(live);
                if((bool?)receipt.result["applied"]==true){
                    if((string?)receipt.result["snapshot"]?["fingerprint"]!=live.Fingerprint())throw new OfficeFault("cells_changed");
                    return new JObject{["outcome"]="complete",["result"]=receipt.result.DeepClone()};
                }
                // Readback can fail after every requested field was written. Verify
                // the entire original contract before converting it into a receipt.
                var patches=Compile(attempt.Before,plan);var expected=ApplyTo(attempt.Before,patches);
                try{
                    Verify(expected,live,patches);attempt.After=live.Clone();attempt.Partial=false;
                    if(!changes.Contains(attempt)){changes.Add(attempt);if(changes.Count>20)changes.RemoveAt(0);}
                    scopes[scopeId]=live.Clone();receipt.result["applied"]=true;receipt.result.Remove("error");receipt.result["recoverable"]=true;receipt.result["snapshot"]=PublicState(scopeId,live);
                    return new JObject{["outcome"]="complete",["result"]=receipt.result.DeepClone()};
                }catch(OfficeFault){
                    if((string?)receipt.result["error"]=="partial_change"&&(bool?)receipt.result["recoverable"]==true){
                        if(attempt.After.Fingerprint()!=live.Fingerprint())throw new OfficeFault("cells_changed");
                        return new JObject{["outcome"]="partial",["result"]=receipt.result.DeepClone()};
                    }
                    return new JObject{["outcome"]="uncertain"};
                }
            }
        }
        public JObject Restore(string id)
        {
            lock (gate)
            {
                var change = changes.FirstOrDefault(c => c.Id == id) ?? throw new OfficeFault("recovery_expired");
                if (change.Restored) return new JObject { ["restored"] = true, ["changeId"] = id };
                if (!change.Recoverable) throw new OfficeFault("unsupported_recovery");
                var live = port.Read(change.After);
                if (live.Fingerprint() != change.After.Fingerprint()) throw new OfficeFault("recovery_conflict");
                var reverse = change.Patches.Select(p => new CellPatch { Row = p.Row, Column = p.Column,
                    Field = p.Field == "value" || p.Field == "formula" ? (change.Before.Cells[p.Row]![p.Column]!["formula"]!.Type == JTokenType.String ? "formula" : "value") : p.Field,
                    Value = (change.Before.Cells[p.Row]![p.Column]![p.Field == "value" || p.Field == "formula" ? (change.Before.Cells[p.Row]![p.Column]!["formula"]!.Type == JTokenType.String ? "formula" : "value") : p.Field] ?? JValue.CreateNull()).DeepClone() }).ToList();
                try { port.Write(change.Before, reverse); var after = port.Read(change.Before); ValidateState(after); Verify(change.Before, after, reverse, true); scopes[change.ScopeId] = after; }
                catch { throw new OfficeFault("recovery_uncertain"); }
                change.Restored = true;
                return new JObject { ["restored"] = true, ["changeId"] = id };
            }
        }
        public JArray History() { lock (gate) return new JArray(changes.AsEnumerable().Reverse().Select(c => new JObject {
            ["id"] = c.Id, ["scopeId"] = c.ScopeId, ["workbook"] = c.Before.Workbook, ["worksheet"] = c.Before.Worksheet,
            ["address"] = c.Before.Address, ["restored"] = c.Restored, ["partial"] = c.Partial, ["recoverable"] = c.Recoverable, ["preview"] = Preview(c), ["previewTotal"] = c.Patches.Count })); }
        private static void ValidateState(SheetState s)
        {
            var r = Region.Parse(s.Address);
            if ((long)r.Rows * r.Columns > 1000 || s.Cells.Count != r.Rows || s.Cells.Any(row => row is not JArray a || a.Count != r.Columns)) throw new OfficeFault("range_limit");
            if (s.Cells.ToString(Formatting.None).Length > 120000) throw new OfficeFault("range_limit");
        }
        private static JObject PublicState(string id, SheetState s) => new JObject { ["scopeId"] = id, ["documentId"] = s.DocumentId,
            ["worksheet"] = s.Worksheet, ["workbook"] = s.Workbook, ["address"] = s.Address, ["date1904"] = s.Date1904, ["readOnly"] = s.ReadOnly, ["protected"] = s.Protected,
            ["values"] = new JArray(s.Cells.Select(row => new JArray(row.Select(c => c["value"])))),
            ["formulas"] = new JArray(s.Cells.Select(row => new JArray(row.Select(c => c["formula"])))),
            ["errors"] = new JArray(s.Cells.Select(row => new JArray(row.Select(c => c["error"])))),
            ["displayTexts"] = Grid(s, "displayText"),
            ["formats"] = new JObject(CellStyle.Fields.Select(field => new JProperty(field, Grid(s, field)))),
            ["properties"] = new JObject(LayoutFields.Concat(new[] { "validationValid" }).Select(field => new JProperty(field, Grid(s, field)))),
            ["fingerprint"] = s.Fingerprint() };
        private static JArray Grid(SheetState s, string field) => new JArray(s.Cells.Select(row => new JArray(row.Select(c => c[field]?.DeepClone() ?? JValue.CreateNull()))));
        private static JArray Preview(Change c) => new JArray(c.Patches.Take(60).Select(p => new JObject {
            ["cell"] = Region.Cell(Region.Parse(c.Before.Address).Row + p.Row, Region.Parse(c.Before.Address).Column + p.Column),
            ["field"] = p.Field, ["before"] = PreviewValue(c.Before.Cells[p.Row]![p.Column]![p.Field]), ["after"] = PreviewValue(c.After.Cells[p.Row]![p.Column]![p.Field]) }));
        private static JToken? PreviewValue(JToken? value) => value?.Type == JTokenType.String && value.ToString().Length > 512 ? new JValue(value.ToString().Substring(0, 512) + "…") : value?.DeepClone();
        private static List<CellPatch> Compile(SheetState state, JObject plan)
        {
            if (plan["operations"] is not JArray operations || operations.Count > 30 || plan.Properties().Any(p => p.Name != "operations" && p.Name != "answer" && p.Name != "sourceDependencies")) throw new OfficeFault("invalid_plan");
            var scope = Region.Parse(state.Address); var patches = new List<CellPatch>(); var occupied = new HashSet<string>();
            foreach (var token in operations)
            {
                if (token is not JObject op) throw new OfficeFault("invalid_plan");
                var type = (string?)op["type"]; var area = Region.Parse((string?)op["address"] ?? "");
                if (!scope.Contains(area)) throw new OfficeFault("out_of_scope");
                var allowed = type == "set_values" ? new[] { "type", "address", "values" } : type == "set_formulas" ? new[] { "type", "address", "formulas" } : type == "format_range" ? new[] { "type", "address" }.Concat(CellStyle.Fields).ToArray() : throw new OfficeFault("unsupported_operation");
                if (op.Properties().Any(p => !allowed.Contains(p.Name))) throw new OfficeFault("invalid_plan");
                var grid = type == "set_values" ? op["values"] : type == "set_formulas" ? op["formulas"] : null;
                if (type != "format_range" && (grid is not JArray a || a.Count != area.Rows || a.Any(row => row is not JArray b || b.Count != area.Columns))) throw new OfficeFault("invalid_grid");
                for (var r = 0; r < area.Rows; r++) for (var col = 0; col < area.Columns; col++)
                {
                    void Add(string field, JToken value)
                    {
                        var original = state.Cells[area.Row + r - scope.Row]![area.Column + col - scope.Column]!;
                        ValidateTarget(state, area.Row + r, area.Column + col, field);
                        if ((field == "value" || field == "formula") && (bool?)original["error"] == true && original["formula"]?.Type != JTokenType.String) throw new OfficeFault("unsupported_target");
                        if ((field == "value" || field == "formula") && original["validation"] is JObject rule && (string?)rule["status"] == "unreadable") throw new OfficeFault("validation_unavailable");
                        var key = (area.Row + r) + ":" + (area.Column + col) + ":" + (field == "formula" ? "value" : field);
                        if (!occupied.Add(key)) throw new OfficeFault("overlapping_operations");
                        patches.Add(new CellPatch { Row = area.Row + r - scope.Row, Column = area.Column + col - scope.Column, Field = field, Value = value.DeepClone() });
                    }
                    if (type == "set_values")
                    {
                        var value = grid![r]![col]!;
                        if (!new[] { JTokenType.Null, JTokenType.String, JTokenType.Integer, JTokenType.Float, JTokenType.Boolean }.Contains(value.Type) || (value.Type == JTokenType.String && (value.ToString().Length > 10000 || Regex.IsMatch(value.ToString(), @"^\s*[=+@]")))) throw new OfficeFault("invalid_value");
                        Add("value", value);
                    }
                    else if (type == "set_formulas")
                    {
                        var value = grid![r]![col]!; var f = value.Type == JTokenType.String ? value.ToString() : "";
                        if (!f.StartsWith("=") || f.Length > 2000 || Regex.IsMatch(f, @"[\[\]|]|(?:WEBSERVICE|HYPERLINK|RTD|DDE|CALL|REGISTER|XLOOKUP|FILTER|UNIQUE|LET|LAMBDA|SEQUENCE)\s*\(", RegexOptions.IgnoreCase)) throw new OfficeFault("unsupported_formula");
                        Add("formula", value);
                    }
                    else
                    {
                        foreach (var field in CellStyle.Fields)
                            if (op[field] != null) Add(field, CellStyle.Validate(field, op[field]!));
                    }
                }
            }
            return patches;
        }
        // A merged form input is one value at its top-left anchor. Never change
        // a follower, formula, style, or a merge extending outside the scope.
        public static void ValidateTarget(SheetState state, int row, int column, string field)
        {
            if (state.ReadOnly || state.Protected) throw new OfficeFault("workbook_not_writable");
            var scope = Region.Parse(state.Address); var original = state.Cells[row - scope.Row]![column - scope.Column]!;
            if ((bool?)original["arrayFormula"] == true || (bool?)original["hiddenRow"] == true || (bool?)original["hiddenColumn"] == true) throw new OfficeFault("unsupported_target");
            if (original["mergedAddress"]?.Type != JTokenType.String) return;
            var merge = Region.Parse((string)original["mergedAddress"]!);
            if (!scope.Contains(merge) || merge.Row != row || merge.Column != column || field != "value" || original["formula"]?.Type == JTokenType.String) throw new OfficeFault("unsupported_target");
        }
        private static SheetState ApplyTo(SheetState original, List<CellPatch> patches)
        {
            var state = original.Clone();
            foreach (var p in patches) { var cell = (JObject)state.Cells[p.Row]![p.Column]!; cell[p.Field] = p.Value.DeepClone(); if (p.Field == "value") cell["formula"] = null; }
            return state;
        }
        private static void Verify(SheetState expected, SheetState actual, IEnumerable<CellPatch> patches, bool restoring = false)
        {
            if (expected.DocumentId != actual.DocumentId || expected.SheetId != actual.SheetId || expected.Address != actual.Address || expected.Date1904 != actual.Date1904 || expected.ReadOnly != actual.ReadOnly || expected.Protected != actual.Protected) throw new OfficeFault("wrong_document");
            // Protect the whole bound range, including cells outside the patch.
            // Formula results may recalculate; formulas and other fields may not drift.
            for (var r = 0; r < expected.Cells.Count; r++) for (var c = 0; c < expected.Cells[r]!.Count(); c++)
            {
                var wanted = expected.Cells[r]![c]!; var observed = actual.Cells[r]![c]!;
                foreach (var field in new[] { "formula" }.Concat(LayoutFields).Concat(CellStyle.Fields))
                    if (!Equivalent(wanted[field], observed[field])) throw new OfficeFault("verification_failed");
                if (wanted["formula"]?.Type != JTokenType.String && !Equivalent(wanted["value"], observed["value"])) throw new OfficeFault("verification_failed");
                if ((bool?)observed["error"] == true && (bool?)wanted["error"] != true) throw new OfficeFault("verification_failed");
            }
            foreach (var p in patches)
            {
                var observed = actual.Cells[p.Row]![p.Column]!;
                var prior = expected.Cells[p.Row]![p.Column]!;
                if (!restoring && (p.Field == "value" || p.Field == "formula") && (bool?)observed["validationValid"] == false) throw new OfficeFault("validation_failed");
                if (!Equivalent(prior[p.Field], observed[p.Field]) || ((p.Field == "formula" || p.Field == "value") && (bool?)observed["error"] == true && !(restoring && (bool?)prior["error"] == true))) throw new OfficeFault("verification_failed");
            }
        }
        private static bool Equivalent(JToken? a, JToken? b)
        {
            bool Number(JToken? token) => token?.Type == JTokenType.Integer || token?.Type == JTokenType.Float;
            return Number(a) && Number(b) ? (double)a! == (double)b! : JToken.DeepEquals(a, b);
        }
    }
}

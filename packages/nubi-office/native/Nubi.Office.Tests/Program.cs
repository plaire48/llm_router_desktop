using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

if (args.Contains("--rpc"))
{
    var port = new FakePort(); var engine = new WorkbookEngine(port); string? line;
    while ((line = Console.ReadLine()) != null)
    {
        var request = JObject.Parse(line); var payload = (JObject?)request["payload"] ?? new JObject();
        try {
            JToken result = (string?)request["method"] switch {
                "selection" => engine.Selection(), "read" => engine.Read((string)payload["scopeId"]!),
                "apply" => engine.Apply((string)payload["scopeId"]!, (string)payload["operationId"]!, (JObject)payload["plan"]!),
                "reconcile" => engine.Reconcile((string)payload["scopeId"]!, (string)payload["operationId"]!, (JObject)payload["plan"]!),
                "restore" => engine.Restore((string)payload["changeId"]!), "history" => engine.History(),
                "focus" => new JObject { ["focused"] = true }, _ => throw new OfficeFault("unknown_method")
            };
            Console.WriteLine(new JObject { ["id"] = request["id"], ["ok"] = true, ["result"] = result }.ToString(Newtonsoft.Json.Formatting.None));
        } catch(Exception error) {Console.WriteLine(new JObject { ["id"] = request["id"], ["ok"] = false, ["error"] = error.Message }.ToString(Newtonsoft.Json.Formatting.None));}
    }
    return;
}

var tests = new Dictionary<string, Action>();
void Check(bool value, string message = "assertion failed") {if (!value) throw new Exception(message);}
void Fault(string code, Action action) {try {action(); throw new Exception("expected " + code);} catch (OfficeFault e) {Check(e.Code == code, e.Code);}}
(FakePort port, WorkbookEngine engine, string scope) Setup() {var port = new FakePort(); var engine = new WorkbookEngine(port); return (port, engine, engine.Selection()["scopeId"]!.ToString());}
JObject Plan(string operations) => JObject.Parse("{\"operations\":" + operations + "}");
var write = Plan("[{\"type\":\"set_values\",\"address\":\"A1\",\"values\":[[42]]}]");
tests["numeric writes verify against Excel doubles, replay is idempotent"] = () => {var (p,e,s)=Setup(); var first=e.Apply(s,"one",write); Check((bool)first["applied"]!); Check((int)e.Apply(s,"one",write)["changedCells"]! == 1); Check(p.Writes==1);};
tests["lost mutation reply is reconciled from receipt without a second write"] = () => {var(p,e,s)=Setup();e.Apply(s,"lost",write);var receipt=e.Reconcile(s,"lost",write);Check((string?)receipt["outcome"]=="complete");Check(p.Writes==1);p.State.Cells[0]![1]!["value"]=99;Fault("cells_changed",()=>e.Reconcile(s,"lost",write));};
tests["temporary readback loss is reconciled by full expected-state verification"] = () => {var(p,e,s)=Setup();p.LoseReadAfterWrite=true;var first=e.Apply(s,"lost",write);Check((string?)first["error"]=="write_uncertain");p.LoseReadAfterWrite=false;var receipt=e.Reconcile(s,"lost",write);Check((string?)receipt["outcome"]=="complete");Check(p.Writes==1);e.Restore("lost");Check((double)p.State.Cells[0]![0]!["value"]! == 1);};
tests["partial mutation receipt allows guarded restore but never claims complete"] = () => {var(p,e,s)=Setup();p.FailAfter=1;var plan=Plan("[{\"type\":\"set_values\",\"address\":\"A1:B1\",\"values\":[[40,50]]}]");e.Apply(s,"partial",plan);var r=e.Reconcile(s,"partial",plan);Check((string?)r["outcome"]=="partial");Check(p.Writes==1);p.FailAfter=0;e.Restore("partial");Check((double)p.State.Cells[0]![0]!["value"]! == 1);};
tests["operation ID collision cannot overwrite data"] = () => {var(p,e,s)=Setup(); e.Apply(s,"one",write); Fault("operation_collision",()=>e.Apply(s,"one",Plan("[]"))); Check(p.Writes==1);};
tests["direct user edits invalidate the pending plan"] = () => {var(p,e,s)=Setup(); p.State.Cells[0]![0]!["value"]=99; Fault("cells_changed",()=>e.Apply(s,"one",write)); Check(p.Writes==0);};
tests["scope bounds are enforced before mutation"] = () => {var(p,e,s)=Setup(); Fault("out_of_scope",()=>e.Apply(s,"one",Plan("[{\"type\":\"set_values\",\"address\":\"C1\",\"values\":[[1]]}]"))); Check(p.Writes==0);};
tests["closed documents never fall back to active workbook"] = () => {var(p,e,s)=Setup(); p.Closed=true; Fault("document_closed",()=>e.Apply(s,"one",write)); Check(p.Writes==0);};
tests["restore restores formulas and supported formatting"] = () => {var(p,e,s)=Setup(); var before=p.State.Clone(); var plan=Plan("[{\"type\":\"set_values\",\"address\":\"B2\",\"values\":[[5]]},{\"type\":\"format_range\",\"address\":\"B2\",\"bold\":true,\"fillColor\":\"#AA00FF\",\"numberFormat\":\"0.00\"}]"); Check((bool)e.Apply(s,"one",plan)["applied"]!); e.Restore("one"); Check(JToken.DeepEquals(before.Cells,p.State.Cells)); e.Restore("one"); Check(p.Writes==2);};
tests["later user changes prevent destructive restoration"] = () => {var(p,e,s)=Setup();e.Apply(s,"one",write);p.State.Cells[0]![1]!["value"]=88;Fault("recovery_conflict",()=>e.Restore("one"));Check(p.Writes==1);};
tests["partial writes remain recoverable and cannot be replayed"] = () => {var(p,e,s)=Setup(); p.FailAfter=1; var plan=Plan("[{\"type\":\"set_values\",\"address\":\"A1:B1\",\"values\":[[40,50]]}]"); var result=e.Apply(s,"one",plan);Check((string?)result["error"]=="partial_change");e.Apply(s,"one",plan);Check(p.Writes==1);p.FailAfter=0;e.Restore("one");Check((double)p.State.Cells[0]![0]!["value"]! == 1);};
tests["a missing readback never reports a successful edit"] = () => {var(p,e,s)=Setup();p.LoseReadAfterWrite=true;var r=e.Apply(s,"one",write);Check((string?)r["error"]=="write_uncertain");Check(!(bool)r["recoverable"]!);e.Apply(s,"one",write);Check(p.Writes==1);};
tests["formula errors fail verification and retain recovery"] = () => {var(p,e,s)=Setup();p.FormulaError=true;var r=e.Apply(s,"one",Plan("[{\"type\":\"set_formulas\",\"address\":\"A1\",\"formulas\":[[\"=1/0\"]]}]"));Check((string?)r["error"]=="partial_change");Check((bool)r["recoverable"]!);};
tests["unsupported operations and invalid grids are rejected"] = () => {
    var(p,e,s)=Setup();
    var cases = new[] {
        ("unsupported_operation", "[{\"type\":\"executevba\",\"address\":\"A1\"}]"),
        ("invalid_value", "[{\"type\":\"set_values\",\"address\":\"A1\",\"values\":[[\"=1+1\"]]}]"),
        ("invalid_grid", "[{\"type\":\"set_values\",\"address\":\"A1:B1\",\"values\":[[1]]}]"),
        ("unsupported_formula", "[{\"type\":\"set_formulas\",\"address\":\"A1\",\"formulas\":[[\"=WEBSERVICE(A2)\"]]}]"),
        ("overlapping_operations", "[{\"type\":\"format_range\",\"address\":\"A1\",\"bold\":true},{\"type\":\"format_range\",\"address\":\"A1\",\"bold\":false}]")
    };
    foreach(var item in cases) Fault(item.Item1,()=>e.Apply(s,Guid.NewGuid().ToString("N"),Plan(item.Item2)));
    Check(p.Writes==0);
};
tests["range parsing rejects off-grid and named references"] = () => {foreach(var value in new[]{"A0","XFE1","A1048577","B2:A1","Sheet2!A1","A:A","name"}) Fault("invalid_range",()=>Region.Parse(value)); Check(Region.Parse("$a$1:$b$2").Address=="A1:B2");};
tests["selection limit is enforced"] = () => {var(p,e,_)=Setup();p.State.Address="A1:A1001";Fault("range_limit",()=>e.Selection());};
tests["oversized selection text is rejected before leaving the engine"] = () => {var(p,e,_)=Setup();p.State.Cells[0]![0]!["value"]=new string('x',120001);Fault("range_limit",()=>e.Selection());};
tests["constant Excel errors cannot be overwritten without a faithful restore"] = () => {var(p,e,_)=Setup();p.State.Cells[0]![0]!["error"]=true;var s=(string)e.Selection()["scopeId"]!;Fault("unsupported_target",()=>e.Apply(s,"one",write));Check(p.Writes==0);};
tests["a pre-write failure does not create a false recovery record"] = () => {var(p,e,s)=Setup();p.FailBefore=true;var r=e.Apply(s,"one",write);Check((string?)r["error"]=="workbook_not_writable");Check(e.History().Count==0);Check(!(bool)r["recoverable"]!);e.Apply(s,"one",write);Check(p.Writes==0);};
tests["a pre-existing formula error can be faithfully restored"] = () => {var(p,e,_)=Setup();p.State.Cells[1]![1]!["error"]=true;var s=(string)e.Selection()["scopeId"]!;e.Apply(s,"one",Plan("[{\"type\":\"set_values\",\"address\":\"B2\",\"values\":[[5]]}]"));p.FormulaError=true;Check((bool)e.Restore("one")["restored"]!);Check((bool)p.State.Cells[1]![1]!["error"]!);};
tests["unexpected changes outside the patch fail readback and can be restored"] = () => {var(p,e,s)=Setup();var before=p.State.Clone();p.DamageOtherCell=true;var result=e.Apply(s,"one",write);Check((string?)result["error"]=="partial_change");Check((bool)result["recoverable"]!);p.DamageOtherCell=false;e.Restore("one");Check(JToken.DeepEquals(before.Cells,p.State.Cells));};
tests["new calculation errors in dependent cells fail the readback"] = () => {var(p,e,s)=Setup();p.DependentError=true;var result=e.Apply(s,"one",write);Check((string?)result["error"]=="partial_change");};
tests["all supported style fields are read, verified and restored together"] = () => {
    var(p,e,s)=Setup();var before=p.State.Clone();
    var result=e.Apply(s,"styles",Plan("[{\"type\":\"format_range\",\"address\":\"A1\",\"fontName\":\"Arial\",\"fontSize\":14,\"fontColor\":\"#1234ab\",\"italic\":true,\"horizontalAlignment\":\"center\",\"verticalAlignment\":\"top\",\"wrapText\":true,\"fillColor\":null}]"));
    Check((bool)result["applied"]!);Check((string?)result["snapshot"]!["formats"]!["fontColor"]![0]![0]=="#1234AB");
    e.Restore("styles");Check(JToken.DeepEquals(before.Cells,p.State.Cells));
};
tests["invalid style attributes are rejected before any native write"] = () => {
    var(p,e,s)=Setup();foreach(var value in new[]{"\"huge\"","0","500","11.3"})Fault("invalid_format",()=>e.Apply(s,Guid.NewGuid().ToString("N"),Plan("[{\"type\":\"format_range\",\"address\":\"A1\",\"fontSize\":"+value+"}]")));Check(p.Writes==0);
};
tests["unexpected font damage outside the edit fails verification and can be restored"] = () => {
    var(p,e,s)=Setup();var before=p.State.Clone();p.DamageFont=true;var result=e.Apply(s,"damage",write);Check((string?)result["error"]=="partial_change");p.DamageFont=false;e.Restore("damage");Check(JToken.DeepEquals(before.Cells,p.State.Cells));
};
tests["validation failures cannot claim success and retain a guarded recovery"] = () => {
    var(p,e,_)=Setup();p.State.Cells[0]![0]!["validation"]=JObject.Parse("{\"type\":1,\"operator\":1,\"formula1\":\"1\",\"formula2\":\"10\"}");p.State.Cells[0]![0]!["validationValid"]=true;
    var s=(string)e.Selection()["scopeId"]!;p.RejectValidation=true;var result=e.Apply(s,"invalid",write);Check((string?)result["error"]=="partial_change");Check((string?)result["cause"]=="validation_failed");e.Apply(s,"invalid",write);Check(p.Writes==1);
};
tests["unreadable validation and changed date system cannot be bypassed"] = () => {
    var(p,e,_)=Setup();p.State.Cells[0]![0]!["validation"]=JObject.Parse("{\"status\":\"unreadable\"}");var s=(string)e.Selection()["scopeId"]!;Fault("validation_unavailable",()=>e.Apply(s,"blocked",write));Check(p.Writes==0);
    p.State.Date1904=true;Fault("cells_changed",()=>e.Apply(s,"changed",write));Check(p.Writes==0);
};
tests["unexpected layout drift is not reported as automatically recoverable"] = () => {
    var(p,e,s)=Setup();p.DamageLayout=true;var result=e.Apply(s,"layout",write);Check((string?)result["error"]=="partial_change");Check(!(bool)result["recoverable"]!);Check(!(bool)e.History()[0]!["recoverable"]!);Fault("unsupported_recovery",()=>e.Restore("layout"));
};
tests["worksheet reads do not grant a new editable scope"] = () => {
    var(p,e,s)=Setup();var catalog=e.ListSheets(s,0);Check((string?)catalog["sourceScopeId"]==s);
    var read=e.ReadWorkbookRange(s,"sheet-b","A1:B2");Check(read["scopeId"]==null);Check((bool)read["readOnly"]!);Check((string?)read["worksheet"]=="Criteria");
    Fault("scope_expired",()=>e.Apply("sheet-b","foreign",write));Check(p.Writes==0);
};
tests["source fingerprint drift blocks edits before any mutation"] = () => {
    var(p,e,s)=Setup();var read=e.ReadWorkbookRange(s,"sheet-b","A1:B2");var plan=(JObject)write.DeepClone();
    plan["sourceDependencies"]=new JArray(new JObject { ["sheetId"]="sheet-b",["address"]="A1:B2",["fingerprint"]=read["fingerprint"] });
    p.Source.Cells[0]![0]!["value"]=999;Fault("source_changed",()=>e.Apply(s,"stale-source",plan));Check(p.Writes==0);
    plan["sourceDependencies"]![0]!["fingerprint"]=e.ReadWorkbookRange(s,"sheet-b","A1:B2")["fingerprint"];
    Check((bool)e.Apply(s,"fresh-source",plan)["applied"]!);Check(p.Writes==1);
    p.Source.Cells[0]![0]!["value"]=1000;Check((bool)e.Apply(s,"fresh-source",plan)["applied"]!);Check(p.Writes==1);
};
tests["source dependencies cannot escape the bound workbook or omit their fingerprint"] = () => {
    var(p,e,s)=Setup();var plan=(JObject)write.DeepClone();
    plan["sourceDependencies"]=JArray.Parse("[{\"sheetId\":\"foreign\",\"address\":\"A1:B2\",\"fingerprint\":\"x\"}]");
    Fault("out_of_scope",()=>e.Apply(s,"foreign-source",plan));
    plan["sourceDependencies"]=JArray.Parse("[{\"sheetId\":\"sheet-b\",\"address\":\"A1:B2\"}]");
    Fault("invalid_plan",()=>e.Apply(s,"missing-source-hash",plan));Check(p.Writes==0);
};
tests["merged anchor accepts only values and preserves layout on restore"] = () => {
    var(p,e,_)=Setup();p.State.Cells[0]![0]!["mergedAddress"]="A1:B1";p.State.Cells[0]![1]!["mergedAddress"]="A1:B1";p.State.Cells[0]![1]!["value"]=null;p.State.Cells[0]![1]!["displayText"]="";
    var before=p.State.Clone();var s=(string)e.Selection()["scopeId"]!;
    Check((bool)e.Apply(s,"merged-input",write)["applied"]!);Check((string?)p.State.Cells[0]![1]!["mergedAddress"]=="A1:B1");
    e.Restore("merged-input");Check(JToken.DeepEquals(before.Cells,p.State.Cells));
};
tests["merged followers partial merges formulas and style changes fail before mutation"] = () => {
    foreach(var item in new[]{("A1:B1","B1","value"),("A1:C1","A1","value"),("A1:B1","A1","formula"),("A1:B1","A1","bold")}) {
        var(p,e,_)=Setup();p.State.Cells[0]![0]!["mergedAddress"]=item.Item1;p.State.Cells[0]![1]!["mergedAddress"]=item.Item1;
        var area=Region.Parse(item.Item2);Fault("unsupported_target",()=>WorkbookEngine.ValidateTarget(p.State,area.Row,area.Column,item.Item3));Check(p.Writes==0);
    }
    var(port,engine,_scope)=Setup();port.State.Cells[0]![0]!["mergedAddress"]="A1:B1";port.State.Cells[0]![0]!["formula"]="=2";
    var scope=(string)engine.Selection()["scopeId"]!;Fault("unsupported_target",()=>engine.Apply(scope,"formula-anchor",write));Check(port.Writes==0);
};
tests["protected and read-only states reject writes and remain visible in observations"] = () => {
    foreach(var readOnly in new[]{true,false}){var(p,e,_)=Setup();p.State.ReadOnly=readOnly;p.State.Protected=!readOnly;var observation=e.Selection();
        Check((bool)observation[readOnly?"readOnly":"protected"]!);Fault("workbook_not_writable",()=>e.Apply((string)observation["scopeId"]!,"locked",write));Check(p.Writes==0);}
};
var passed=0;
foreach(var test in tests) {try {test.Value();Console.WriteLine("PASS " + test.Key);passed++;} catch(Exception ex) {Console.Error.WriteLine("FAIL " + test.Key + ": " + ex);Environment.ExitCode=1;}}
Console.WriteLine($"{passed}/{tests.Count} native contract scenarios passed; Excel COM is simulated.");

sealed class FakePort : IWorkbookPort, IWorkbookReadPort
{
    public SheetState Source;
    public SheetState State=new SheetState{DocumentId="book-a",SheetId="sheet-a",Workbook="Budget.xlsx",Worksheet="Sheet1",Address="A1:B2",Cells=JArray.Parse("[[{\"value\":1.0,\"formula\":null,\"error\":false,\"bold\":false,\"fillColor\":null,\"numberFormat\":\"General\"},{\"value\":2.0,\"formula\":null,\"error\":false,\"bold\":false,\"fillColor\":null,\"numberFormat\":\"General\"}],[{\"value\":3.0,\"formula\":null,\"error\":false,\"bold\":false,\"fillColor\":null,\"numberFormat\":\"General\"},{\"value\":3.0,\"formula\":\"=SUM(A1:B1)\",\"error\":false,\"bold\":false,\"fillColor\":null,\"numberFormat\":\"General\"}]]")};
    public FakePort() {
        foreach (var row in State.Cells) foreach (var token in row) {
            var cell=(JObject)token;
            cell["italic"]=false;cell["fontName"]="맑은 고딕";cell["fontSize"]=11;cell["fontColor"]="#000000";
            cell["horizontalAlignment"]="general";cell["verticalAlignment"]="bottom";cell["wrapText"]=false;
            cell["displayText"]=cell["value"]!.ToString();cell["locked"]=true;cell["mergedAddress"]=null;cell["arrayFormula"]=false;
            cell["rowHeight"]=18;cell["columnWidth"]=12;cell["validation"]=null;cell["validationValid"]=null;
        }
        Source=State.Clone();Source.SheetId="sheet-b";Source.Worksheet="Criteria";
    }
    public JObject ListSheets(SheetState anchor,int offset) => new JObject { ["documentId"]=anchor.DocumentId,["items"]=new JArray(new JObject { ["sheetId"]="sheet-b",["name"]="Criteria" }) };
    public JObject InspectSheet(SheetState anchor,string sheetId,string part,int offset) => new JObject { ["items"]=new JArray() };
    public SheetState ReadRange(SheetState anchor,string sheetId,string address) {
        if(Closed)throw new OfficeFault("document_closed");
        if(anchor.DocumentId!=State.DocumentId||sheetId!="sheet-b"||address!="A1:B2")throw new OfficeFault("out_of_scope");
        return Source.Clone();
    }
    public bool DamageFont,RejectValidation,DamageLayout;
    public int Writes,FailAfter; public bool Closed,LoseReadAfterWrite,FormulaError,FailBefore,DamageOtherCell,DependentError;
    public SheetState CaptureSelection()=>State.Clone();
    public SheetState Read(SheetState target){if(Closed)throw new OfficeFault("document_closed");if(LoseReadAfterWrite&&Writes>0)throw new Exception("read failed");return State.Clone();}
    public void Write(SheetState target,IReadOnlyList<CellPatch> patches){if(FailBefore)throw new OfficeFault("workbook_not_writable");Writes++;var count=0;foreach(var p in patches){var cell=(JObject)State.Cells[p.Row]![p.Column]!;cell[p.Field]=p.Value.DeepClone();if(p.Field=="value"){cell["formula"]=null;cell["error"]=false;if(p.Value.Type==JTokenType.Integer)cell["value"]=(double)p.Value;}if(p.Field=="formula"){cell["value"]=3.0;cell["error"]=FormulaError;}if(++count==FailAfter)throw new Exception("simulated partial failure");}if(DamageLayout)State.Cells[0]![1]!["columnWidth"]=30;
    if(DamageFont)State.Cells[0]![1]!["fontColor"]="#FF0000";if(RejectValidation)State.Cells[0]![0]!["validationValid"]=false;
    foreach(var row in State.Cells)foreach(var cell in row)cell["displayText"]=cell["value"]!.ToString();
    if(DamageOtherCell)State.Cells[0]![1]!["value"]=99;if(DependentError)State.Cells[1]![1]!["error"]=true;}
    public void Focus(SheetState target){Read(target);}
}

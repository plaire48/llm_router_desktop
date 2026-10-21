using System.IO.Compression;
using System.Xml.Linq;
using Newtonsoft.Json.Linq;
using Nubi.Office.Capture;
// Synthetic Flat OPC transport only. Production never opens ZIPs or parses the source file.
if (args.Length != 2) throw new Exception("fixture and output required");
XNamespace pkg = "http://schemas.microsoft.com/office/2006/xmlPackage";
using var zip = ZipFile.OpenRead(args[0]); var parts = new XElement(pkg + "package");
foreach (var entry in zip.Entries.Where(e => !e.FullName.EndsWith('/') && e.FullName != "[Content_Types].xml"))
{
    using var stream = entry.Open(); using var bytes = new MemoryStream(); stream.CopyTo(bytes); var data = bytes.ToArray();
    var xml = entry.FullName.EndsWith(".xml") || entry.FullName.EndsWith(".rels");
    parts.Add(new XElement(pkg + "part", new XAttribute(pkg + "name", "/" + entry.FullName), new XAttribute(pkg + "contentType", xml ? "application/xml" : entry.FullName.EndsWith(".png") ? "image/png" : "application/octet-stream"), xml ? new XElement(pkg + "xmlData", XElement.Parse(System.Text.Encoding.UTF8.GetString(data))) : new XElement(pkg + "binaryData", Convert.ToBase64String(data))));
}
var files = new Dictionary<string, byte[]>();
var projection = new WordCaptureProjection(parts.ToString(), (name, data) => { files.Add(name, data); return name; }, 200);
var result = projection.Read();
void Check(bool condition, string name) { if (!condition) throw new Exception(name); }
Check(result.Document["paragraphs"] is JArray, "paragraphs");
Check(result.Assets.Count > 0 && files.Count == result.Assets.Count, "assets");
Check(!result.Assets.Any(a => ((string?)a["path"])?.StartsWith('/') == true), "relative assets");
Check(result.Document["headers"]!.Any(), "headers"); Check(result.Document["footnotes"]!.Any(), "footnotes");
try { new WordCaptureProjection("<!DOCTYPE x [<!ENTITY a SYSTEM 'file:///private'>]><x>&a;</x>", (n, b) => n, 200).Read(); throw new Exception("DTD accepted"); } catch (System.Xml.XmlException) { }
try { new WordCaptureProjection(parts.ToString(), (n, b) => n, 0).Read(); throw new Exception("asset limit accepted"); } catch (CaptureException e) { Check(e.Message == "form_capture_too_large", "asset limit code"); }
var capture = new JObject { ["schemaVersion"] = 1, ["app"] = "word", ["engine"] = "office", ["fidelity"] = "office", ["office"] = new JObject { ["version"] = "synthetic" }, ["source"] = new JObject { ["name"] = "synthetic.docx", ["bytes"] = new FileInfo(args[0]).Length, ["hash"] = "sha256:" + Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(args[0]))).ToLowerInvariant() }, ["document"] = result.Document, ["assets"] = result.Assets };
var temp = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(args[1]))!, "capture-guards-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try
{
    var source = Path.Combine(temp, "source.docx"); File.Copy(args[0], source);
    var before = File.ReadAllBytes(source); int checks = 0;
    JObject Input(string dir) => new() { ["path"] = source, ["outDir"] = dir, ["maxAssets"] = 200, ["renders"] = true };
    string NewDir() { var p = Path.Combine(temp, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(p); return p; }
    var doc = new FakeDocument(source, parts.ToString()); var dir = NewDir();
    var native = ContentCapture.CaptureWord(doc, Input(dir));
    Check(native["capture"]!["document"]!["renders"]!.Count() == 2, "page render count");
    Check(native["capture"]!["assets"]!.All(a => File.Exists(Path.Combine(dir, (string)a["path"]!))), "all assets exist");
    Check(before.SequenceEqual(File.ReadAllBytes(source)), "source unchanged"); checks++;
    void Reject(string code, Action<FakeDocument, JObject> setup)
    {
        var d = new FakeDocument(source, parts.ToString()); var output = NewDir(); var input = Input(output); setup(d, input);
        try { ContentCapture.CaptureWord(d, input); throw new Exception("accepted " + code); }
        catch (CaptureException e) { Check(e.Message == code, "code " + e.Message + " != " + code); }
        Check(!Directory.EnumerateFileSystemEntries(output).Any(), "failure cleanup " + code); checks++;
    }
    Reject("form_capture_source_mismatch", (d, i) => i["path"] = Path.Combine(temp, "another.docx"));
    Reject("form_capture_unsaved", (d, i) => d.IsSaved = false);
    Reject("form_capture_source_changed", (d, i) => d.ChangeOnRead = true);
    Reject("form_capture_too_large", (d, i) => i["maxAssets"] = 1);
    Reject("form_capture_render_failed", (d, i) => d.InvalidRender = true);
    Reject("form_capture_source_mismatch", (d, i) => d.Check = () => throw new CaptureException("form_capture_source_mismatch"));
    Reject("form_capture_too_large", (d, i) => d.Xml = d.Xml.Replace("빨간 글자", new string('x', 300001)));
    Reject("form_capture_invalid", (d, i) => i["maxAssets"] = 201);
    var occupied = NewDir(); File.WriteAllText(Path.Combine(occupied, "keep"), "keep");
    try { ContentCapture.CaptureWord(doc, Input(occupied)); throw new Exception("nonempty accepted"); } catch (CaptureException e) { Check(e.Message == "form_capture_output_not_empty", "nonempty code"); }
    Check(File.ReadAllText(Path.Combine(occupied, "keep")) == "keep", "existing file preserved"); checks++;
    Console.WriteLine($"Native orchestration fake guards: {checks} passed (no COM)");
}
finally { Directory.Delete(temp, true); }
File.WriteAllText(args[1], capture.ToString()); Console.WriteLine("synthetic Flat OPC projection and guard tests passed; NOT Office COM evidence");

sealed class FakeDocument(string name, string xml) : IWordCaptureDocument
{
    public string FullName => name; public string Version => "synthetic"; public string Build => "0";
    public bool IsSaved = true, ChangeOnRead, InvalidRender; public string Xml = xml; public Action Check = () => { }; int reads;
    public bool Saved => IsSaved; public void CheckBinding() => Check();
    public string ReadXml() => Xml + (ChangeOnRead && reads++ > 0 ? " " : "");
    public int PageCount() => 2;
    public void RenderPage(string path, int page) => File.WriteAllText(path, InvalidRender ? "invalid" : "%PDF-FAKE-TEST-ONLY-" + page);
}

#nullable disable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Nubi.Office.Capture
{
    public interface IWordCaptureDocument
    {
        string FullName { get; }
        string Version { get; }
        string Build { get; }
        bool Saved { get; }
        void CheckBinding(); string ReadXml(); int PageCount(); void RenderPage(string path, int page);
    }
    public static class ContentCapture
    {
        public const int MaxResponseChars = 300000;
        static string HashBytes(byte[] bytes) { using (var sha = SHA256.Create()) return "sha256:" + BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
        static string FileHash(string path) { using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete)) using (var sha = SHA256.Create()) return "sha256:" + BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
        static void SafeDirectory(string directory) { if (!Directory.Exists(directory)) throw new CaptureException("form_capture_output_invalid"); for (var item = new DirectoryInfo(directory); item != null; item = item.Parent) if ((item.Attributes & FileAttributes.ReparsePoint) != 0) throw new CaptureException("form_capture_output_invalid"); if (Directory.EnumerateFileSystemEntries(directory).Any()) throw new CaptureException("form_capture_output_not_empty"); }
        public static JObject CaptureWord(IWordCaptureDocument document, JObject input)
        {
            if (input.Properties().Any(p => !new[] { "path", "outDir", "maxAssets", "renders", "scopeId" }.Contains(p.Name))) throw new CaptureException("form_capture_invalid");
            string source = (string)input["path"], directory = (string)input["outDir"]; if (String.IsNullOrEmpty(source) || String.IsNullOrEmpty(directory) || !Path.IsPathRooted(source) || !Path.IsPathRooted(directory)) throw new CaptureException("form_capture_invalid"); source = Path.GetFullPath(source); directory = Path.GetFullPath(directory);
            int limit = (int?)input["maxAssets"] ?? 200; if (limit < 1 || limit > 200) throw new CaptureException("form_capture_invalid"); bool renders = (bool?)input["renders"] ?? true;
            document.CheckBinding(); if (!String.Equals(Path.GetFullPath(document.FullName), source, StringComparison.OrdinalIgnoreCase)) throw new CaptureException("form_capture_source_mismatch"); if (!document.Saved) throw new CaptureException("form_capture_unsaved"); SafeDirectory(directory);
            string sourceHash = FileHash(source); long sourceBytes = new FileInfo(source).Length; var owned = new List<string>(); long totalBytes = 0;
            string Write(string name, byte[] bytes) { if (bytes.LongLength > 64000000 || totalBytes + bytes.LongLength > 128000000) throw new CaptureException("form_capture_too_large"); string path = Path.Combine(directory, name); using (var file = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { owned.Add(path); file.Write(bytes, 0, bytes.Length); } totalBytes += bytes.LongLength; return name; }
            try
            {
                string xml = document.ReadXml(); if (xml.Length > 64000000) throw new CaptureException("form_capture_too_large"); var projection = new WordCaptureProjection(xml, Write, limit).Read();
                if (renders) { int pages = document.PageCount(); if (pages < 1 || pages + projection.Assets.Count > limit) throw new CaptureException("form_capture_too_large"); var output = new JArray(); for (int page = 1; page <= pages; page++) { document.CheckBinding(); string name = "page-" + page.ToString(CultureInfo.InvariantCulture) + ".pdf", path = Path.Combine(directory, name); if (File.Exists(path)) throw new CaptureException("form_capture_output_not_empty"); owned.Add(path); document.RenderPage(path, page); var info = new FileInfo(path); if (!info.Exists || info.Length == 0) throw new CaptureException("form_capture_render_failed"); totalBytes += info.Length; if (totalBytes > 128000000) throw new CaptureException("form_capture_too_large"); using (var file = File.OpenRead(path)) { var magic = new byte[5]; if (file.Read(magic, 0, 5) != 5 || Encoding.ASCII.GetString(magic) != "%PDF-") throw new CaptureException("form_capture_render_failed"); } string id = "render-" + page; projection.Assets.Add(new JObject { ["id"] = id, ["kind"] = "render", ["name"] = name, ["contentType"] = "application/pdf", ["path"] = name }); output.Add(new JObject { ["index"] = page, ["asset"] = id }); } projection.Document["renders"] = output; }
                document.CheckBinding(); if (!document.Saved || !String.Equals(Path.GetFullPath(document.FullName), source, StringComparison.OrdinalIgnoreCase) || sourceHash != FileHash(source) || HashBytes(Encoding.UTF8.GetBytes(xml)) != HashBytes(Encoding.UTF8.GetBytes(document.ReadXml()))) throw new CaptureException("form_capture_source_changed");
                var result = new JObject { ["capture"] = new JObject { ["schemaVersion"] = 1, ["app"] = "word", ["engine"] = "office", ["fidelity"] = "office", ["office"] = new JObject { ["version"] = document.Version, ["build"] = document.Build }, ["source"] = new JObject { ["name"] = Path.GetFileName(source), ["bytes"] = sourceBytes, ["hash"] = sourceHash }, ["document"] = projection.Document, ["assets"] = projection.Assets } };
                EnsureSize(result); return result;
            }
            catch { foreach (string path in owned) try { File.Delete(path); } catch { } throw; }
        }
        // Includes framing reserve; never truncate document JSON or return a success prefix.
        public static void EnsureSize(JObject result) { if (result.ToString(Formatting.None).Length + 1024 > MaxResponseChars) throw new CaptureException("form_capture_too_large"); }
    }
    public sealed class ComWordCaptureDocument : IWordCaptureDocument
    {
        readonly dynamic doc, application; readonly Action validate;
        public ComWordCaptureDocument(object document, object app, Action check) { doc = document; application = app; validate = check; }
        public string FullName => Convert.ToString(doc.FullName, CultureInfo.InvariantCulture);
        public string Version => Convert.ToString(application.Version, CultureInfo.InvariantCulture);
        public string Build => Convert.ToString(application.Build, CultureInfo.InvariantCulture);
        public bool Saved => Convert.ToBoolean(doc.Saved, CultureInfo.InvariantCulture);
        public void CheckBinding() => validate();
        public string ReadXml() { object range = doc.Content; try { return (string)((dynamic)range).WordOpenXML; } finally { if (Marshal.IsComObject(range)) Marshal.ReleaseComObject(range); } }
        public int PageCount() => Convert.ToInt32(doc.ComputeStatistics(2, false), CultureInfo.InvariantCulture);
        public void RenderPage(string path, int page)
        {
            // wdExportFormatPDF=17, wdExportFromTo=3. KeepIRM=true. No Save/SaveAs,
            // field update, revision acceptance, selection change or document mutation.
            doc.ExportAsFixedFormat(path, 17, false, 0, 3, page, page, 0, false, true, 0, true, true, false, Type.Missing);
        }
    }
}

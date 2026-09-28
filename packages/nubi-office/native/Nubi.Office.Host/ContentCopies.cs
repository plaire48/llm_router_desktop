using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed partial class ContentPort
    {
        private string? ChooseCopyPath(ContentDocument source,string title,string fingerprint)
        {
            source.ValidateCopySource();
            string extension=Path.GetExtension(source.BoundName).ToLowerInvariant();
            using(var dialog=new SaveFileDialog{Title="양식 사본 저장",Filter=$"Office (*{extension})|*{extension}",DefaultExt=extension.TrimStart('.'),AddExtension=true,OverwritePrompt=true,
                FileName=string.Concat(title.Take(100).Select(c=>Path.GetInvalidFileNameChars().Contains(c)?'_':c))+extension}){
                if(dialog.ShowDialog()!=DialogResult.OK)return null;
                if(!string.Equals(Path.GetExtension(dialog.FileName),extension,StringComparison.OrdinalIgnoreCase))throw new OfficeFault("template_format_unsupported");
                if(File.Exists(dialog.FileName)||string.Equals(source.BoundName,dialog.FileName,StringComparison.OrdinalIgnoreCase))throw new OfficeFault("template_destination_exists");
                source.EnsureOpen();
                if(source.Fingerprint(source.Items())!=fingerprint)throw new OfficeFault("source_changed");
                return dialog.FileName;
            }
        }
        private JObject Copy(ContentDocument source,string path,string fingerprint,List<JObject> before)
        {
            // Runs once on UI/STA after the operation's uncertain receipt exists.
            // No ZIP rewriting, plaintext sidecar or filesystem copy of content.
            var copy=source.CreateCopy(path);
            if(host=="powerpoint"&&source.Fingerprint(source.Items())!=fingerprint)throw new OfficeFault("source_changed");
            copy.BindCopy(source,path,fingerprint);
            Register(copy);
            var after=copy.Items();
            var checks=new JArray{
                CopyCheck("destination_binding","사본 파일 연결",copy.SavedAt(path)&&copy.Id!=source.Id),
                CopyCheck("observed_content","관찰한 원본 내용과 속성 보존",JToken.DeepEquals(new JArray(before),new JArray(after))),
                CopyCheck("selection_scope","선택한 수정 범위 보존",copy.SameAllowedScope(source))
            };
            copy.CopyReady=checks.All(c=>(string?)c["status"]=="met");
            return new JObject{["verified"]=true,["copied"]=true,["sourceScopeId"]=source.Id,["sourceFingerprint"]=fingerprint,
                ["path"]=path,["checks"]=checks,["snapshot"]=Read(copy.Id,0)};
        }
        private static JObject CopyCheck(string id,string label,bool met)=>new JObject{["id"]=id,["requirement"]=label,["status"]=met?"met":"unmet"};
    }
    internal abstract partial class ContentDocument
    {
        private string boundName;
        public string BoundName=>boundName;
        public JObject? CopySource {get;private set;}
        public string? CopyPath {get;private set;}
        public bool CopyReady {get;set;}
        public void AcceptSavedPath(){boundName=(string)Doc.FullName;}
        public void ValidateCopySource()
        {
            EnsureOpen();
            if(string.IsNullOrEmpty((string)Doc.Path))throw new OfficeFault("template_source_unsaved");
            if(!new[]{".docx",".docm",".pptx",".pptm"}.Contains(Path.GetExtension(boundName).ToLowerInvariant()))throw new OfficeFault("template_format_unsupported");
        }
        public void BindCopy(ContentDocument source,string path,string fingerprint)
        {
            if(Created||Id==source.Id)throw new OfficeFault("content_copy_mismatch");
            Allowed.UnionWith(source.Allowed);
            CopyPath=path;CopySource=new JObject{["scopeId"]=source.Id,["fingerprint"]=fingerprint};
        }
        public bool SameAllowedScope(ContentDocument source)=>Allowed.SetEquals(source.Allowed);
        public void CommitCopy()
        {
            EnsureOpen();
            if(!CopyReady||CopyPath==null||!string.Equals(CopyPath,boundName,StringComparison.OrdinalIgnoreCase))throw new OfficeFault("content_copy_mismatch");
            var before=Items();
            Doc.Save();
            if(!SavedAt(CopyPath)||!JToken.DeepEquals(new JArray(before),new JArray(Items())))throw new OfficeFault("document_save_uncertain");
        }
        public abstract ContentDocument CreateCopy(string path);
    }
}

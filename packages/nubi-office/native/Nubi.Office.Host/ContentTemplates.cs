using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed partial class ContentPort
    {
        private JObject RegisterTemplate(ContentDocument document,JObject payload)
        {
            if(document.CopySource==null||!document.CopyReady||document.CopyPath==null||!document.SavedAt(document.CopyPath))throw new OfficeFault("content_copy_mismatch");
            string usageNotes=(string?)payload["usageNotes"]??"";
            if(usageNotes.Length>32000)throw new OfficeFault("template_record_invalid");
            var items=document.Items();
            if(items.Any(item=>(bool?)item["truncated"]==true))throw new OfficeFault("evidence_incomplete");
            var snapshot=new JObject{["schemaVersion"]=1,["fingerprint"]=document.Fingerprint(items),["items"]=new JArray(items),["allowed"]=document.TemplateAllowed(),
                ["signature"]=ContentDocument.Hash(new JArray(items).ToString(Formatting.None)),["usageNotes"]=usageNotes};
            var entry=TemplateCatalog.Add(host,(string?)payload["templateId"]??"",(string?)payload["name"]??"",(string?)payload["summary"]??"",document.CopyPath,snapshot,items.Count,items.Count(i=>(bool?)i["editable"]==true));
            document.CopyReady=false; // Registered source: future work must copy again.
            return new JObject{["verified"]=true,["saved"]=true,["catalogued"]=true,["id"]=entry["id"],["name"]=entry["name"],["path"]=document.CopyPath,["entry"]=entry,["scopeId"]=document.Id};
        }
        public JObject LoadTemplate(string id)
        {
            var record=TemplateCatalog.Read(host,id);string path=(string)record["path"]!;
            if(!File.Exists(path))throw new OfficeFault("template_file_missing");
            var snapshot=record["snapshot"] as JObject??throw new OfficeFault("template_record_invalid");
            ContentDocument? document=null;
            try{
                document=Wrap(OpenTemplateDocument(path),false);
                document.RestoreTemplateAllowed(snapshot["allowed"] as JArray??throw new OfficeFault("template_record_invalid"));
                var items=document.Items();
                if(ContentDocument.Hash(new JArray(items).ToString(Formatting.None))!=(string?)snapshot["signature"])throw new OfficeFault("template_source_changed");
                Register(document);var scope=Read(document.Id,0);
                return new JObject{["loaded"]=true,["entry"]=TemplateCatalog.Public(record),["scope"]=scope,["usageNotes"]=snapshot["usageNotes"]};
            }catch{if(document!=null&&!documents.ContainsKey(document.Id))document.Dispose();throw;}
        }
        private object OpenTemplateDocument(string path)
        {
            using(var com=new ComObjects()){
                dynamic collection=com.Keep(host=="word"?(object)app.Documents:(object)app.Presentations);
                for(int i=1;i<=collection.Count;i++){
                    object candidate=collection[i];dynamic opened=candidate;
                    if(string.Equals((string)opened.FullName,path,StringComparison.OrdinalIgnoreCase)){
                        if(!Convert.ToBoolean(opened.Saved)){com.Keep(candidate);throw new OfficeFault("template_source_changed");}
                        return candidate;
                    }
                    com.Keep(candidate);
                }
                int security=(int)app.AutomationSecurity;
                try{
                    app.AutomationSecurity=3;
                    return host=="word"?(object)collection.Open(FileName:path,ReadOnly:false,AddToRecentFiles:false,Visible:true):
                        (object)collection.Open(FileName:path,ReadOnly:0,Untitled:0,WithWindow:-1);
                }finally{app.AutomationSecurity=security;}
            }
        }
    }
    internal abstract partial class ContentDocument
    {
        public JArray TemplateAllowed()=>new JArray(Allowed.OrderBy(id=>id));
        public void RestoreTemplateAllowed(JArray ids)
        {
            if(ids.Count>2000||ids.Any(id=>id.Type!=JTokenType.String||id.Value<string>()!.Length>100))throw new OfficeFault("template_record_invalid");
            Allowed.UnionWith(ids.Select(id=>id.Value<string>()!));
        }
    }
}

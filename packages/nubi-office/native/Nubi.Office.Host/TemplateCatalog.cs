using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    // Per-Windows-user local catalog, NOT a shared enterprise catalog. Only
    // encrypted bytes reach disk; the Office template file stays on its native
    // save/open path. DPAPI is not a claim of NASCA policy compliance.
    internal static class TemplateCatalog
    {
        private const int MaxBytes=8000000,MaxRecords=200;
        private static readonly byte[] Entropy=Encoding.UTF8.GetBytes("Nubi.Office.TemplateCatalog.v1");
        private static string Root=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"NubiOffice","Templates");
        private static string FilePath(string host,string id)
        {
            if(!new[]{"excel","word","powerpoint"}.Contains(host)||!Guid.TryParseExact(id,"D",out var guid))throw new OfficeFault("template_record_invalid");
            return Path.Combine(Root,host+"-"+guid.ToString("D")+".bin");
        }
        private static T Locked<T>(Func<T> action)
        {
            using(var mutex=new Mutex(false,"Local\\Nubi.Office.Templates."+ContentDocument.Hash(Root))){
                bool held=false;
                try{try{held=mutex.WaitOne(2000);}catch(AbandonedMutexException){held=true;}
                    if(!held)throw new OfficeFault("template_catalog_busy");return action();
                }catch(OfficeFault){throw;}catch{throw new OfficeFault("template_catalog_unavailable");}
                finally{if(held)mutex.ReleaseMutex();}
            }
        }
        private static JObject ReadUnlocked(string host,string id)
        {
            string path=FilePath(host,id);
            if(!File.Exists(path))throw new OfficeFault("template_not_found");
            if(new FileInfo(path).Length>MaxBytes)throw new OfficeFault("template_record_invalid");
            byte[] clear=ProtectedData.Unprotect(File.ReadAllBytes(path),Entropy,DataProtectionScope.CurrentUser);
            try{
                if(clear.Length>MaxBytes)throw new OfficeFault("template_record_invalid");
                var value=JObject.Parse(Encoding.UTF8.GetString(clear));
                if((int?)value["schemaVersion"]!=1||(string?)value["host"]!=host||(string?)value["id"]!=id||!Path.IsPathRooted((string?)value["path"]??"")||!(value["snapshot"] is JObject))throw new OfficeFault("template_record_invalid");
                return value;
            }finally{Array.Clear(clear,0,clear.Length);}
        }
        private static void WriteUnlocked(JObject record)
        {
            string path=FilePath((string)record["host"]!,(string)record["id"]!);
            byte[] clear=Encoding.UTF8.GetBytes(record.ToString(Formatting.None)),encrypted;
            try{if(clear.Length>MaxBytes-4096)throw new OfficeFault("template_catalog_limit");encrypted=ProtectedData.Protect(clear,Entropy,DataProtectionScope.CurrentUser);}
            finally{Array.Clear(clear,0,clear.Length);}
            Directory.CreateDirectory(Root);string temp=path+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{
                using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(encrypted,0,encrypted.Length);stream.Flush(true);}
                if(File.Exists(path))File.Replace(temp,path,null);else File.Move(temp,path);
                if(!JToken.DeepEquals(ReadUnlocked((string)record["host"]!,(string)record["id"]!),record))throw new OfficeFault("template_catalog_unavailable");
            }finally{if(File.Exists(temp))File.Delete(temp);}
        }
        private static string Text(string? value,int limit)
        {
            string text=value??throw new OfficeFault("template_record_invalid");
            if(string.IsNullOrWhiteSpace(text)||text.Length>limit||text.Any(c=>char.IsControl(c)&&c!='\n'&&c!='\r'&&c!='\t'))throw new OfficeFault("template_record_invalid");
            return text.Trim();
        }
        internal static JObject Public(JObject record)=>new JObject{
            ["id"]=record["id"],["host"]=record["host"],["name"]=record["name"],["summary"]=record["summary"],
            ["revision"]=record["revision"],["createdAt"]=record["createdAt"],["updatedAt"]=record["updatedAt"],
            ["itemCount"]=record["itemCount"],["inputCount"]=record["inputCount"],
            ["sourceFile"]=Path.GetFileName((string)record["path"]!),["available"]=File.Exists((string)record["path"]!),["protection"]="windows_current_user"};
        public static JObject Read(string host,string id)=>Locked(()=>ReadUnlocked(host,id));
        public static JObject Add(string host,string id,string name,string summary,string path,JObject snapshot,int itemCount,int inputCount)=>Locked(()=>{
            var destination=FilePath(host,id);
            if(!File.Exists(path)||!Path.IsPathRooted(path))throw new OfficeFault("template_file_missing");
            if(File.Exists(destination)){
                var existing=ReadUnlocked(host,id);
                if(!string.Equals((string?)existing["path"],path,StringComparison.OrdinalIgnoreCase)||!JToken.DeepEquals(existing["snapshot"],snapshot))throw new OfficeFault("operation_collision");
                return Public(existing);
            }
            if(Directory.Exists(Root)&&Directory.GetFiles(Root,host+"-*.bin").Length>=MaxRecords)throw new OfficeFault("template_catalog_limit");
            string now=DateTime.UtcNow.ToString("o");
            var record=new JObject{["schemaVersion"]=1,["id"]=id,["host"]=host,["name"]=Text(name,100),["summary"]=Text(summary,3000),["path"]=Path.GetFullPath(path),
                ["revision"]=1,["createdAt"]=now,["updatedAt"]=now,["snapshot"]=snapshot.DeepClone(),["itemCount"]=itemCount,["inputCount"]=inputCount};
            WriteUnlocked(record);return Public(record);
        });
        public static JObject List(string host)=>Locked(()=>{
            FilePath(host,Guid.Empty.ToString("D"));var entries=new JArray();int unreadable=0;
            if(Directory.Exists(Root))foreach(string path in Directory.GetFiles(Root,host+"-*.bin").OrderBy(p=>p).Take(MaxRecords)){
                string id=Path.GetFileNameWithoutExtension(path).Substring(host.Length+1);
                try{entries.Add(Public(ReadUnlocked(host,id)));}catch{unreadable++;}
            }
            return new JObject{["host"]=host,["entries"]=new JArray(entries.OrderByDescending(e=>(string?)e["updatedAt"])),["unreadable"]=unreadable};
        });
        public static JObject Change(string host,string id,int revision,string? name,bool remove)=>Locked(()=>{
            var record=ReadUnlocked(host,id);
            if((int?)record["revision"]!=revision)throw new OfficeFault("template_catalog_changed");
            if(remove){File.Delete(FilePath(host,id));return new JObject{["removed"]=true,["id"]=id};}
            record["name"]=Text(name,100);record["revision"]=revision+1;record["updatedAt"]=DateTime.UtcNow.ToString("o");WriteUnlocked(record);return Public(record);
        });
    }
}

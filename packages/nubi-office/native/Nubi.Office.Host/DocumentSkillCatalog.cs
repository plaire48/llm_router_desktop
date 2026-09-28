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
    // Writing rules and immutable uploaded skill resources. Answers stay in memory.
    internal static class DocumentSkillCatalog
    {
        private const int MaxBytes=16777216;
        private static readonly byte[] Entropy=Encoding.UTF8.GetBytes("Nubi.Office.DocumentSkills.v1");
        private static string Root=>Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"NubiOffice","DocumentSkills");
        private static string FilePath(string host,string id){
            if(!new[]{"excel","word","powerpoint"}.Contains(host)||!Guid.TryParseExact(id,"D",out var guid)||id!=guid.ToString("D"))throw new OfficeFault("document_skill_invalid");
            return Path.Combine(Root,host+"-"+id+".bin");
        }
        private static T Locked<T>(Func<T> action){
            using(var mutex=new Mutex(false,"Local\\Nubi.Office.DocumentSkills."+ContentDocument.Hash(Root))){bool held=false;
                try{try{held=mutex.WaitOne(2000);}catch(AbandonedMutexException){held=true;}if(!held)throw new OfficeFault("document_skill_busy");return action();}
                catch(OfficeFault){throw;}catch{throw new OfficeFault("document_skill_unavailable");}finally{if(held)mutex.ReleaseMutex();}
            }
        }
        private static bool Text(JToken? value,int max){string? text=value?.Type==JTokenType.String?(string?)value:null;return text!=null&&!string.IsNullOrWhiteSpace(text)&&text.Length<=max&&!text.Any(c=>c<32&&c!='\n'&&c!='\r'&&c!='\t');}
        private static void Validate(string host,JObject skill){
            FilePath(host,(string?)skill["id"]??"");
            if(skill.Properties().Any(p=>!new[]{"id","host","revision","name","instructions","questions","package"}.Contains(p.Name))||(string?)skill["host"]!=host||skill["revision"]?.Type!=JTokenType.Integer||(long?)skill["revision"]<1||(long?)skill["revision"]>int.MaxValue||!Text(skill["name"],100)||!Text(skill["instructions"],8000)||!(skill["questions"] is JArray questions)||questions.Count>8)throw new OfficeFault("document_skill_invalid");
            if(skill["package"] is JObject package){SkillPackageImport.Validate(package);if(questions.Count!=0)throw new OfficeFault("document_skill_invalid");}else if(skill["package"]!=null)throw new OfficeFault("document_skill_invalid");
            var labels=new System.Collections.Generic.HashSet<string>();
            foreach(var item in questions){
                if(!(item is JObject q)||q.Properties().Any(p=>!new[]{"question","choices","input_mode"}.Contains(p.Name))||!Text(q["question"],180)||!labels.Add(((string)q["question"]!).Trim())||!new[]{"text","long_text"}.Contains((string?)q["input_mode"])||!(q["choices"] is JArray choices)||choices.Count==1||choices.Count>4)throw new OfficeFault("document_skill_invalid");
                var seen=new System.Collections.Generic.HashSet<string>();
                foreach(var choice in choices)if(!(choice is JObject c)||c.Properties().Any(p=>p.Name!="label")||!Text(c["label"],80)||!seen.Add(((string)c["label"]!).Trim()))throw new OfficeFault("document_skill_invalid");
            }
        }
        private static JObject ReadUnlocked(string host,string id){
            string file=FilePath(host,id);if(!File.Exists(file))throw new OfficeFault("document_skill_missing");
            if(new FileInfo(file).Length>MaxBytes)throw new OfficeFault("document_skill_invalid");
            byte[] clear=ProtectedData.Unprotect(File.ReadAllBytes(file),Entropy,DataProtectionScope.CurrentUser);
            try{if(clear.Length>MaxBytes)throw new OfficeFault("document_skill_invalid");var skill=JObject.Parse(Encoding.UTF8.GetString(clear));Validate(host,skill);if((string?)skill["id"]!=id)throw new OfficeFault("document_skill_invalid");return skill;}
            finally{Array.Clear(clear,0,clear.Length);}
        }
        public static JObject Public(JObject skill){
            var value=new JObject(skill.Properties().Where(p=>p.Name!="package").Select(p=>new JProperty(p.Name,p.Value.DeepClone())));
            if(skill["package"] is JObject package)value["package"]=new JObject(package.Properties().Where(p=>p.Name!="files").Select(p=>new JProperty(p.Name,p.Value.DeepClone())));
            return value;
        }
        public static JObject Read(string host,string id)=>Locked(()=>ReadUnlocked(host,id));
        public static JObject Manifest(string host,string id,int revision)=>Locked(()=>{
            var skill=ReadUnlocked(host,id);if((int)skill["revision"]! !=revision)throw new OfficeFault("document_skill_changed");
            if(!(skill["package"] is JObject package))throw new OfficeFault("document_skill_package_invalid");
            return new JObject{["skill"]=Public(skill),["files"]=SkillPackageImport.Manifest((JArray)package["files"]!)};
        });
        public static JObject Resource(string host,string id,int revision,string digest,string path,int offset)=>Locked(()=>{
            var skill=ReadUnlocked(host,id);if((int)skill["revision"]! !=revision||(string?)skill["package"]?["sha256"]!=digest)throw new OfficeFault("document_skill_changed");
            SkillPackageImport.PathCheck(path);var file=((JArray)skill["package"]!["files"]!).Cast<JObject>().SingleOrDefault(f=>(string?)f["path"]==path)??throw new OfficeFault("document_skill_missing");
            byte[] bytes=Convert.FromBase64String((string)file["data"]!);if(offset<0||offset>bytes.Length||offset%48000!=0)throw new OfficeFault("document_skill_package_invalid");
            int count=Math.Min(48000,bytes.Length-offset);return new JObject{["id"]=id,["revision"]=revision,["packageSha256"]=digest,["path"]=path,["sha256"]=file["sha256"]!.DeepClone(),["size"]=bytes.Length,["offset"]=offset,["data"]=Convert.ToBase64String(bytes,offset,count),["nextOffset"]=offset+count<bytes.Length?new JValue(offset+count):JValue.CreateNull()};
        });
        public static JObject List(string host)=>Locked(()=>{
            FilePath(host,Guid.Empty.ToString("D"));var entries=new JArray();int unreadable=0;
            if(Directory.Exists(Root))foreach(var file in Directory.GetFiles(Root,host+"-*.bin").OrderBy(p=>p).Take(50)){
                try{entries.Add(Public(ReadUnlocked(host,Path.GetFileNameWithoutExtension(file).Substring(host.Length+1))));}catch{unreadable++;}
            }
            return new JObject{["host"]=host,["entries"]=entries,["unreadable"]=unreadable};
        });
        public static JObject Save(string host,JObject skill)=>Locked(()=>{
            Validate(host,skill);string id=(string)skill["id"]!,file=FilePath(host,id);int revision=(int)skill["revision"]!;
            if(File.Exists(file)){if((int)ReadUnlocked(host,id)["revision"]!+1!=revision)throw new OfficeFault("document_skill_changed");}
            else {if(revision!=1)throw new OfficeFault("document_skill_changed");if(Directory.Exists(Root)&&Directory.GetFiles(Root,host+"-*.bin").Length>=50)throw new OfficeFault("document_skill_limit");}
            byte[] clear=Encoding.UTF8.GetBytes(skill.ToString(Formatting.None)),encrypted;
            try{if(clear.Length>MaxBytes-4096)throw new OfficeFault("document_skill_invalid");encrypted=ProtectedData.Protect(clear,Entropy,DataProtectionScope.CurrentUser);}finally{Array.Clear(clear,0,clear.Length);}
            Directory.CreateDirectory(Root);string temp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
            try{using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(encrypted,0,encrypted.Length);stream.Flush(true);}if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file);
                var saved=ReadUnlocked(host,id);if(!JToken.DeepEquals(saved,skill))throw new OfficeFault("document_skill_unavailable");return Public(saved);
            }finally{if(File.Exists(temp))File.Delete(temp);}
        });
        public static JObject Remove(string host,string id,int revision)=>Locked(()=>{
            if((int)ReadUnlocked(host,id)["revision"]! !=revision)throw new OfficeFault("document_skill_changed");File.Delete(FilePath(host,id));return new JObject{["removed"]=true,["id"]=id};
        });
    }
}

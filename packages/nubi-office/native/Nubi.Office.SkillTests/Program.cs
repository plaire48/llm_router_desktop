using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.SkillTests
{
    public static class Program
    {
        private static readonly Assembly Host=Assembly.LoadFrom(Path.Combine(Path.GetDirectoryName(typeof(Program).Assembly.Location),"Nubi.Office.Host.dll"));
        private static readonly Type Importer=Host.GetType("Nubi.Office.Host.SkillPackageImport",true),Catalog=Host.GetType("Nubi.Office.Host.DocumentSkillCatalog",true);
        private static object Call(Type type,string name,params object[] args){try{return type.GetMethod(name,BindingFlags.Static|BindingFlags.Public|BindingFlags.NonPublic).Invoke(null,args);}catch(TargetInvocationException e){throw e.InnerException;}}
        private static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
        private static void Reject(Action action,string code){try{action();}catch(OfficeFault e){Check(e.Code==code,"Expected "+code+", got "+e.Code);return;}throw new Exception("Expected rejection: "+code);}
        private static void Zip(string path,params object[] entries){using(var stream=File.Create(path))using(var zip=new ZipArchive(stream,ZipArchiveMode.Create)){for(int i=0;i<entries.Length;i+=2){var bytes=(byte[])entries[i+1];using(var output=zip.CreateEntry((string)entries[i]).Open())output.Write(bytes,0,bytes.Length);}}}
        public static void Run(string reportPath)
        {
            string root=Path.Combine(Path.GetTempPath(),"nubi-skills-"+Guid.NewGuid().ToString("N")),folder=Path.Combine(root,"folder"),id=Guid.NewGuid().ToString("D");bool saved=false;
            var utf8=new UTF8Encoding(false);
            try{
                Directory.CreateDirectory(Path.Combine(folder,"references","nested"));Directory.CreateDirectory(Path.Combine(folder,"assets"));
                string skillText="---\nname: windows-fixture\ndescription: Native package validation\n---\nRead references/nested/data.txt.",dataText=string.Concat(Enumerable.Repeat("\uac00\ub098",10000));
                byte[] data=utf8.GetBytes(dataText),binary={0,255,1,2};
                File.WriteAllText(Path.Combine(folder,"SKILL.md"),skillText,utf8);File.WriteAllBytes(Path.Combine(folder,"references","nested","data.txt"),data);File.WriteAllBytes(Path.Combine(folder,"assets","sample.bin"),binary);
                var package=(JObject)Call(Importer,"Read",folder,"folder");string zipPath=Path.Combine(root,"wrapped.zip");
                Zip(zipPath,"wrapper/SKILL.md",utf8.GetBytes(skillText),"wrapper/references/nested/data.txt",data,"wrapper/assets/sample.bin",binary);
                var zipped=(JObject)Call(Importer,"Read",zipPath,"zip");
                Check((string)package["sha256"]==(string)zipped["sha256"],"ZIP/folder manifests differ");Check((int)package["fileCount"]==3,"Nested files lost");
                foreach(string bad in new[]{"../escape.txt","/absolute.txt","sub\\bad.txt","CON.txt","trailing."}){string path=Path.Combine(root,Guid.NewGuid()+".zip");Zip(path,"SKILL.md",utf8.GetBytes(skillText),bad,binary);Reject(()=>Call(Importer,"Read",path,"zip"),"document_skill_package_invalid");}
                var tampered=(JObject)package.DeepClone();tampered["files"][0]["data"]="AA==";Reject(()=>Call(Importer,"Validate",tampered),"document_skill_package_invalid");
                var skill=new JObject{["id"]=id,["host"]="excel",["revision"]=1,["name"]="windows-fixture",["instructions"]="Native package validation",["questions"]=new JArray(),["package"]=package.DeepClone()};
                var visible=(JObject)Call(Catalog,"Save","excel",skill);saved=true;Check(visible["package"]["files"]==null,"Catalog exposed file bodies");
                string protectedPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"NubiOffice","DocumentSkills","excel-"+id+".bin");
                byte[] clear=ProtectedData.Unprotect(File.ReadAllBytes(protectedPath),utf8.GetBytes("Nubi.Office.DocumentSkills.v1"),DataProtectionScope.CurrentUser);
                try{Check(utf8.GetString(clear)==skill.ToString(Formatting.None),"DPAPI readback differs");}finally{Array.Clear(clear,0,clear.Length);}
                Check(JToken.DeepEquals((JObject)Call(Catalog,"Read","excel",id),skill),"Stored package differs");
                Check(((JObject)Call(Catalog,"Manifest","excel",id,1))["files"].Count()==3,"Manifest missing files");
                using(var output=new MemoryStream()){int offset=0,pages=0;for(;;){var part=(JObject)Call(Catalog,"Resource","excel",id,1,(string)package["sha256"],"references/nested/data.txt",offset);byte[] bytes=Convert.FromBase64String((string)part["data"]);output.Write(bytes,0,bytes.Length);pages++;if(part["nextOffset"].Type==JTokenType.Null)break;Check(pages<10,"Resource paging loop");offset=(int)part["nextOffset"];}
                    Check(pages==2&&utf8.GetString(output.ToArray())==dataText,"Chunked UTF8 resource differs");}
                Reject(()=>Call(Catalog,"Resource","excel",id,2,(string)package["sha256"],"SKILL.md",0),"document_skill_changed");
                Reject(()=>Call(Catalog,"Read","word",id),"document_skill_missing");
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath)));
                File.WriteAllText(reportPath,new JObject{["passed"]=true,["processBitness"]=IntPtr.Size*8,["checks"]=new JArray("folder_and_wrapped_zip","nested_bytes","unsafe_paths","hash_tamper","dpapi_storage_readback","metadata_only_catalog","chunked_utf8","revision_fence","host_isolation"),["office2016Verified"]=false,["filePickerVerified"]=false}.ToString(Formatting.Indented),utf8);
            }finally{if(saved)Call(Catalog,"Remove","excel",id,1);if(Directory.Exists(root))Directory.Delete(root,true);}
        }
    }
}

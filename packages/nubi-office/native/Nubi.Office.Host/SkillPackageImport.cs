using System;
using System.Collections.Generic;
using System.IO;
using System.Globalization;
using System.IO.Compression;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal static class SkillPackageImport
    {
        internal const int MaxFile=2097152,MaxTotal=8388608,MaxCount=256;
        internal static string Hash(byte[] bytes){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant();}
        internal static void PathCheck(string path){
            if(string.IsNullOrEmpty(path)||path.Length>160||path.Split('/').Length>16||path.Any(c=>c<32||"\\:<>\"|?*".Contains(c)))throw new OfficeFault("document_skill_package_invalid");
            foreach(string part in path.Split('/'))if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||System.Text.RegularExpressions.Regex.IsMatch(part,@"^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)",System.Text.RegularExpressions.RegexOptions.IgnoreCase))throw new OfficeFault("document_skill_package_invalid");
        }
        internal static JArray Manifest(JArray files){return new JArray(files.Cast<JObject>().OrderBy(f=>(string)f["path"]!,StringComparer.Ordinal).Select(f=>new JObject{["path"]=f["path"]!.DeepClone(),["size"]=f["size"]!.DeepClone(),["sha256"]=f["sha256"]!.DeepClone()}));}
        internal static string Digest(JArray files)=>Hash(Encoding.UTF8.GetBytes(string.Concat(Manifest(files).Cast<JObject>().Select(f=>(string)f["path"]!+"\t"+((int)f["size"]!).ToString(CultureInfo.InvariantCulture)+"\t"+(string)f["sha256"]!+"\n"))));
        internal static void Validate(JObject package){
            if(package.Properties().Any(p=>!new[]{"version","files","fileCount","totalBytes","sha256"}.Contains(p.Name))||(int?)package["version"]!=1||!(package["files"] is JArray files)||files.Count<1||files.Count>MaxCount)throw new OfficeFault("document_skill_package_invalid");
            int total=0;var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach(var entry in files){
                if(!(entry is JObject f)||f.Properties().Any(p=>!new[]{"path","size","sha256","data"}.Contains(p.Name)))throw new OfficeFault("document_skill_package_invalid");
                string path=(string?)f["path"]??"";PathCheck(path);if(!paths.Add(path))throw new OfficeFault("document_skill_package_invalid");
                if(f["size"]?.Type!=JTokenType.Integer||(long?)f["size"]<0||(long?)f["size"]>MaxFile||f["data"]?.Type!=JTokenType.String||((string)f["data"]!).Length>MaxFile*2)throw new OfficeFault("document_skill_package_invalid");
                byte[] data;try{data=Convert.FromBase64String((string)f["data"]!);}catch{throw new OfficeFault("document_skill_package_invalid");}
                if(data.Length!=(int)f["size"]!||Hash(data)!=(string?)f["sha256"]||Convert.ToBase64String(data)!=(string)f["data"]!)throw new OfficeFault("document_skill_package_invalid");
                total+=data.Length;if(total>MaxTotal)throw new OfficeFault("document_skill_package_invalid");
            }
            foreach(string file in paths){var parts=file.Split('/').ToList();parts.RemoveAt(parts.Count-1);while(parts.Count>0){if(paths.Contains(string.Join("/",parts)))throw new OfficeFault("document_skill_package_invalid");parts.RemoveAt(parts.Count-1);}}
            var skill=files.Cast<JObject>().SingleOrDefault(f=>(string?)f["path"]=="SKILL.md");
            if(skill==null||(int)skill["size"]!<1||(int)skill["size"]!>60000||files.Any(f=>((string)f["path"]!).EndsWith("/SKILL.md",StringComparison.Ordinal))||Digest(files)!=(string?)package["sha256"]||(int?)package["fileCount"]!=files.Count||(int?)package["totalBytes"]!=total)throw new OfficeFault("document_skill_package_invalid");
        }
        internal static JObject? Pick(string kind,IWin32Window owner){
            string selected;
            if(kind=="zip"){using(var dialog=new OpenFileDialog{Filter="Agent Skill ZIP (*.zip)|*.zip",Multiselect=false,Title="스킬 ZIP 선택"}){if(dialog.ShowDialog(owner)!=DialogResult.OK)return null;selected=dialog.FileName;}}
            else if(kind=="folder"){using(var dialog=new FolderBrowserDialog{Description="SKILL.md가 있는 스킬 폴더를 선택하세요.",ShowNewFolderButton=false}){if(dialog.ShowDialog(owner)!=DialogResult.OK)return null;selected=dialog.SelectedPath;}}
            else throw new OfficeFault("document_skill_package_invalid");
            try{return Read(selected,kind);}catch(OfficeFault){throw;}catch{throw new OfficeFault("document_skill_package_invalid");}
        }
        // Copy bytes directly into the protected catalog. Never extract a ZIP
        // into the filesystem or follow symlinks/junctions outside the selection.
        internal static JObject Read(string selected,string kind){
            var files=new JArray();int total=0,visited=0;
            void Add(string relative,Stream stream,long length){
                PathCheck(relative);if(length<0||length>MaxFile||total+length>MaxTotal||files.Count>=MaxCount)throw new OfficeFault("document_skill_package_limit");
                using(var data=new MemoryStream()){var buffer=new byte[8192];int count;while((count=stream.Read(buffer,0,buffer.Length))>0){if(data.Length+count>length||data.Length+count>MaxFile)throw new OfficeFault("document_skill_package_limit");data.Write(buffer,0,count);}if(data.Length!=length)throw new OfficeFault("document_skill_package_invalid");
                    var bytes=data.ToArray();files.Add(new JObject{["path"]=relative,["size"]=bytes.Length,["sha256"]=Hash(bytes),["data"]=Convert.ToBase64String(bytes)});total+=bytes.Length;}
            }
            if(kind=="folder"){
                void Walk(string dir,string prefix){if((File.GetAttributes(dir)&FileAttributes.ReparsePoint)!=0)throw new OfficeFault("document_skill_package_link");
                    foreach(string item in Directory.EnumerateFileSystemEntries(dir)){if(++visited>512)throw new OfficeFault("document_skill_package_limit");string relative=prefix+Path.GetFileName(item);PathCheck(relative);var attributes=File.GetAttributes(item);if((attributes&FileAttributes.ReparsePoint)!=0)throw new OfficeFault("document_skill_package_link");
                        if((attributes&FileAttributes.Directory)!=0)Walk(item,relative+"/");else using(var stream=new FileStream(item,FileMode.Open,FileAccess.Read,FileShare.Read)){Add(relative,stream,stream.Length);}}
                }Walk(selected,"");
            }else if(kind=="zip"){
                if(new FileInfo(selected).Length>MaxTotal+1048576||(File.GetAttributes(selected)&FileAttributes.ReparsePoint)!=0)throw new OfficeFault("document_skill_package_limit");
                using(var stream=new FileStream(selected,FileMode.Open,FileAccess.Read,FileShare.Read))using(var zip=new ZipArchive(stream,ZipArchiveMode.Read)){
                    if(zip.Entries.Count>512)throw new OfficeFault("document_skill_package_limit");
                    var entries=zip.Entries.Where(e=>!e.FullName.EndsWith("/",StringComparison.Ordinal)).ToList();
                    string prefix="";if(!entries.Any(e=>e.FullName=="SKILL.md")){var roots=entries.Where(e=>e.FullName.EndsWith("/SKILL.md",StringComparison.Ordinal)).ToList();if(roots.Count!=1)throw new OfficeFault("document_skill_package_invalid");prefix=roots[0].FullName.Substring(0,roots[0].FullName.Length-8);}
                    foreach(var entry in zip.Entries){string name=entry.FullName.TrimEnd('/');PathCheck(name);int mode=(entry.ExternalAttributes>>16)&0xf000;
                        if(mode==0xa000||(entry.ExternalAttributes&0x400)!=0)throw new OfficeFault("document_skill_package_link");
                        if(entry.FullName.EndsWith("/",StringComparison.Ordinal))continue;
                        if(!entry.FullName.StartsWith(prefix,StringComparison.Ordinal))throw new OfficeFault("document_skill_package_invalid");
                        using(var input=entry.Open())Add(entry.FullName.Substring(prefix.Length),input,entry.Length);
                    }
                }
            }else throw new OfficeFault("document_skill_package_invalid");
            var package=new JObject{["version"]=1,["files"]=files,["fileCount"]=files.Count,["totalBytes"]=total,["sha256"]=Digest(files)};Validate(package);return package;
        }
    }
}

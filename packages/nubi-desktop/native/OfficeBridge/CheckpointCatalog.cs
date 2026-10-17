using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
namespace Nubi.OfficeBridge {
 // Persist metadata under the same Windows user protection as OfficeFiles bytes.
 // The existing OfficeFiles.Restore still verifies bytes and opens a new copy.
 static class CheckpointCatalog {
  static readonly string Root=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Nubi","OfficeRecovery");
  static FieldInfo Field(object files)=>files.GetType().GetField("checkpoints",BindingFlags.Instance|BindingFlags.NonPublic);
  static bool SafePath(string path){var work=Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"OfficeX","Work"))+Path.DirectorySeparatorChar;var full=Path.GetFullPath(path);if(!full.StartsWith(work,StringComparison.OrdinalIgnoreCase)||Path.GetExtension(full)!=".checkpoint"||!File.Exists(full))return false;for(var item=new FileInfo(full) as FileSystemInfo;item!=null;item=item is FileInfo?((FileInfo)item).Directory:((DirectoryInfo)item).Parent){if((item.Attributes&FileAttributes.ReparsePoint)!=0)return false;if(item.FullName.TrimEnd(Path.DirectorySeparatorChar).Equals(work.TrimEnd(Path.DirectorySeparatorChar),StringComparison.OrdinalIgnoreCase))break;}return true;}
  public static void Save(object files,string app){Directory.CreateDirectory(Root);if((File.GetAttributes(Root)&FileAttributes.ReparsePoint)!=0)throw new IOException("native_office_recovery_scope");foreach(DictionaryEntry pair in (IDictionary)Field(files).GetValue(files)){var id=Convert.ToString(pair.Key);if(!System.Text.RegularExpressions.Regex.IsMatch(id,"^[a-f0-9]{32}$"))continue;var target=Path.Combine(Root,id+".bin");if(File.Exists(target))continue;var payload=new JObject{{"app",app},{"checkpoint",JObject.FromObject(pair.Value)}};var bytes=ProtectedData.Protect(System.Text.Encoding.UTF8.GetBytes(payload.ToString(Formatting.None)),null,DataProtectionScope.CurrentUser);using(var stream=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}}}
  public static void Load(object files,string app){if(!Directory.Exists(Root))return;if((File.GetAttributes(Root)&FileAttributes.ReparsePoint)!=0)throw new IOException("native_office_recovery_scope");var dictionary=(IDictionary)Field(files).GetValue(files);var valueType=Field(files).FieldType.GetGenericArguments()[1];foreach(var file in Directory.EnumerateFiles(Root,"*.bin").OrderByDescending(File.GetLastWriteTimeUtc).Take(100)){try{var info=new FileInfo(file);if(info.Length>65536||(info.Attributes&FileAttributes.ReparsePoint)!=0)continue;var data=ProtectedData.Unprotect(File.ReadAllBytes(file),null,DataProtectionScope.CurrentUser);var item=JObject.Parse(System.Text.Encoding.UTF8.GetString(data));var value=item["checkpoint"] as JObject;var id=(string)value?["Id"];if((string)item["app"]!=app||id!=Path.GetFileNameWithoutExtension(file)||!SafePath((string)value["Path"])||dictionary.Contains(id))continue;dictionary.Add(id,value.ToObject(valueType));}catch{/* Unreadable entries grant no restore capability. */}}}
 }
}

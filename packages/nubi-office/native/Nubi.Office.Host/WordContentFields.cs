using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Xml.Linq;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed partial class WordContentDocument
    {
        // Existing inline, plain, unmapped content controls only. Mapped values
        // can change other controls; temporary controls remove their own anchor.
        private void CaptureFields(dynamic window)
        {
            using(var com=new ComObjects()){
                dynamic selection=com.Keep(window.Selection),range=com.Keep(selection.Range),controls=com.Keep(Doc.ContentControls);
                if(controls.Count>200)throw new OfficeFault("evidence_limit");
                for(int i=1;i<=controls.Count;i++){dynamic c=com.Keep(controls[i]),r=com.Keep(c.Range);if(range.StoryType==1&&r.StoryType==1&&range.Start<range.End&&range.Start<=r.Start&&range.End>=r.End)Allowed.Add("cc-"+(string)c.ID);}
            }
        }
        private XElement DocumentXml()
        {
            using(var com=new ComObjects()){
                dynamic content=com.Keep(Doc.Content);string xml=content.WordOpenXML;
                if(xml.Length>8000000)throw new OfficeFault("evidence_limit");
                return XDocument.Parse(xml).Descendants(W+"document").Single();
            }
        }
        private static string ControlId(string value)
        {
            // Word COM returns unsigned IDs; OOXML stores the same bits signed.
            if(!long.TryParse(value,NumberStyles.Integer,CultureInfo.InvariantCulture,out long id))throw new OfficeFault("unsupported_target");
            return unchecked((uint)id).ToString(CultureInfo.InvariantCulture);
        }
        private static XElement? ControlXml(XElement document,string id)=>document.Descendants(W+"sdt").SingleOrDefault(e=>{
            string? value=(string?)e.Element(W+"sdtPr")?.Element(W+"id")?.Attribute(W+"val");
            return value!=null&&ControlId(value)==ControlId(id);
        });
        private List<JObject> FieldItems(bool writable)
        {
            using(var com=new ComObjects()){
                dynamic controls=com.Keep(Doc.ContentControls);int count=controls.Count;
                if(count>200)throw new OfficeFault("evidence_limit");
                var result=new List<JObject>();if(count==0)return result;
                var xml=DocumentXml();
                for(int i=1;i<=count;i++){
                    dynamic c=com.Keep(controls[i]),range=com.Keep(c.Range),fields=com.Keep(range.Fields),bookmarks=com.Keep(range.Bookmarks);
                    string id=(string)c.ID,value=(string)range.Text;var node=ControlXml(xml,id);
                    bool nested=node==null||node.Ancestors(W+"sdt").Any()||node.Descendants(W+"sdt").Any();
                    bool locked=(bool)c.LockContents,temporary=(bool)c.Temporary,plain=(int)c.Type==1;bool? mapped=null;
                    if(plain){dynamic mapping=com.Keep(c.XMLMapping);mapped=(bool)mapping.IsMapped;}
                    bool safe=writable&&plain&&!(bool)c.MultiLine&&!nested&&mapped==false&&!locked&&!temporary&&range.StoryType==1&&fields.Count==0&&bookmarks.Count==0&&value.Length<=4000&&!value.Any(char.IsControl);
                    var item=new JObject{["id"]="cc-"+id,["kind"]="field",["title"]=(string)c.Title,["tag"]=(string)c.Tag,["controlType"]=(int)c.Type,["text"]=value.Length>4000?value.Substring(0,4000):value,["showingPlaceholder"]=(bool)c.ShowingPlaceholderText,["mapped"]=mapped.HasValue?(JToken)mapped.Value:JValue.CreateNull(),["locked"]=locked,["temporary"]=temporary,["nested"]=nested,["editable"]=safe&&Allowed.Contains("cc-"+id)};
                    // Preserve existing short-field snapshots; boundary text needs explicit coverage.
                    if(value.Length>=4000){item["truncated"]=value.Length>4000;item["textLength"]=value.Length;if(value.Length>4000)item["textHash"]=Hash(value);}
                    result.Add(item);
                }
                return result;
            }
        }
        private string ProtectedFieldFingerprint(string id)
        {
            var xml=DocumentXml();var control=ControlXml(xml,id)??throw new OfficeFault("unsupported_target");
            var content=control.Element(W+"sdtContent")??throw new OfficeFault("unsupported_target");
            content.RemoveNodes();content.Add(new XElement(W+"t","NUBI_FIELD_VALUE"));
            control.Element(W+"sdtPr")?.Element(W+"showingPlcHdr")?.Remove();
            // Session IDs and proof/layout caches are not author formatting.
            foreach(var a in xml.DescendantsAndSelf().Attributes().Where(a=>a.Name.Namespace==W&&a.Name.LocalName.StartsWith("rsid",StringComparison.Ordinal)).ToList())a.Remove();
            foreach(var e in xml.Descendants().Where(e=>e.Name==W+"proofErr"||e.Name==W+"lastRenderedPageBreak").ToList())e.Remove();
            foreach(var e in xml.DescendantsAndSelf()){var attrs=e.Attributes().OrderBy(a=>a.Name.ToString(),StringComparer.Ordinal).ToArray();e.ReplaceAttributes(attrs);}
            return Hash(xml.ToString(SaveOptions.DisableFormatting));
        }
        private JObject FillField(JObject operation)
        {
            string target=(string)operation["targetId"]!,id=target.Substring(3),before=ProtectedFieldFingerprint(id);
            using(var com=new ComObjects()){
                dynamic controls=com.Keep(Doc.ContentControls);
                for(int i=1;i<=controls.Count;i++){
                    dynamic c=com.Keep(controls[i]);if((string)c.ID!=id)continue;
                    dynamic range=com.Keep(c.Range);range.Text=(string)operation["text"]!;
                    return new JObject{["targetId"]=target,["protectedFingerprint"]=before};
                }
            }
            throw new OfficeFault("unsupported_target");
        }
        private JArray CheckField(JObject operation,JObject expected,List<JObject> after)
        {
            string id=(string)expected["targetId"]!;var field=after.FirstOrDefault(i=>(string?)i["id"]==id&&(string?)i["kind"]=="field");
            string? value=(bool?)field?["showingPlaceholder"]==true?"":(string?)field?["text"];
            return new JArray(CheckResult("입력칸 값",field!=null&&value==(string?)operation["text"]),CheckResult("입력칸 설정과 주변 문서 XML 보존",field!=null&&ProtectedFieldFingerprint(id.Substring(3))==(string?)expected["protectedFingerprint"]));
        }
    }
}

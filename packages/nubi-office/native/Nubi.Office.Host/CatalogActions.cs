using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Nubi.Office.Core;

namespace Nubi.Office.Host
{
    internal sealed class CatalogActions
    {
        private readonly Dictionary<string,JObject> receipts=new Dictionary<string,JObject>();
        private readonly Dictionary<string,string> signatures=new Dictionary<string,string>();
        public JObject Receipt(string id)=>receipts.TryGetValue(id,out var value)?(JObject)value.DeepClone():new JObject{["outcome"]="not_executed"};
        public JToken Execute(string method,JObject payload,Func<JToken> perform)=>ExecuteAsync(method,payload,()=>Task.FromResult(perform())).GetAwaiter().GetResult();
        public async Task<JToken> ExecuteAsync(string method,JObject payload,Func<Task<JToken>> perform)
        {
            string id=(string?)payload["operationId"]??"";
            if(!Guid.TryParse(id,out _))throw new OfficeFault("invalid_request");
            string signature=ContentDocument.Hash(method+payload.ToString(Formatting.None));
            if(receipts.TryGetValue(id,out var previous)){
                if(signatures[id]!=signature)throw new OfficeFault("operation_collision");
                if((string?)previous["outcome"]!="applied")throw new OfficeFault("write_uncertain");
                return previous["result"]!.DeepClone();
            }
            if(receipts.Count>=512)throw new OfficeFault("receipt_limit");
            signatures.Add(id,signature);receipts.Add(id,new JObject{["outcome"]="uncertain"});
            var result=await perform();receipts[id]=new JObject{["outcome"]="applied",["result"]=result.DeepClone()};return result;
        }
    }
}

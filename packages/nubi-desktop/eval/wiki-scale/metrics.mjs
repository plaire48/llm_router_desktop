export function summarizeMap(map){
  let supportedLanguageFiles=0,unsupportedLanguageFiles=0,parsedAvailableFiles=0,definitions=0,parseErrorFiles=0;
  const unavailableReasons={};
  for(const row of Object.values(map.files)){
    if(row.language)supportedLanguageFiles++;else unsupportedLanguageFiles++;
    if(row.unavailable)unavailableReasons[row.unavailable]=(unavailableReasons[row.unavailable]||0)+1;
    if(row.parseError)parseErrorFiles++;
    if(row.language&&!row.unavailable&&!row.parseError&&!row.generated)parsedAvailableFiles++;
    definitions+=row.definitions?.length||0;
  }
  return {...map.summary,supportedLanguageFiles,unsupportedLanguageFiles,parsedAvailableFiles,
    definitions,unavailableReasons,parseErrorFiles};
}
export function summarizeBaseline({inventory,map,mapMs,peakRssBytes}){
  return {inventory:{files:inventory.paths.length,truncated:inventory.truncated,excluded:inventory.excluded},
    map:summarizeMap(map),mapMs,peakRssBytes,modelCalls:0,
    deterministicTargets:{mapUnderTwoMinutes:mapMs<=120000,rssUnderOneGiB:peakRssBytes<=1024**3,inventoryComplete:!inventory.truncated},
    modelInitialization:{status:'not_measured',reason:'deterministic_baseline_only',elapsedMs:null,pages:null,cost:null},
    answerQuality:{status:'not_measured',questions:240,recallAt5:null,citationAccuracy:null},
    releaseAccepted:false};
}

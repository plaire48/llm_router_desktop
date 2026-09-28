// Deterministic fixture-user responses, separate from the agent and its model.
// Unknown/repeated questions or broader mappings require a real person.
export function fixtureInteraction(testCase) {
  const answered=new Set();
  return action=>{
    if(action.name==='request_input'){
      const candidates=(testCase.dialogue||[]).map((item,index)=>({...item,index})).filter(item=>!answered.has(item.index)&&new RegExp(item.match,'iu').test(action.payload?.text||''));
      if(candidates.length!==1)return;
      answered.add(candidates[0].index);return{text:candidates[0].answer};
    }
    if(action.name!=='request_approval')return;
    if(action.payload?.kind==='save'&&testCase.mode==='document'&&testCase.approvals?.includes('save'))return{approved:true};
    if(action.payload?.kind==='template_mapping'&&testCase.mode==='template'&&testCase.templateFields?.length){
      const actual=action.payload.fields;
      if(!Array.isArray(actual)||actual.length!==testCase.templateFields.length)return;
      const seen=new Set();
      for(const field of actual){
        if(seen.has(field.address))return;seen.add(field.address);
        const expected=testCase.templateFields.find(item=>item.address===field.address);
        if(!expected||field.valueType!==expected.valueType||field.required!==expected.required)return;
      }
      return{approved:true};
    }
  };
}

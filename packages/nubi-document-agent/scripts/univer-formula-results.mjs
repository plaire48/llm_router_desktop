// Univer 0.25.1 flattens both ErrorValueObject and StringValueObject to t=STRING.
// Observe its public runtime sink before that conversion; never infer errors
// from display text, and do not change calculation or the values passed on.
export function trackFormulaErrors(service){
 const original=service.setRuntimeData,errors=new Map();
 service.setRuntimeData=function(value){const key=`${this.currentSubUnitId}:${this.currentRow}:${this.currentColumn}`;let scalar=value;if(scalar?.isReferenceObject?.())scalar=scalar.toArrayValueObject();if(scalar?.isArray?.())scalar=scalar.get(0,0);if(scalar?.isError?.())errors.set(key,scalar.getErrorType());else errors.delete(key);return original.call(this,value);};
 return{errors,dispose(){service.setRuntimeData=original;errors.clear();}};
}

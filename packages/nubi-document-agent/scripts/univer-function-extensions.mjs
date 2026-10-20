// Reuse the installed implementations for Excel's alternate spellings.
export function existingFunctionAliases(implementations){
 return [['ISO.CEILING','CEILING.PRECISE'],['JIS','DBCS']].map(([alias,name])=>{const source=implementations.find(([,id])=>id===name);if(!source)throw Error('editor_function_implementation_missing');return[source[0],alias];});
}
// Currency display padding belongs to a cell renderer, not the string DOLLAR
// returns. Retain the original conversion, rounding, locale and array handling.
export function currencyStringFunction(api){
 const original=api.ALL_IMPLEMENTED_FUNCTIONS.find(([,name])=>name==='DOLLAR')?.[0];if(!original)throw Error('editor_function_implementation_missing');
 return class CurrencyString extends original{calculate(...args){const result=super.calculate(...args),clean=value=>value?.isString?.()?api.StringValueObject.create(value.getValue().trimEnd()):value;return result?.isArray?.()?result.mapValue(clean):clean(result);}};
}

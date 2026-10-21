// Settings may lower these safety bounds; large-mail FTS waits for its own approval.
export function mailSearchBudget(store){
 const positive=(value,fallback)=>Number.isSafeInteger(value)&&value>0?Math.min(value,fallback):fallback;
 return {maxCount:positive(store.get('setting:mail-search-max-count'),20000),maxBytes:positive(store.get('setting:mail-search-max-bytes'),200*1024*1024)};
}

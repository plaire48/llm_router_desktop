import React from 'react';
import './collection-table.css';

// Approval is the reference. Keep sorting, selection, widths and data ownership
// in each screen; share presentation without adding new fetches or pagination.
export function CollectionTable({className='',variant='collection',children,...props}){
 return <table {...props} className={`nubi-collection-table ${className}`.trim()} data-kind={variant}>{children}</table>;
}

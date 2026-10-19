// Message DOM order is chronological. Avoid materializing the skipped layout
// of every older row just to retain the current reading position on prepend.
export function firstVisibleMessage(rows,top){
 let low=0,high=rows.length;
 while(low<high){const middle=(low+high)>>>1;if(rows[middle].getBoundingClientRect().bottom>top)high=middle;else low=middle+1;}
 return rows[low]||null;
}

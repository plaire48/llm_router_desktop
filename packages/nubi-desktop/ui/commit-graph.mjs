// Incremental lane layout for topologically ordered Git commits. Only pending
// parents cross a page boundary; no file contents or complete log are required.
export function commitGraphPage(commits, previous = {lanes:[], nextColor:0}) {
  let lanes = previous.lanes.map(lane => lane && {...lane});
  let nextColor = previous.nextColor;
  let columns = Math.max(1, lanes.length);
  const rows = commits.map(commit => {
    const before = lanes.map(lane => lane && {...lane});
    let column = lanes.findIndex(lane => lane?.id === commit.id);
    const incoming = column !== -1;
    if (!incoming) {
      column = lanes.indexOf(null);
      if (column === -1) column = lanes.length;
      lanes[column] = {id:commit.id, color:nextColor++};
    }
    const color = lanes[column].color;
    const edges = before.flatMap((lane, index) => lane && index !== column
      ? [{from:index, to:index, color:lane.color, kind:'through'}] : []);
    if (incoming) edges.push({from:column, to:column, color, kind:'incoming'});
    lanes[column] = null;
    const parents = [...new Set(commit.parents || [])];
    for (const [index, id] of parents.entries()) {
      let target = lanes.findIndex(lane => lane?.id === id);
      if (target === -1) {
        target = index === 0 ? column : lanes.indexOf(null);
        if (target === -1) target = lanes.length;
        lanes[target] = {id, color:index === 0 ? color : nextColor++};
      }
      edges.push({from:column, to:target, color:lanes[target].color, kind:'outgoing'});
    }
    columns = Math.max(columns, column + 1, lanes.length, before.length);
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    return {id:commit.id, column, color, edges, merge:parents.length > 1};
  });
  return {rows, columns, next:{lanes, nextColor}};
}

import React from 'react';

const colours = ['var(--deck-blue)', 'var(--nubi-text-success)', 'var(--nubi-text-warning)', 'var(--deck-sub)'];
const ink = color => colours[color % colours.length];
export function CommitGraph({row, columns}) {
  const width = columns * 16 + 8, x = column => column * 16 + 12;
  return <span className="desktop-commit-graph" style={{width}} aria-hidden="true" data-merge={row.merge}>
    <svg viewBox={`0 0 ${width} 100`} preserveAspectRatio="none">
      {row.edges.map((edge, index) => {
        const start = edge.kind === 'outgoing' ? 50 : 0;
        const end = edge.kind === 'incoming' ? 50 : 100;
        const d = edge.from === edge.to ? `M ${x(edge.from)} ${start} V ${end}`
          : `M ${x(edge.from)} ${start} C ${x(edge.from)} 78 ${x(edge.to)} 72 ${x(edge.to)} ${end}`;
        return <path key={index} d={d} stroke={ink(edge.color)} vectorEffect="non-scaling-stroke"/>;
      })}
    </svg>
    <span className="desktop-commit-node" style={{left:`${x(row.column)/width*100}%`, '--commit-ink':ink(row.color)}}/>
  </span>;
}

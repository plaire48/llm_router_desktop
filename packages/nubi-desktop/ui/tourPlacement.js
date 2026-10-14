// Where the first-run tour card goes (2026-10-14).
const GAP=12,MARGIN=16,CARD_W=320,CARD_H=170;
// Right, below, left or above, whichever has room first; always clamped inside the window.
export function placeCard(spot,viewport={width:globalThis.innerWidth,height:globalThis.innerHeight},card={width:CARD_W,height:CARD_H}){
  const room={right:viewport.width-(spot.left+spot.width)-GAP-MARGIN,below:viewport.height-(spot.top+spot.height)-GAP-MARGIN,left:spot.left-GAP-MARGIN,above:spot.top-GAP-MARGIN};
  const clampX=x=>Math.max(MARGIN,Math.min(x,viewport.width-card.width-MARGIN)),clampY=y=>Math.max(MARGIN,Math.min(y,viewport.height-card.height-MARGIN));
  if(room.right>=card.width)return {left:clampX(spot.left+spot.width+GAP),top:clampY(spot.top)};
  if(room.below>=card.height)return {left:clampX(spot.left+spot.width-card.width),top:clampY(spot.top+spot.height+GAP)};
  if(room.left>=card.width)return {left:clampX(spot.left-GAP-card.width),top:clampY(spot.top)};
  if(room.above>=card.height)return {left:clampX(spot.left),top:clampY(spot.top-GAP-card.height)};
  return {left:clampX((viewport.width-card.width)/2),top:clampY((viewport.height-card.height)/2)};
}

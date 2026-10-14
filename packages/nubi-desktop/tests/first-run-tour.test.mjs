import test from 'node:test';
import assert from 'node:assert/strict';
import {placeCard} from '../ui/tourPlacement.js';

// The tour card stays inside the window beside the control it explains (user report 2026-10-14: it sat above the top
// edge when it pointed at the full-height left rail).
test('the card goes beside a tall left rail, below the top-right icons, and always inside the window',()=>{
  const viewport={width:1480,height:960},inside=card=>card.left>=16&&card.top>=16&&card.left+320<=viewport.width-16&&card.top+170<=viewport.height-16;
  const rail=placeCard({left:-6,top:40,width:84,height:928},viewport);
  assert.ok(inside(rail),JSON.stringify(rail));assert.ok(rail.left>=78,'to the right of the rail');
  const icons=placeCard({left:1140,top:6,width:330,height:44},viewport);
  assert.ok(inside(icons),JSON.stringify(icons));assert.ok(icons.top>=50,'below the icons');
  const whole=placeCard({left:0,top:0,width:1480,height:960},viewport);assert.ok(inside(whole),JSON.stringify(whole));
});

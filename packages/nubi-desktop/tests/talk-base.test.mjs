import {test} from 'node:test';
import assert from 'node:assert/strict';
import {talkBase} from '../ui/ai-workspace/hostFetch.js';
import {talkPermalink} from '../ui/ai-workspace/talkModel.js';
import {GHES_CONFIG} from '../ui/ai-workspace/config.js';
// Inside Nubi Workspace the screens are not served from a web address; Talk permalinks then point at the published
// AI Workspace site instead of throwing '게시판 주소를 확인하세요' (user report 2026-10-15).
test('the permalink base is the page when it is a web address, else the published site, and never throws',()=>{
  const original=globalThis.location;
  try{
    globalThis.location={href:'file:///C:/Program%20Files/Nubi/resources/app/index.html'};
    assert.equal(talkBase(),GHES_CONFIG.siteUrl);assert.match(GHES_CONFIG.siteUrl,/^https:\/\//);
    assert.match(talkPermalink(talkBase(),'12'),/^https:\/\/.*#talk=12$/);
    globalThis.location={href:'https://code.example.com/pages/team/app/'};
    assert.equal(talkBase(),'https://code.example.com/pages/team/app/');
    delete globalThis.location;
    assert.equal(talkBase(),GHES_CONFIG.siteUrl);
  }finally{if(original===undefined)delete globalThis.location;else globalThis.location=original;}
});

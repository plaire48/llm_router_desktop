// A menu button that cannot be used says why (design light-flow §1.1: buttons were silently dead without a project).
import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationTitle} from '../ui/navigation-reason.mjs';
test('a disabled project tool explains itself, an enabled one keeps its own title',()=>{
 assert.equal(navigationTitle({disabled:true,title:'프로젝트 파일 열기'}),'프로젝트를 열면 쓸 수 있어요');
 assert.equal(navigationTitle({disabled:false,title:'프로젝트 파일 열기'}),'프로젝트 파일 열기');
});

import {test} from 'node:test';import assert from 'node:assert/strict';
import {workflowIssueMessage} from '../ui/workflow-presentation.mjs';
test('known validation failures have actionable Korean explanations',()=>{assert.match(workflowIssueMessage('workflow_schema'),/형식/);assert.match(workflowIssueMessage('workflow_done_when_unobservable'),/완료/);});
test('unknown diagnostic values never become visible error copy',()=>{for(const code of ['workflow_future_code','private arbitrary payload','__proto__','constructor','']){const text=workflowIssueMessage(code);assert.doesNotMatch(text,/workflow_|private arbitrary payload/);assert.match(text,/[가-힣]/);}});

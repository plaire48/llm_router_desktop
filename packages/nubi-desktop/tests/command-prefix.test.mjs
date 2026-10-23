import test from 'node:test';import assert from 'node:assert/strict';
import {commandPrefix,allowPattern,wildcardMatch} from '../runtime/command-prefix.mjs';

test('the opencode arity table keeps the subcommand that decides what a command does',()=>{
 assert.deepEqual(commandPrefix(['git','status','--short']),['git','status']);
 assert.deepEqual(commandPrefix(['npm','run','build','--','--watch']),['npm','run','build']);
 assert.deepEqual(commandPrefix(['docker','compose','up','-d']),['docker','compose','up']);
 assert.deepEqual(commandPrefix(['ls','-la','src']),['ls']);
 assert.deepEqual(commandPrefix(['rm','-rf','dist']),['rm']);
 assert.deepEqual(commandPrefix(['mytool','sub','arg']),['mytool']);
 assert.deepEqual(commandPrefix(['git']),['git']);
});

test('an always-allow pattern is the prefix followed by a wildcard',()=>{
 assert.equal(allowPattern(['git','status','--short']),'git status *');
 assert.equal(allowPattern(['npm','run','test']),'npm run test *');
});

test('a trailing " *" also matches the bare prefix, never a longer word',()=>{
 assert.equal(wildcardMatch('git status','git status *'),true);
 assert.equal(wildcardMatch('git status --short','git status *'),true);
 assert.equal(wildcardMatch('git statusx','git status *'),false);
 assert.equal(wildcardMatch('git push origin main','git status *'),false);
 assert.equal(wildcardMatch('npm run test:unit','npm run test *'),false);
});

test('wildcard patterns escape regular expression characters',()=>{
 assert.equal(wildcardMatch('a.b','a.b'),true);
 assert.equal(wildcardMatch('axb','a.b'),false);
 assert.equal(wildcardMatch('echo (x)','echo (x)'),true);
 assert.equal(wildcardMatch('file1.txt','file?.txt'),true);
});

test('Windows matching ignores case and treats backslashes as slashes',()=>{
 assert.equal(wildcardMatch('Git Status','git status *',{windows:true}),true);
 assert.equal(wildcardMatch('Git Status','git status *',{windows:false}),false);
 assert.equal(wildcardMatch('dir C:\\work','dir C:/work',{windows:true}),true);
});

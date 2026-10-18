import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile, mkdir, mkdtemp, readFile, rm, stat, utimes} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('preparing the same app icon twice preserves its modification time', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nubi-app-icon-'));
  try {
    // Mirror the build layout without touching the working tree's icon.
    const script = path.join(root, 'packages/nubi-desktop/scripts/prepare-app-icon.mjs');
    const source = path.join(root, 'extensions/aipro-chat/design/brand/bird-master.png');
    await mkdir(path.dirname(script), {recursive: true});
    await mkdir(path.dirname(source), {recursive: true});
    await copyFile(new URL('../scripts/prepare-app-icon.mjs', import.meta.url), script);
    await copyFile(new URL('../../../extensions/aipro-chat/design/brand/bird-master.png', import.meta.url), source);
    const {prepareAppIcon} = await import(pathToFileURL(script).href);
    const target = await prepareAppIcon();
    assert.deepEqual(await readFile(target), await readFile(source));
    // A fixed past timestamp detects a rewrite even on coarse-resolution filesystems.
    const earlier = new Date('2020-01-01T00:00:00Z');
    await utimes(target, earlier, earlier);
    const before = await stat(target, {bigint: true});
    assert.equal(await prepareAppIcon(), target);
    assert.equal((await stat(target, {bigint: true})).mtimeNs, before.mtimeNs);
    assert.deepEqual(await readFile(target), await readFile(source));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

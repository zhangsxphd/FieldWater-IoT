import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from './db.js';
import { backupDatabase, restoreBackup } from './backup.js';

test('online SQLite backup and restore preserve records; refuse overwrite and corrupt manifests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fieldwater-backup-test-'));
  const source = join(dir, 'source.sqlite'), backup = join(dir, 'backup.sqlite'), restored = join(dir, 'restored.sqlite');
  const db = openDatabase(source);
  try {
    db.pragma('journal_mode = WAL');
    db.prepare('INSERT INTO gateways(id,name) VALUES (?,?)').run('isolated-gateway', 'Isolated test only');
    const manifest = await backupDatabase(source, backup);
    assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
    assert.ok(manifest.schema_versions.length >= 3);
    db.prepare('UPDATE gateways SET name=?').run('Later local change');
    await restoreBackup(backup, restored);
    const copy = new Database(restored, { readonly: true });
    try { assert.equal(copy.prepare('SELECT name FROM gateways').get().name, 'Isolated test only'); } finally { copy.close(); }
    const previous = readFileSync(restored);
    await assert.rejects(restoreBackup(backup, restored), /EEXIST/);
    assert.deepEqual(readFileSync(restored), previous);
    assert.equal(db.prepare('SELECT name FROM gateways').get().name, 'Later local change');
    writeFileSync(backup + '.manifest.json', JSON.stringify({ ...manifest, sha256: 'changed' }));
    await assert.rejects(restoreBackup(backup, join(dir, 'bad.sqlite')), /SHA-256/);
    await assert.rejects(backupDatabase(source, source), /相同/);
    await assert.rejects(backupDatabase(join(dir, 'absent.sqlite'), join(dir, 'new.sqlite')));
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});

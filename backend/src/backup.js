import Database from 'better-sqlite3';
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const checksum = file => createHash('sha256').update(readFileSync(file)).digest('hex');
function inspect(db) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok') throw Error('数据库完整性检查失败');
  if (db.pragma('foreign_key_check').length) throw Error('数据库外键检查失败');
  const hasVersions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get();
  if (!hasVersions) throw Error('不是带迁移记录的 FieldWater 数据库');
  for (const name of ['gateways', 'sensors', 'telemetry_raw', 'telemetry_measurements']) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)) throw Error('缺少 FieldWater 核心数据表');
  }
  return db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version);
}

// Never opens the source with migrations, never overwrites a destination.
export async function backupDatabase(source, destination) {
  const src = resolve(source), dst = resolve(destination);
  if (src === dst) throw Error('备份路径不能与源数据库相同');
  const db = new Database(src, { readonly: true, fileMustExist: true });
  let reserved = false, manifestReserved = false;
  try {
    inspect(db);
    closeSync(openSync(dst, 'wx', 0o600)); reserved = true;
    closeSync(openSync(dst + '.manifest.json', 'wx', 0o600)); manifestReserved = true;
    await db.backup(dst);
    chmodSync(dst, 0o600);
    const copy = new Database(dst, { readonly: true, fileMustExist: true });
    let versions;
    try { versions = inspect(copy); } finally { copy.close(); }
    const manifest = { format: 'fieldwater-sqlite-backup-v1', created_at: new Date().toISOString(), schema_versions: versions, sha256: checksum(dst) };
    writeFileSync(dst + '.manifest.json', JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return manifest;
  } catch (error) {
    if (manifestReserved) unlinkSync(dst + '.manifest.json');
    if (reserved) unlinkSync(dst);
    throw error;
  } finally { db.close(); }
}

export async function restoreBackup(source, destination) {
  const manifest = JSON.parse(readFileSync(resolve(source) + '.manifest.json', 'utf8'));
  if (manifest.format !== 'fieldwater-sqlite-backup-v1' || manifest.sha256 !== checksum(resolve(source)))
    throw Error('备份清单格式或 SHA-256 校验失败');
  // Restore to a NEW path; selecting it for service startup is a separate explicit step.
  return backupDatabase(source, destination);
}

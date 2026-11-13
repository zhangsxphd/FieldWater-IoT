import { backupDatabase, restoreBackup } from '../src/backup.js';
const [command, source, destination, ...extra] = process.argv.slice(2);
if (!['backup', 'restore'].includes(command) || !source || !destination || extra.length) {
  console.error('用法: node backend/scripts/database-backup.js backup|restore <源文件> <新的目标文件>');
  process.exitCode = 1;
} else {
  try {
    const manifest = await (command === 'backup' ? backupDatabase : restoreBackup)(source, destination);
    console.log(JSON.stringify({ destination, ...manifest }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

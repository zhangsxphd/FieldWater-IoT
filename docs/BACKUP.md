# 本地数据库备份与恢复

使用 SQLite Online Backup API 备份运行中的独立 FieldWater 数据库。命令不会对源库执行迁移，不覆盖已有文件，不自动切换服务数据库。默认数据路径请先核实启动时的 `FIELDWATER_DB`，不要指向 LanSense。

从项目根目录执行，目标目录应预先存在：

```sh
node backend/scripts/database-backup.js backup backend/data/fieldwater.sqlite /你的备份目录/fieldwater-日期.sqlite
node backend/scripts/database-backup.js restore /你的备份目录/fieldwater-日期.sqlite /你的恢复目录/fieldwater-restored.sqlite
```

备份同时生成 `.manifest.json`，保存 SHA-256、创建时间和迁移版本。备份前后检查完整性和外键；恢复先核对清单与文件校验值，再写入**新的路径**。恢复文件可在独立环境复核，确认后自行通过 `FIELDWATER_DB` 选择；本工具不会停止服务、覆盖正在使用的数据库或删除历史数据。

数据库及其清单都应存储在本地受控目录，不提交 GitHub；创建文件权限为仅当前用户读写。校验值用于发现文件损坏，不替代访问控制或真实性签名。

自动化测试 `node --test backend/src/backup.test.js` 使用临时目录，验证打开中的 WAL 数据库备份、恢复内容、拒绝覆盖、清单损坏和源文件缺失，结束后清理自身测试文件。

技术依据：[SQLite Online Backup API](https://www.sqlite.org/backup.html)、[better-sqlite3 backup](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise)。

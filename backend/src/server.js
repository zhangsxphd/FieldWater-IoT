import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";
import { evaluateAlarms } from "./alarms.js";

const db = openDatabase(
  process.env.FIELDWATER_DB || "./data/fieldwater.sqlite",
);
const app = buildApp(db);
const alarmTimer = setInterval(() => {
  try { evaluateAlarms(db); } catch (error) { app.log.error(error, "Local alarm evaluation failed"); }
}, 30000);
alarmTimer.unref();
app.addHook("onClose", async () => { clearInterval(alarmTimer); db.close(); });
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => { await app.close(); });
try {
  await app.listen({
    host: "127.0.0.1",
    port: Number(process.env.PORT || 3181),
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await app.close();
}

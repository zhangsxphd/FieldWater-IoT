import { openDatabase } from "./db.js";
import { buildApp } from "./app.js";

const db = openDatabase(
  process.env.FIELDWATER_DB || "./data/fieldwater.sqlite",
);
const app = buildApp(db);
app.addHook("onClose", async () => db.close());
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

import { createExperiment, listExperiments, createPlot, listPlots,
  createInstallation, listInstallations, closeInstallation } from "./research.js";
import { listAlarms, acknowledgeAlarm, addAlarmNote } from "./alarms.js";
import { listAudit } from "./audit.js";

export function registerOperationsRoutes(app, db) {
  app.get("/api/experiments", async () => listExperiments(db));
  app.post("/api/experiments", async (req, reply) => reply.code(201).send(createExperiment(db, req.body)));
  app.get("/api/plots", async (req) => listPlots(db, req.query));
  app.post("/api/plots", async (req, reply) => reply.code(201).send(createPlot(db, req.body)));
  app.get("/api/installations", async (req) => listInstallations(db, req.query));
  app.post("/api/installations", async (req, reply) => reply.code(201).send(createInstallation(db, req.body)));
  app.post("/api/installations/:id/close", async (req) => closeInstallation(db, req.params.id, req.body));
  app.get("/api/alarms", async (req) => listAlarms(db, req.query));
  app.post("/api/alarms/:id/ack", async (req) => acknowledgeAlarm(db, req.params.id, req.body));
  app.post("/api/alarms/:id/notes", async (req) => addAlarmNote(db, req.params.id, req.body));
  app.get("/api/audit", async (req) => listAudit(db, req.query));
}

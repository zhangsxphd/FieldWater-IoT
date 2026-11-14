// Called as migration 5 after the measurement/profile schema. Safe to inspect again in tests.
export function migrateOperations(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sensor_installations'").get()) return;
  db.transaction(() => db.exec(`
    CREATE TABLE experiments (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE plots (
      id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL REFERENCES experiments(id),
      name TEXT NOT NULL, treatment TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX idx_plots_experiment ON plots(experiment_id);
    CREATE TABLE sensor_installations (
      id INTEGER PRIMARY KEY, sensor_id TEXT NOT NULL REFERENCES sensors(id),
      plot_id TEXT NOT NULL REFERENCES plots(id), start_at TEXT NOT NULL,
      end_at TEXT, created_at TEXT NOT NULL,
      CHECK(end_at IS NULL OR end_at > start_at)
    );
    CREATE INDEX idx_installations_sensor_time ON sensor_installations(sensor_id,start_at,end_at);
    CREATE TRIGGER installation_identity_immutable BEFORE UPDATE ON sensor_installations
    WHEN NEW.sensor_id != OLD.sensor_id OR NEW.plot_id != OLD.plot_id OR NEW.start_at != OLD.start_at
      OR OLD.end_at IS NOT NULL OR NEW.end_at IS NULL
    BEGIN SELECT RAISE(ABORT,'installation history is immutable'); END;
    CREATE TRIGGER installation_no_overlap BEFORE INSERT ON sensor_installations
    WHEN EXISTS (SELECT 1 FROM sensor_installations i WHERE i.sensor_id=NEW.sensor_id
      AND (i.end_at IS NULL OR NEW.start_at<i.end_at)
      AND (NEW.end_at IS NULL OR i.start_at<NEW.end_at))
    BEGIN SELECT RAISE(ABORT,'installation intervals overlap'); END;
    CREATE TABLE operation_audit (
      id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
      actor TEXT NOT NULL, source TEXT NOT NULL, before_json TEXT, after_json TEXT
    );
    CREATE INDEX idx_audit_entity ON operation_audit(entity_type,entity_id,id DESC);
    ALTER TABLE alarms ADD COLUMN condition_key TEXT;
    ALTER TABLE alarms ADD COLUMN kind TEXT;
    ALTER TABLE alarms ADD COLUMN acknowledged_at TEXT;
    ALTER TABLE alarms ADD COLUMN resolved_at TEXT;
    ALTER TABLE alarms ADD COLUMN raw_id INTEGER REFERENCES telemetry_raw(id);
    ALTER TABLE alarms ADD COLUMN event_id INTEGER REFERENCES device_events(id);
    CREATE UNIQUE INDEX idx_alarm_active_condition ON alarms(condition_key)
      WHERE condition_key IS NOT NULL AND resolved_at IS NULL;
    CREATE TABLE alarm_actions (
      id INTEGER PRIMARY KEY, alarm_id INTEGER NOT NULL REFERENCES alarms(id),
      action TEXT NOT NULL, occurred_at TEXT NOT NULL, note TEXT NOT NULL,
      actor TEXT NOT NULL, raw_id INTEGER REFERENCES telemetry_raw(id),
      event_id INTEGER REFERENCES device_events(id)
    );
    CREATE INDEX idx_alarm_actions_alarm ON alarm_actions(alarm_id,id);
  `))();
}

import Database from "better-sqlite3";
import { migrateOperations } from "./operations-schema.js";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Migration 1 also adopts databases created by the initial pre-migration release.
const migrations = [
  (db) =>
    db.exec(`
    CREATE TABLE IF NOT EXISTS gateways (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS sensors (id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL REFERENCES gateways(id), type TEXT NOT NULL CHECK(type IN ('water_level','electromagnetic_flow','rainfall')), name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_sensors_gateway ON sensors(gateway_id);
  `),
  (db) =>
    db.exec(`
    ALTER TABLE gateways ADD COLUMN transport TEXT;
    ALTER TABLE gateways ADD COLUMN timeout_seconds INTEGER CHECK(timeout_seconds IS NULL OR timeout_seconds > 0);
    ALTER TABLE sensors ADD COLUMN manufacturer TEXT;
    ALTER TABLE sensors ADD COLUMN model TEXT;
    ALTER TABLE sensors ADD COLUMN location TEXT;
    ALTER TABLE sensors ADD COLUMN unit TEXT;
    ALTER TABLE sensors ADD COLUMN notes TEXT;
    CREATE TABLE telemetry_raw (
      id INTEGER PRIMARY KEY, gateway_id TEXT NOT NULL, sensor_id TEXT, message_id TEXT,
      raw_payload BLOB NOT NULL, received_at TEXT NOT NULL, device_timestamp TEXT,
      transport TEXT NOT NULL, source TEXT NOT NULL, parse_status TEXT NOT NULL,
      parse_error TEXT
    );
    CREATE UNIQUE INDEX idx_raw_message ON telemetry_raw(gateway_id, message_id) WHERE message_id IS NOT NULL;
    CREATE INDEX idx_raw_sensor_time ON telemetry_raw(sensor_id, received_at DESC);
    CREATE TABLE telemetry_measurements (
      id INTEGER PRIMARY KEY, raw_id INTEGER NOT NULL REFERENCES telemetry_raw(id),
      sensor_id TEXT NOT NULL REFERENCES sensors(id), measurement_code TEXT NOT NULL,
      value REAL NOT NULL, unit TEXT NOT NULL, measured_at TEXT, received_at TEXT NOT NULL,
      quality_status TEXT NOT NULL, source TEXT NOT NULL
    );
    CREATE INDEX idx_measurements_sensor_time ON telemetry_measurements(sensor_id, received_at DESC);
    CREATE INDEX idx_measurements_code_time ON telemetry_measurements(measurement_code, received_at DESC);
    CREATE TABLE device_events (
      id INTEGER PRIMARY KEY, gateway_id TEXT NOT NULL REFERENCES gateways(id), sensor_id TEXT REFERENCES sensors(id),
      event_type TEXT NOT NULL, occurred_at TEXT NOT NULL, details TEXT
    );
    CREATE INDEX idx_events_gateway_time ON device_events(gateway_id, occurred_at DESC);
    CREATE TABLE alarms (
      id INTEGER PRIMARY KEY, sensor_id TEXT REFERENCES sensors(id), gateway_id TEXT REFERENCES gateways(id),
      raised_at TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE INDEX idx_alarms_time ON alarms(raised_at DESC);
  `),
  (db) =>
    db.exec(`
    ALTER TABLE gateways ADD COLUMN manufacturer TEXT;
    ALTER TABLE gateways ADD COLUMN model TEXT;
    ALTER TABLE gateways ADD COLUMN firmware_version TEXT;
    ALTER TABLE gateways ADD COLUMN location TEXT;
    ALTER TABLE gateways ADD COLUMN notes TEXT;
    ALTER TABLE sensors ADD COLUMN freshness_seconds INTEGER CHECK(freshness_seconds IS NULL OR freshness_seconds > 0);
    ALTER TABLE telemetry_raw ADD COLUMN communication_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_raw ADD COLUMN protocol_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_raw ADD COLUMN value_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_raw ADD COLUMN time_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_raw ADD COLUMN duplicate_of INTEGER REFERENCES telemetry_raw(id);
    ALTER TABLE telemetry_measurements ADD COLUMN communication_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_measurements ADD COLUMN protocol_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_measurements ADD COLUMN value_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    ALTER TABLE telemetry_measurements ADD COLUMN time_quality TEXT NOT NULL DEFAULT 'legacy_unknown';
    DROP INDEX idx_raw_message;
    CREATE INDEX idx_raw_message ON telemetry_raw(gateway_id, message_id);
    CREATE INDEX idx_raw_gateway_time ON telemetry_raw(gateway_id, received_at DESC);
    CREATE INDEX idx_measurements_series_time ON telemetry_measurements(sensor_id, measurement_code, unit, received_at DESC);
  `),
  (db) =>
    db.exec(`
    CREATE TABLE protocol_profiles (
      id INTEGER PRIMARY KEY,
      sensor_id TEXT NOT NULL REFERENCES sensors(id),
      version TEXT NOT NULL,
      protocol_name TEXT, parser_version TEXT, calibration_version TEXT, evidence_ref TEXT,
      definitions_json TEXT NOT NULL CHECK(json_valid(definitions_json)),
      created_at TEXT NOT NULL,
      UNIQUE(sensor_id, version)
    );
    CREATE INDEX idx_profiles_sensor ON protocol_profiles(sensor_id, id DESC);
    CREATE TRIGGER profiles_no_update BEFORE UPDATE ON protocol_profiles BEGIN SELECT RAISE(ABORT, 'protocol profiles are immutable'); END;
    CREATE TRIGGER profiles_no_delete BEFORE DELETE ON protocol_profiles BEGIN SELECT RAISE(ABORT, 'protocol profiles are immutable'); END;
    ALTER TABLE telemetry_raw ADD COLUMN profile_id INTEGER REFERENCES protocol_profiles(id);
    ALTER TABLE telemetry_raw ADD COLUMN profile_snapshot TEXT;
    ALTER TABLE telemetry_measurements ADD COLUMN semantics TEXT NOT NULL DEFAULT 'unknown' CHECK(semantics IN ('unknown','instantaneous','cumulative','interval'));
    CREATE INDEX idx_measurements_series_device_time ON telemetry_measurements(sensor_id, measurement_code, unit, measured_at DESC);
  `),
  migrateOperations,
];

export function openDatabase(file) {
  if (file !== ":memory:")
    mkdirSync(dirname(resolve(file)), { recursive: true });
  const db = new Database(file);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const applied = new Set(
      db
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => row.version),
    );
    migrations.forEach((migration, i) => {
      if (!applied.has(i + 1))
        db.transaction(() => {
          migration(db);
          db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(
            i + 1,
          );
        })();
    });
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

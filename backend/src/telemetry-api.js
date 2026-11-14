import { createHash } from 'node:crypto';
import { sensors, gateways } from './status.js';
import { history, statistics, rawRecords, events } from './queries.js';
import { createProfile, listProfiles } from './profiles.js';
import { listInstallations } from './research.js';
import { listAlarms } from './alarms.js';
import { recordAudit } from './audit.js';
import { fail } from './validation.js';

function exportSnapshot(db, query) {
  return db.transaction(() => {
    const result = history(db, query, false);
    const summary = query.sensor_id && query.measurement_code && query.unit ? statistics(db, query) : null;
    const filters = Object.fromEntries(['sensor_id','measurement_code','unit','experiment_id','plot_id','from','to','order'].map(k => [k, query[k] || null]));
    filters.time_basis = result.time_basis;
    filters.order ||= 'desc';
    return {
      manifest: {
        format: 'fieldwater-telemetry-export-v1', generated_at: new Date().toISOString(),
        filters, count: result.total, statistics: summary,
        attribution: '按设备采集时间匹配 [安装开始,安装结束)；缺少设备时间不自动分配试验小区',
        rows_sha256: createHash('sha256').update(JSON.stringify(result.rows)).digest('hex'),
        checksum_method: 'SHA-256 of UTF-8 JSON.stringify(rows) without whitespace',
      },
      rows: result.rows,
    };
  })();
}
export function registerTelemetryRoutes(app, db) {
  app.get('/api/devices/:id', async req => {
    const sensor = sensors(db).find(s => s.id === req.params.id);
    if (!sensor) fail('仪器不存在', 404);
    return { ...sensor,
      gateway: gateways(db).find(g => g.id === sensor.gateway_id),
      profiles: listProfiles(db, sensor.id),
      installations: listInstallations(db, { sensor_id: sensor.id }),
      recent_raw: rawRecords(db, { sensor_id: sensor.id, limit: 10 }),
      recent_events: events(db, { gateway_id: sensor.gateway_id, limit: 10 }),
      alarms: listAlarms(db, { sensor_id: sensor.id }),
    };
  });
  app.get('/api/devices/:id/profiles', async req => {
    if (!db.prepare('SELECT id FROM sensors WHERE id=?').get(req.params.id)) fail('仪器不存在',404);
    return listProfiles(db, req.params.id);
  });
  app.post('/api/devices/:id/profiles', async (req, reply) => {
    const profile = db.transaction(() => {
      const result = createProfile(db, req.params.id, req.body);
      recordAudit(db, { action:'create', entityType:'protocol_profile',entityId:result.id,after:result,source:'POST /api/devices/:id/profiles' });
      return result;
    })();
    return reply.code(201).send(profile);
  });
  app.get('/api/telemetry/statistics', async req => db.transaction(() => statistics(db, req.query))());
  app.get('/api/telemetry/export.json', async (req, reply) => reply
    .type('application/json; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="fieldwater-telemetry.json"')
    .send(exportSnapshot(db, req.query)));
  app.get('/api/telemetry/history.csv', async (req, reply) => {
    const { rows, manifest } = exportSnapshot(db, req.query);
    const fields = ['sensor_id','sensor_name','gateway_id','measurement_code','value','unit','semantics','measured_at','received_at',
      'communication_quality','protocol_quality','value_quality','time_quality','source','transport','raw_id','profile_id','profile_snapshot',
      'experiment_id','experiment_name','plot_id','plot_name','treatment','installation_id','installation_start_at','installation_end_at',
      'query_time_basis','query_from','query_to','query_generated_at'];
    const cell = value => `"${(typeof value === 'string' ? value.replace(/^[=+@\t\r-]/, "'$&") : String(value ?? '')).replaceAll('"','""')}"`;
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="fieldwater-history.csv"')
      .send('\uFEFF' + [fields.join(','), ...rows.map(row => {
        const record = { ...row, query_time_basis:manifest.filters.time_basis,query_from:manifest.filters.from,query_to:manifest.filters.to,query_generated_at:manifest.generated_at };
        return fields.map(f => cell(record[f])).join(',');
      })].join('\r\n'));
  });
}

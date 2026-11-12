import Fastify from 'fastify';

const types = ['water_level', 'electromagnetic_flow', 'rainfall'];
const clean = (s) => typeof s === 'string' && s.trim() ? s.trim() : null;
function devices(db) {
  const rows = db.prepare(`SELECT s.*, g.name AS gateway_name, g.transport, g.timeout_seconds,
    (SELECT MAX(e.occurred_at) FROM device_events e WHERE e.gateway_id=g.id AND e.event_type IN ('heartbeat','telemetry_received')) AS last_contact
    FROM sensors s JOIN gateways g ON g.id=s.gateway_id ORDER BY s.id`).all();
  return rows.map((row) => {
    let status = 'pending';
    if (row.last_contact) {
      const elapsed = Date.now() - Date.parse(row.last_contact);
      status = row.timeout_seconds ? (elapsed > row.timeout_seconds * 1000 ? 'offline' : 'online') : 'timeout_unconfigured';
    }
    return { ...row, status };
  });
}
function queryHistory(db, query, paginated = true) {
  const clauses = []; const params = [];
  for (const [key, column, op] of [['sensor_id','m.sensor_id','='], ['measurement_code','m.measurement_code','='], ['from','m.received_at','>='], ['to','m.received_at','<=']]) {
    if (query[key]) { clauses.push(`${column} ${op} ?`); params.push(query[key]); }
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 50, 1), 500);
  const offset = Math.max(Number.parseInt(query.offset, 10) || 0, 0);
  const order = query.order === 'asc' ? 'ASC' : 'DESC';
  const count = db.prepare(`SELECT COUNT(*) AS n FROM telemetry_measurements m ${where}`).get(...params).n;
  const sql = `SELECT m.*, s.name AS sensor_name, s.gateway_id, r.transport, r.device_timestamp FROM telemetry_measurements m JOIN sensors s ON s.id=m.sensor_id JOIN telemetry_raw r ON r.id=m.raw_id ${where} ORDER BY m.received_at ${order}, m.id ${order}`;
  const rows = paginated ? db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, limit, offset) : db.prepare(sql).all(...params);
  return { rows, total: count, limit, offset };
}
export function buildApp(db) {
  const app = Fastify({ logger: true });
  app.get('/api/health', async () => ({ status: 'ok' }));
  app.get('/api/gateways', async () => db.prepare('SELECT * FROM gateways ORDER BY id').all());
  app.get('/api/sensors', async () => db.prepare('SELECT * FROM sensors ORDER BY id').all());
  app.get('/api/devices', async () => devices(db));
  app.post('/api/devices', async (req, reply) => {
    const b = req.body || {};
    const id = clean(b.id), name = clean(b.name), gateway = clean(b.gateway_id);
    if (!id || !name || !gateway || !types.includes(b.type)) return reply.code(400).send({ error: '设备编号、名称、网关编号和有效类型为必填项' });
    const timeout = b.timeout_seconds === '' || b.timeout_seconds == null ? null : Number(b.timeout_seconds);
    if (timeout !== null && (!Number.isInteger(timeout) || timeout < 1)) return reply.code(400).send({ error: '超时必须是正整数秒' });
    try {
      db.transaction(() => {
        const old = db.prepare('SELECT * FROM gateways WHERE id=?').get(gateway);
        if (!old) db.prepare('INSERT INTO gateways (id,name,transport,timeout_seconds) VALUES (?,?,?,?)').run(gateway, gateway, clean(b.transport), timeout);
        else if ((clean(b.transport) && old.transport !== clean(b.transport)) || (timeout !== null && old.timeout_seconds !== timeout)) throw new Error('网关已存在，通信设置不一致');
        db.prepare('INSERT INTO sensors (id,gateway_id,type,name,manufacturer,model,location,unit,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(id,gateway,b.type,name,clean(b.manufacturer),clean(b.model),clean(b.location),clean(b.unit),clean(b.notes));
      })();
      return reply.code(201).send({ id });
    } catch (error) { return reply.code(409).send({ error: error.message }); }
  });
  app.get('/api/dashboard/summary', async () => {
    const all = devices(db); const count = (status) => all.filter((d) => d.status === status).length;
    const last = db.prepare('SELECT MAX(received_at) AS value FROM telemetry_measurements').get().value;
    return { total: all.length, online: count('online'), offline: count('offline'), pending: count('pending'), timeout_unconfigured: count('timeout_unconfigured'), online_rate: all.length ? count('online') / all.length : null, last_received_at: last };
  });
  app.get('/api/telemetry/latest', async () => db.prepare(`SELECT m.*, s.name AS sensor_name, s.gateway_id, r.transport, r.device_timestamp FROM telemetry_measurements m JOIN sensors s ON s.id=m.sensor_id JOIN telemetry_raw r ON r.id=m.raw_id WHERE m.id IN (SELECT m2.id FROM telemetry_measurements m2 WHERE m2.sensor_id=m.sensor_id AND m2.measurement_code=m.measurement_code ORDER BY m2.received_at DESC, m2.id DESC LIMIT 1) ORDER BY m.received_at DESC`).all());
  app.get('/api/telemetry/history', async (req) => queryHistory(db, req.query));
  app.get('/api/telemetry/history.csv', async (req, reply) => {
    const { rows } = queryHistory(db, req.query, false);
    const fields = ['sensor_id','sensor_name','gateway_id','measurement_code','value','unit','measured_at','received_at','quality_status','source','transport','raw_id'];
    const cell = (v) => `"${String(v ?? '').replace(/^[=+@\t\r-]/, "'$&").replaceAll('"','""')}"`;
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="fieldwater-history.csv"').send('\uFEFF' + [fields.join(','), ...rows.map((r) => fields.map((f) => cell(r[f])).join(','))].join('\r\n'));
  });
  app.get('/api/alarms', async () => db.prepare('SELECT * FROM alarms ORDER BY raised_at DESC, id DESC').all());
  return app;
}

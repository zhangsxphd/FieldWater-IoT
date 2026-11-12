import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
import { ingest } from './ingest.js';
import { crc16, parseRainGauge } from './modules/protocols/rain-gauge/index.js';

// Synthetic algorithm test vector only; not a manufacturer example or field observation.
const frame = Buffer.from([1, 3, 2, 0, 10, 56, 67]);
test('rain gauge validates request context, CRC, address and function', () => {
  assert.equal(crc16(frame.subarray(0, 5)), frame.readUInt16LE(5));
  assert.equal(parseRainGauge(frame, { address: 1, register: 0, quantity: 1 }).value, 1);
  assert.throws(() => parseRainGauge(frame, { address: 2, register: 0, quantity: 1 }));
  assert.throws(() => parseRainGauge(frame, { address: 1, register: 1, quantity: 1 }));
  assert.throws(() => parseRainGauge(Buffer.from([1, 3, 2, 0, 10, 0, 0]), { address: 1, register: 0, quantity: 1 }));
});
test('empty database, registration, raw retention, deduplication and history', async () => {
  const db = openDatabase(':memory:'); const app = buildApp(db);
  try {
    const get = async (url) => (await app.inject({ method:'GET', url })).json();
    assert.equal((await get('/api/dashboard/summary')).online_rate, null);
    assert.deepEqual((await get('/api/telemetry/history')).rows, []);
    assert.deepEqual(await get('/api/alarms'), []);
    const response = await app.inject({ method:'POST', url:'/api/devices', payload: { id:'test-sensor', name:'test', gateway_id:'test-gateway', type:'rainfall', timeout_seconds:60 } });
    assert.equal(response.statusCode, 201);
    assert.equal((await get('/api/devices'))[0].status, 'pending');
    const input = { gatewayId:'test-gateway', sensorId:'test-sensor', messageId:'one', rawPayload:frame, transport:'test', source:'isolated-test', communicationVerified:true, parse:(b) => parseRainGauge(b, { address:1, register:0, quantity:1 }) };
    ingest(db, input);
    assert.equal(ingest(db, input).duplicate, true);
    ingest(db, { ...input, messageId:'bad', rawPayload:Buffer.from([1]), parse:() => { throw new Error('bad frame'); } });
    ingest(db, { ...input, rawPayload:Buffer.from([2]) });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM telemetry_raw').get().n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_raw WHERE parse_status='failed'").get().n, 2);
    const history = await get('/api/telemetry/history?sensor_id=test-sensor');
    assert.equal(history.total, 1); assert.equal(history.rows[0].value, 1); assert.equal(history.rows[0].measured_at, null);
    const raw = await get('/api/telemetry/raw/' + history.rows[0].raw_id); assert.equal(raw.raw_payload, frame.toString('hex')); assert.equal(raw.source, 'isolated-test');
    assert.equal((await app.inject('/api/telemetry/raw/9999')).statusCode, 404);
    assert.equal((await get('/api/devices'))[0].status, 'online');
  } finally { await app.close(); db.close(); }
});

test('existing database migrates without deleting records and event states follow evidence', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  const dir = mkdtempSync(join(tmpdir(), 'fieldwater-migration-test-')); const file = join(dir, 'test.sqlite');
  const old = new Database(file);
  old.exec("CREATE TABLE gateways (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE sensors (id TEXT PRIMARY KEY, gateway_id TEXT NOT NULL REFERENCES gateways(id), type TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO gateways(id,name) VALUES ('existing-gw','Existing'); INSERT INTO sensors(id,gateway_id,type,name) VALUES ('existing-sensor','existing-gw','water_level','Existing');"); old.close();
  const db = openDatabase(file); const app = buildApp(db);
  try {
    assert.equal(db.prepare('SELECT count(*) n FROM sensors').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM schema_migrations').get().n,2);
    const getStatus = async () => (await app.inject('/api/devices')).json()[0].status;
    assert.equal(await getStatus(),'pending');
    db.prepare("UPDATE gateways SET timeout_seconds=60 WHERE id='existing-gw'").run();
    db.prepare("INSERT INTO device_events (gateway_id,event_type,occurred_at) VALUES ('existing-gw','heartbeat',?)").run('2020-01-01T00:00:00.000Z');
    assert.equal(await getStatus(),'offline');
    db.prepare("INSERT INTO device_events (gateway_id,event_type,occurred_at) VALUES ('existing-gw','communication_error',?)").run(new Date().toISOString());
    assert.equal(await getStatus(),'communication_error');
    const update = await app.inject({method:'PUT',url:'/api/devices/existing-sensor',payload:{name:'Updated',type:'water_level',timeout_seconds:60}});
    assert.equal(update.statusCode,200); assert.equal(db.prepare('SELECT name FROM sensors').get().name,'Updated');
    const invalid = await app.inject({method:'PUT',url:'/api/devices/existing-sensor',payload:{name:'Updated',type:'rainfall'}});
    assert.equal(invalid.statusCode,400);
  } finally { await app.close(); db.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('unverified input does not establish online state and zero values remain real values', async () => {
  const db=openDatabase(':memory:'); const app=buildApp(db);
  try {
    db.prepare('INSERT INTO gateways(id,name,timeout_seconds) VALUES (?,?,?)').run('g','Gateway',30);
    db.prepare('INSERT INTO sensors(id,gateway_id,type,name) VALUES (?,?,?,?)').run('s','g','rainfall','Sensor');
    const input={gatewayId:'g',sensorId:'s',rawPayload:Buffer.from([0]),transport:'isolated',source:'isolated-test',parse:()=>({measurement_code:'rainfall',value:0,unit:'mm',quality_status:'test'})};
    ingest(db,input);
    assert.equal((await app.inject('/api/devices')).json()[0].status,'pending');
    const rows=(await app.inject('/api/telemetry/history?limit=1')).json();
    assert.equal(rows.rows[0].value,0);
    const csv=await app.inject('/api/telemetry/history.csv');
    assert.match(csv.body, /"0"/);
    assert.deepEqual(db.prepare('SELECT raw_payload FROM telemetry_raw').get().raw_payload, Buffer.from([0]));
  } finally { await app.close(); db.close(); }
});

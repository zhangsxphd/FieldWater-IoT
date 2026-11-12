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
    const input = { gatewayId:'test-gateway', sensorId:'test-sensor', messageId:'one', rawPayload:frame, transport:'test', source:'isolated-test', parse:(b) => parseRainGauge(b, { address:1, register:0, quantity:1 }) };
    ingest(db, input);
    assert.equal(ingest(db, input).duplicate, true);
    ingest(db, { ...input, messageId:'bad', rawPayload:Buffer.from([1]), parse:() => { throw new Error('bad frame'); } });
    ingest(db, { ...input, rawPayload:Buffer.from([2]) });
    assert.equal(db.prepare('SELECT COUNT(*) n FROM telemetry_raw').get().n, 3);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM telemetry_raw WHERE parse_status='failed'").get().n, 2);
    const history = await get('/api/telemetry/history?sensor_id=test-sensor');
    assert.equal(history.total, 1); assert.equal(history.rows[0].value, 1); assert.equal(history.rows[0].measured_at, null);
    assert.equal((await get('/api/devices'))[0].status, 'online');
  } finally { await app.close(); db.close(); }
});

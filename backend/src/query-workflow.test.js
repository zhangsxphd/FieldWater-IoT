import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from './db.js';
import { buildApp } from './app.js';
import { ingest } from './ingest.js';
import { createProfile } from './profiles.js';

async function fixture(fn) {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO gateways(id,name,timeout_seconds) VALUES ('g','Isolated test',60)").run();
  db.prepare("INSERT INTO sensors(id,gateway_id,type,name,freshness_seconds) VALUES ('s','g','electromagnetic_flow','Isolated test',60)").run();
  const profile = createProfile(db, 's', {version:'fixture-v1',parser_version:'fixture-only',evidence_ref:'Isolated synthetic protocol vector; not hardware documentation',definitions:[{measurement_code:'fixture_rate',unit:'test_unit',semantics:'instantaneous',required:true}]});
  const app = buildApp(db);
  let seq = 0;
  const put = (value, options={}) => ingest(db, {
    gatewayId:'g',sensorId:'s',messageId:'isolated-'+(++seq),rawPayload:Buffer.from(String(seq)),communicationVerified:true,
    transport:'isolated-test',source:'isolated-test',profileId:profile.id,receivedAt:'2026-01-02T00:00:00Z',deviceTimestamp:'2026-01-01T00:00:00Z',
    parse:()=>({measurement_code:'fixture_rate',unit:'test_unit',value,value_quality:'valid'}),...options,
  });
  try { await fn({db,app,put,profile}); } finally { await app.close(); db.close(); }
}
const scope = 'sensor_id=s&measurement_code=fixture_rate&unit=test_unit';

test('full-scope statistics cover more than 500 records and export exact filters and immutable provenance', () => fixture(async ({app,put,db}) => {
  db.transaction(()=>{ for(let i=1;i<=601;i++) put(i); })();
  const history=(await app.inject('/api/telemetry/history?'+scope+'&limit=500')).json();
  assert.equal(history.rows.length,500); assert.equal(history.total,601);
  const response=await app.inject('/api/telemetry/statistics?'+scope+'&limit=1');
  assert.equal(response.statusCode,200); const stats=response.json();
  assert.equal(stats.count,601);assert.equal(stats.min,1);assert.equal(stats.max,601);assert.equal(stats.mean,301);assert.equal(stats.mean_allowed,true);
  const exported=(await app.inject('/api/telemetry/export.json?'+scope+'&time_basis=measured_at&from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:01Z')).json();
  assert.equal(exported.manifest.count,601); assert.equal(exported.manifest.statistics.count,601);
  assert.equal(exported.manifest.filters.time_basis,'measured_at');
  assert.equal(exported.manifest.rows_sha256,createHash('sha256').update(JSON.stringify(exported.rows)).digest('hex'));
  assert.equal(JSON.parse(exported.rows[0].profile_snapshot).parser_version,'fixture-only');
  assert.equal(exported.rows[0].plot_id,null);
}));

test('observation and receipt ranges are explicit; missing observation time is never silently substituted', () => fixture(async ({app,put}) => {
  put(1); put(2,{deviceTimestamp:null});
  const base='/api/telemetry/history?'+scope+'&from=2026-01-02T00:00:00Z&to=2026-01-02T01:00:00Z';
  assert.equal((await app.inject(base+'&time_basis=received_at')).json().total,2);
  assert.equal((await app.inject(base+'&time_basis=measured_at')).json().total,0);
  const stats=(await app.inject('/api/telemetry/statistics?'+scope+'&time_basis=measured_at')).json();
  assert.equal(stats.count,1);assert.equal(stats.missing_device_time_count,1);
  assert.match(stats.missing_device_time_scope,/全部时间/);
  assert.equal((await app.inject(base+'&time_basis=invalid')).statusCode,400);
  assert.equal((await app.inject('/api/telemetry/statistics')).statusCode,400);
}));

test('unknown or mixed semantics disable average; invalid decoded values stay auditable but outside statistics', () => fixture(async ({app,put}) => {
  put(1);put(100,{profileId:null});
  put(999,{parse:()=>({measurement_code:'fixture_rate',unit:'test_unit',value:999,value_quality:'invalid'})});
  const stats=(await app.inject('/api/telemetry/statistics?'+scope)).json();
  assert.equal(stats.count,2);assert.equal(stats.max,100);assert.equal(stats.mean,null);assert.equal(stats.mean_allowed,false);
  assert.equal(stats.excluded_count,1);assert.deepEqual(stats.semantics,['instantaneous','unknown']);
}));

test('historical research attribution follows half-open installation intervals and never receipt fallback', () => fixture(async ({app,put}) => {
  const post=async(url,payload)=>{const r=await app.inject({method:'POST',url,payload});assert.equal(r.statusCode,201,r.body);return r.json();};
  await post('/api/experiments',{id:'trial',name:'Isolated trial'});
  for(const id of ['a','b']) await post('/api/plots',{id,experiment_id:'trial',name:'Isolated plot '+id});
  await post('/api/installations',{sensor_id:'s',plot_id:'a',start_at:'2025-12-01T00:00:00Z',end_at:'2026-01-01T00:00:00Z'});
  await post('/api/installations',{sensor_id:'s',plot_id:'b',start_at:'2026-01-01T00:00:00Z'});
  put(1,{deviceTimestamp:'2025-12-31T23:59:59Z'});put(2);put(3,{deviceTimestamp:null});
  const records=(await app.inject('/api/telemetry/history?'+scope+'&order=asc')).json().rows;
  assert.deepEqual(records.map(r=>r.plot_id),['a','b',null]);
  assert.equal((await app.inject('/api/telemetry/history?'+scope+'&plot_id=a')).json().total,1);
  assert.equal((await app.inject('/api/telemetry/statistics?'+scope+'&experiment_id=trial')).json().count,2);
}));

test('device detail combines evidence and independent metric states; configuration updates are audited', () => fixture(async ({app,put}) => {
  put(7);
  const detail=await app.inject('/api/devices/s');assert.equal(detail.statusCode,200);
  const d=detail.json();assert.equal(d.gateway.id,'g');assert.equal(d.metrics.length,1);assert.equal(d.profiles.length,1);assert.equal(d.recent_raw.total,1);
  const changed=await app.inject({method:'PUT',url:'/api/devices/s',payload:{name:'Changed isolated instrument'}});assert.equal(changed.statusCode,200,changed.body);
  const audits=(await app.inject('/api/audit?entity_type=sensor&entity_id=s')).json();
  assert.equal(audits.total,1);assert.equal(audits.rows[0].before.name,'Isolated test');assert.equal(audits.rows[0].after.name,'Changed isolated instrument');
  assert.equal((await app.inject('/api/devices/absent')).statusCode,404);
}));

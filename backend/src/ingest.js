// Internal adapter interface. Not exposed to the network until transport and device format are verified.
export function ingest(db, { gatewayId, sensorId = null, messageId = null, rawPayload, transport, source, deviceTimestamp = null, receivedAt = new Date().toISOString(), parse }) {
  if (!gatewayId || !transport || !source || !Buffer.isBuffer(rawPayload)) throw new Error('gateway, transport, source and raw bytes required');
  const insert = db.prepare(`INSERT INTO telemetry_raw (gateway_id,sensor_id,message_id,raw_payload,received_at,device_timestamp,transport,source,parse_status) VALUES (?,?,?,?,?,?,?,?,?)`);
  let rawId;
  try { rawId = insert.run(gatewayId, sensorId, messageId, rawPayload, receivedAt, deviceTimestamp, transport, source, 'pending').lastInsertRowid; }
  catch (error) {
    if (messageId && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const previous = db.prepare('SELECT raw_payload, sensor_id FROM telemetry_raw WHERE gateway_id=? AND message_id=?').get(gatewayId, messageId);
      if (previous && previous.sensor_id === sensorId && previous.raw_payload.equals(rawPayload)) return { duplicate: true };
      const conflict = insert.run(gatewayId, sensorId, null, rawPayload, receivedAt, deviceTimestamp, transport, source, 'failed');
      db.prepare('UPDATE telemetry_raw SET parse_error=? WHERE id=?').run('message_id conflict: ' + messageId, conflict.lastInsertRowid);
      return { rawId: conflict.lastInsertRowid, conflict: true };
    }
    throw error;
  }
  try {
    const sensor = db.prepare('SELECT * FROM sensors WHERE id = ? AND gateway_id = ?').get(sensorId, gatewayId);
    if (!sensor) throw new Error('unknown sensor or gateway binding');
    db.prepare('INSERT INTO device_events (gateway_id,sensor_id,event_type,occurred_at) VALUES (?,?,?,?)').run(gatewayId, sensorId, 'telemetry_received', receivedAt);
    if (typeof parse !== 'function') throw new Error('no verified parser configured');
    const measurement = parse(rawPayload);
    if (!measurement || !Number.isFinite(measurement.value) || !measurement.measurement_code || !measurement.unit || !measurement.quality_status) throw new Error('invalid parsed measurement');
    db.transaction(() => {
      db.prepare('INSERT INTO telemetry_measurements (raw_id,sensor_id,measurement_code,value,unit,measured_at,received_at,quality_status,source) VALUES (?,?,?,?,?,?,?,?,?)').run(rawId, sensorId, measurement.measurement_code, measurement.value, measurement.unit, deviceTimestamp, receivedAt, measurement.quality_status, source);
      db.prepare("UPDATE telemetry_raw SET parse_status='parsed' WHERE id=?").run(rawId);
    })();
  } catch (error) {
    db.prepare("UPDATE telemetry_raw SET parse_status='failed', parse_error=? WHERE id=?").run(String(error.message), rawId);
  }
  return { rawId };
}

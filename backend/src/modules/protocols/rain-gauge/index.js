// A read response carries no register address: the caller must supply verified request context.
export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? ((crc >>> 1) ^ 0xa001) : (crc >>> 1);
  }
  return crc;
}
export function parseRainGauge(frame, { address, register, quantity } = {}) {
  if (!Buffer.isBuffer(frame)) throw new Error('frame must be a Buffer');
  if (!Number.isInteger(address) || address < 1 || address > 247) throw new Error('verified slave address required');
  if (register !== 0 || quantity !== 1) throw new Error('verified request for register 0000H and one register required');
  if (frame.length !== 7) throw new Error('invalid response length');
  if (crc16(frame.subarray(0, -2)) !== frame.readUInt16LE(frame.length - 2)) throw new Error('CRC mismatch');
  if (frame[0] !== address) throw new Error('slave address mismatch');
  if (frame[1] !== 3 || frame[2] !== 2) throw new Error('unexpected function or byte count');
  return { measurement_code: 'rainfall', value: frame.readUInt16BE(3) / 10, unit: 'mm', quality_status: 'protocol_valid_resolution_unverified' };
}

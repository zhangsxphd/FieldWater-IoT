// Trusted queries never turn unknown legacy quality into approval.
export const trustedMeasurement = (
  alias = "m",
) => `${alias}.communication_quality='verified'
  AND ${alias}.protocol_quality='valid' AND ${alias}.value_quality='valid'
  AND ${alias}.time_quality IN ('valid','missing')`;

export function parseIsoTime(value) {
  if (typeof value !== "string") return null;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > days[month - 1] ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  if (
    m[8] !== "Z" &&
    (Number(m[8].slice(1, 3)) > 23 || Number(m[8].slice(4)) > 59)
  )
    return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}
export function deviceTime(value, receivedAt) {
  if (value === null || value === undefined || value === "")
    return { time_quality: "missing", measured_at: null };
  const normalized = parseIsoTime(value);
  if (!normalized) return { time_quality: "invalid", measured_at: null };
  if (Date.parse(value) > Date.parse(receivedAt) + 300000)
    return { time_quality: "future", measured_at: null };
  return { time_quality: "valid", measured_at: normalized };
}

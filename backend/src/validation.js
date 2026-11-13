import { parseIsoTime } from "./quality.js";
export function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
export function text(value, field, required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) fail(`${field}为必填项`);
    return null;
  }
  if (typeof value !== "string" || value.length > 2000)
    fail(`${field}必须是长度不超过 2000 的文本`);
  const result = value.trim();
  if (!result && required) fail(`${field}为必填项`);
  return result || null;
}
export function id(value, field = "编号") {
  const result = text(value, field, true);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(result))
    fail(`${field}限 1–100 个字母、数字、点、下划线或连字符`);
  return result;
}
export function seconds(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const n =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(n) || n < 1 || n > 31536000)
    fail(`${field}必须是 1–31536000 的整数秒`);
  return n;
}
export function page(query) {
  const integer = (value, fallback, max, min) => {
    if (value === undefined) return fallback;
    if (
      !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < min ||
      Number(value) > max
    )
      fail("分页参数无效");
    return Number(value);
  };
  return {
    limit: integer(query.limit, 50, 500, 1),
    offset: integer(query.offset, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}
export function timeRange(query) {
  const result = {};
  for (const key of ["from", "to"])
    if (query[key]) {
      const normalized = parseIsoTime(query[key]);
      if (!normalized) fail("时间必须是包含时区的有效日期时间");
      result[key] = normalized;
    }
  if (result.from && result.to && result.from > result.to)
    fail("开始时间不能晚于结束时间");
  return result;
}

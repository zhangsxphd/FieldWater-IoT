import { fail, text, seconds } from "./validation.js";

export const semantics = ["unknown", "instantaneous", "cumulative", "interval"];
const describe = (row) => {
  if (!row) return null;
  const { definitions_json, ...metadata } = row;
  return { ...metadata, definitions: JSON.parse(definitions_json) };
};

export function getProfile(db, profileId) {
  if (!((typeof profileId === "string" && /^[1-9]\d*$/.test(profileId)) || typeof profileId === "number") || !Number.isSafeInteger(Number(profileId)) || Number(profileId) < 1)
    fail("协议档案编号无效");
  const profile = describe(db.prepare("SELECT * FROM protocol_profiles WHERE id=?").get(Number(profileId)));
  if (!profile) fail("协议档案不存在", 404);
  return profile;
}

export function listProfiles(db, sensorId) {
  return db.prepare("SELECT * FROM protocol_profiles WHERE sensor_id=? ORDER BY id DESC").all(sensorId).map(describe);
}

// Recording a version/evidence reference never approves its measurement quality.
// A trusted adapter must independently validate hardware, parser and source.
export function createProfile(db, sensorId, input) {
  if (!db.prepare("SELECT id FROM sensors WHERE id=?").get(sensorId))
    fail("传感器不存在", 404);
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("协议档案必须是 JSON 对象");
  const version = text(input.version, "版本", true);
  if (version.length > 100) fail("版本不能超过 100 个字符");
  if (!Array.isArray(input.definitions) || input.definitions.length < 1 || input.definitions.length > 64)
    fail("协议档案必须包含 1–64 个指标定义");
  const keys = new Set();
  const definitions = Array.from(input.definitions, (entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) fail("指标定义必须是对象");
    const code = text(entry.measurement_code, "指标代码", true);
    const unit = text(entry.unit, "单位", true);
    if (code.length > 100 || unit.length > 64) fail("指标代码或单位过长");
    const semantic = entry.semantics ?? "unknown";
    if (!semantics.includes(semantic)) fail("指标语义无效");
    if (entry.required !== undefined && typeof entry.required !== "boolean") fail("必需指标必须是布尔值");
    const key = JSON.stringify([code, unit]);
    if (keys.has(key)) fail("同一档案内指标代码与单位不能重复");
    keys.add(key);
    return { measurement_code: code, unit, semantics: semantic,
      freshness_seconds: seconds(entry.freshness_seconds, "指标数据有效期"), required: entry.required ?? false };
  });
  const fields = ["protocol_name", "parser_version", "calibration_version", "evidence_ref"];
  const result = db.prepare(`INSERT INTO protocol_profiles(sensor_id,version,${fields.join(",")},definitions_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(sensorId, version, ...fields.map((field) => text(input[field], field)), JSON.stringify(definitions), new Date().toISOString());
  return getProfile(db, Number(result.lastInsertRowid));
}

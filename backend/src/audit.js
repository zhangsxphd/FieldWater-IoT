import { page } from "./validation.js";

// This actor describes the local application, not an authenticated person.
export function recordAudit(db, { action, entityType, entityId, before = null, after = null,
  source, occurredAt = new Date().toISOString(), actor = "local_operator" }) {
  return Number(db.prepare(`INSERT INTO operation_audit
    (action,entity_type,entity_id,occurred_at,actor,source,before_json,after_json)
    VALUES (?,?,?,?,?,?,?,?)`).run(action, entityType, String(entityId), occurredAt,
    actor, source, before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after)).lastInsertRowid);
}

export function listAudit(db, query = {}) {
  const pagination = page(query), params = [], clauses = [];
  for (const field of ["entity_type", "entity_id"])
    if (query[field]) { clauses.push(`${field}=?`); params.push(query[field]); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) n FROM operation_audit ${where}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM operation_audit ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, pagination.limit, pagination.offset)
    .map(({ before_json, after_json, ...row }) => ({ ...row,
      before: before_json === null ? null : JSON.parse(before_json),
      after: after_json === null ? null : JSON.parse(after_json) }));
  return { rows, total, ...pagination };
}

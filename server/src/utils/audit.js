import { run } from '../db/database.js';

export function audit(actorId, action, entityType, entityId, metadata = {}) {
  run(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [actorId || null, action, entityType, entityId || null, JSON.stringify(metadata)]
  );
}


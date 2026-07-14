import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { parseJson } from '../utils/format.js';

const router = Router();

router.get('/', requireAdmin, (_req, res) => {
  const settings = all('SELECT * FROM settings ORDER BY key').reduce((acc, row) => {
    acc[row.key] = parseJson(row.value_json, {});
    return acc;
  }, {});
  res.json({ data: settings });
});

router.put('/:key', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      value: z.any()
    }).parse(req.body);
    run(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`,
      [req.params.key, JSON.stringify(payload.value)]
    );
    const row = get('SELECT * FROM settings WHERE key = ?', [req.params.key]);
    res.json({ data: { key: row.key, value: parseJson(row.value_json, {}) } });
  } catch (error) {
    next(error);
  }
});

export default router;


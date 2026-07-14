import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run, transaction } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

const router = Router();

router.get('/', requireAdmin, (req, res) => {
  const rows = all(
    `SELECT i.*, p.title AS product_title, p.sku AS product_sku, pv.title AS variant_title,
            pv.sku AS variant_sku, w.name AS warehouse_name, w.code AS warehouse_code,
            (i.quantity - i.reserved_quantity) AS available_quantity
     FROM inventory i
     JOIN products p ON p.id = i.product_id
     LEFT JOIN product_variants pv ON pv.id = i.variant_id
     JOIN warehouses w ON w.id = i.warehouse_id
     ORDER BY p.title, pv.position, w.name`
  );
  res.json({ data: rows });
});

router.get('/low-stock', requireAdmin, (_req, res) => {
  const rows = all(
    `SELECT i.*, p.title AS product_title, p.sku AS product_sku, pv.title AS variant_title,
            pv.sku AS variant_sku, w.name AS warehouse_name, w.code AS warehouse_code,
            (i.quantity - i.reserved_quantity) AS available_quantity
     FROM inventory i
     JOIN products p ON p.id = i.product_id
     LEFT JOIN product_variants pv ON pv.id = i.variant_id
     JOIN warehouses w ON w.id = i.warehouse_id
     WHERE (i.quantity - i.reserved_quantity) <= i.low_stock_threshold
     ORDER BY available_quantity ASC`
  );
  res.json({ data: rows });
});

router.post('/adjust', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      product_id: z.coerce.number().int(),
      variant_id: z.coerce.number().int().nullable().optional(),
      warehouse_id: z.coerce.number().int(),
      change_quantity: z.coerce.number().int(),
      movement_type: z.enum(['adjustment', 'incoming', 'transfer', 'return', 'sale_correction']).default('adjustment'),
      note: z.string().optional()
    }).parse(req.body);

    const inventory = transaction(() => {
      const existing = get(
        `SELECT * FROM inventory
         WHERE product_id = ? AND COALESCE(variant_id, 0) = COALESCE(?, 0) AND warehouse_id = ?`,
        [payload.product_id, payload.variant_id || null, payload.warehouse_id]
      );

      if (existing) {
        run(
          `UPDATE inventory
           SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [payload.change_quantity, existing.id]
        );
      } else {
        insertAndGetId(
          `INSERT INTO inventory (product_id, variant_id, warehouse_id, quantity)
           VALUES (?, ?, ?, ?)`,
          [payload.product_id, payload.variant_id || null, payload.warehouse_id, payload.change_quantity]
        );
      }

      const movementId = insertAndGetId(
        `INSERT INTO inventory_movements (
          product_id, variant_id, warehouse_id, change_quantity, movement_type, note, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [payload.product_id, payload.variant_id || null, payload.warehouse_id, payload.change_quantity, payload.movement_type, payload.note || null, req.user.id]
      );

      audit(req.user.id, 'adjust', 'inventory', movementId, payload);
      return get(
        `SELECT i.*, p.title AS product_title, pv.title AS variant_title, w.name AS warehouse_name
         FROM inventory i
         JOIN products p ON p.id = i.product_id
         LEFT JOIN product_variants pv ON pv.id = i.variant_id
         JOIN warehouses w ON w.id = i.warehouse_id
         WHERE i.product_id = ? AND COALESCE(i.variant_id, 0) = COALESCE(?, 0) AND i.warehouse_id = ?`,
        [payload.product_id, payload.variant_id || null, payload.warehouse_id]
      );
    });

    res.json({ data: inventory });
  } catch (error) {
    next(error);
  }
});

router.get('/movements', requireAdmin, (_req, res) => {
  const rows = all(
    `SELECT im.*, p.title AS product_title, pv.title AS variant_title, w.name AS warehouse_name, u.name AS actor_name
     FROM inventory_movements im
     JOIN products p ON p.id = im.product_id
     LEFT JOIN product_variants pv ON pv.id = im.variant_id
     JOIN warehouses w ON w.id = im.warehouse_id
     LEFT JOIN users u ON u.id = im.created_by
     ORDER BY im.created_at DESC
     LIMIT 100`
  );
  res.json({ data: rows });
});

router.get('/warehouses', requireAdmin, (_req, res) => {
  res.json({ data: all('SELECT * FROM warehouses ORDER BY name') });
});

router.post('/warehouses', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      name: z.string().min(2),
      code: z.string().min(2),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional().default('India'),
      postal_code: z.string().optional(),
      active: z.coerce.boolean().optional().default(true)
    }).parse(req.body);

    const id = insertAndGetId(
      `INSERT INTO warehouses (name, code, address, city, state, country, postal_code, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.name, payload.code, payload.address || null, payload.city || null, payload.state || null, payload.country, payload.postal_code || null, payload.active ? 1 : 0]
    );
    res.status(201).json({ data: get('SELECT * FROM warehouses WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

export default router;


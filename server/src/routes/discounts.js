import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { activeDiscount, discountAmount } from '../services/cart.js';
import { audit } from '../utils/audit.js';

const router = Router();

const discountSchema = z.object({
  code: z.string().optional(),
  title: z.string().min(2),
  discount_type: z.enum(['percentage', 'fixed', 'free_shipping']),
  value: z.coerce.number().nonnegative(),
  applies_to: z.enum(['cart', 'product', 'collection', 'customer']).optional().default('cart'),
  target_id: z.coerce.number().int().nullable().optional(),
  min_order_value: z.coerce.number().nonnegative().optional().default(0),
  usage_limit: z.coerce.number().int().nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  active: z.coerce.boolean().optional().default(true)
});

router.get('/', requireAdmin, (_req, res) => {
  res.json({ data: all('SELECT * FROM discounts ORDER BY created_at DESC') });
});

router.post('/', requireAdmin, (req, res, next) => {
  try {
    const payload = discountSchema.parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO discounts (
        code, title, discount_type, value, applies_to, target_id, min_order_value,
        usage_limit, starts_at, ends_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.code ? payload.code.toUpperCase() : null,
        payload.title,
        payload.discount_type,
        payload.value,
        payload.applies_to,
        payload.target_id || null,
        payload.min_order_value,
        payload.usage_limit || null,
        payload.starts_at || null,
        payload.ends_at || null,
        payload.active ? 1 : 0
      ]
    );
    audit(req.user.id, 'create', 'discount', id, { code: payload.code });
    res.status(201).json({ data: get('SELECT * FROM discounts WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = get('SELECT * FROM discounts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Discount not found' });
    const payload = discountSchema.partial().parse(req.body);

    run(
      `UPDATE discounts
       SET code = ?, title = ?, discount_type = ?, value = ?, applies_to = ?, target_id = ?,
           min_order_value = ?, usage_limit = ?, starts_at = ?, ends_at = ?, active = ?
       WHERE id = ?`,
      [
        payload.code === undefined ? existing.code : payload.code?.toUpperCase() || null,
        payload.title ?? existing.title,
        payload.discount_type ?? existing.discount_type,
        payload.value ?? existing.value,
        payload.applies_to ?? existing.applies_to,
        payload.target_id ?? existing.target_id,
        payload.min_order_value ?? existing.min_order_value,
        payload.usage_limit ?? existing.usage_limit,
        payload.starts_at ?? existing.starts_at,
        payload.ends_at ?? existing.ends_at,
        payload.active === undefined ? existing.active : (payload.active ? 1 : 0),
        existing.id
      ]
    );
    audit(req.user.id, 'update', 'discount', existing.id);
    return res.json({ data: get('SELECT * FROM discounts WHERE id = ?', [existing.id]) });
  } catch (error) {
    return next(error);
  }
});

router.post('/validate', (req, res, next) => {
  try {
    const payload = z.object({
      code: z.string().min(1),
      subtotal: z.coerce.number().nonnegative()
    }).parse(req.body);
    const discount = activeDiscount(payload.code, payload.subtotal);
    if (!discount) return res.status(404).json({ error: 'Discount code is not valid' });
    return res.json({ data: { discount, discount_total: discountAmount(discount, payload.subtotal) } });
  } catch (error) {
    return next(error);
  }
});

export default router;


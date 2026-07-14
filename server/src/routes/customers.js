import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run } from '../db/database.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';

const router = Router();

const customerSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  status: z.enum(['active', 'disabled']).optional().default('active'),
  group_name: z.string().optional().default('retail'),
  tags: z.string().optional(),
  notes: z.string().optional(),
  reward_points: z.coerce.number().int().optional().default(0)
});

router.get('/', requireAdmin, (req, res) => {
  const search = req.query.search ? `%${req.query.search}%` : null;
  const rows = all(
    `SELECT c.*,
            COUNT(o.id) AS order_count,
            COALESCE(SUM(o.total), 0) AS lifetime_value
     FROM customers c
     LEFT JOIN orders o ON o.customer_id = c.id
     ${search ? 'WHERE c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?' : ''}
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    search ? [search, search, search, search] : []
  );
  res.json({ data: rows });
});

router.get('/me', requireAuth, (req, res) => {
  const customer = get('SELECT * FROM customers WHERE user_id = ?', [req.user.id]);
  if (!customer) return res.status(404).json({ error: 'Customer profile not found' });
  const addresses = all('SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_default DESC, id DESC', [customer.id]);
  return res.json({ data: { ...customer, addresses } });
});

router.post('/', requireAdmin, (req, res, next) => {
  try {
    const payload = customerSchema.parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO customers (first_name, last_name, email, phone, status, group_name, tags, notes, reward_points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.first_name, payload.last_name || null, payload.email, payload.phone || null, payload.status, payload.group_name, payload.tags || null, payload.notes || null, payload.reward_points]
    );
    audit(req.user.id, 'create', 'customer', id, { email: payload.email });
    res.status(201).json({ data: get('SELECT * FROM customers WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Customer not found' });
    const payload = customerSchema.partial().parse(req.body);

    run(
      `UPDATE customers
       SET first_name = ?, last_name = ?, email = ?, phone = ?, status = ?, group_name = ?,
           tags = ?, notes = ?, reward_points = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.first_name ?? existing.first_name,
        payload.last_name ?? existing.last_name,
        payload.email ?? existing.email,
        payload.phone ?? existing.phone,
        payload.status ?? existing.status,
        payload.group_name ?? existing.group_name,
        payload.tags ?? existing.tags,
        payload.notes ?? existing.notes,
        payload.reward_points ?? existing.reward_points,
        existing.id
      ]
    );
    audit(req.user.id, 'update', 'customer', existing.id);
    return res.json({ data: get('SELECT * FROM customers WHERE id = ?', [existing.id]) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/addresses', requireAdmin, (req, res, next) => {
  try {
    const customer = get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    const payload = z.object({
      type: z.enum(['shipping', 'billing']).optional().default('shipping'),
      full_name: z.string().min(2),
      phone: z.string().optional(),
      line1: z.string().min(2),
      line2: z.string().optional(),
      city: z.string().min(2),
      state: z.string().min(2),
      country: z.string().optional().default('India'),
      postal_code: z.string().min(3),
      is_default: z.coerce.boolean().optional().default(false)
    }).parse(req.body);

    if (payload.is_default) {
      run('UPDATE addresses SET is_default = 0 WHERE customer_id = ? AND type = ?', [customer.id, payload.type]);
    }

    const id = insertAndGetId(
      `INSERT INTO addresses (customer_id, type, full_name, phone, line1, line2, city, state, country, postal_code, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [customer.id, payload.type, payload.full_name, payload.phone || null, payload.line1, payload.line2 || null, payload.city, payload.state, payload.country, payload.postal_code, payload.is_default ? 1 : 0]
    );

    return res.status(201).json({ data: get('SELECT * FROM addresses WHERE id = ?', [id]) });
  } catch (error) {
    return next(error);
  }
});

export default router;


import { Router } from 'express';
import { z } from 'zod';
import { all, get, run } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { parseJson } from '../utils/format.js';

const router = Router();

function hydrateOrder(order) {
  if (!order) return null;
  return {
    ...order,
    shipping_address: parseJson(order.shipping_address_json, {}),
    billing_address: parseJson(order.billing_address_json, {}),
    customer: get('SELECT * FROM customers WHERE id = ?', [order.customer_id]),
    items: all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [order.id]),
    payments: all('SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC', [order.id]),
    shipments: all('SELECT * FROM shipments WHERE order_id = ? ORDER BY created_at DESC', [order.id])
  };
}

router.get('/', requireAdmin, (req, res) => {
  const params = [];
  const where = [];
  if (req.query.status) {
    where.push('o.status = ?');
    params.push(req.query.status);
  }
  if (req.query.search) {
    where.push('(o.order_number LIKE ? OR c.email LIKE ? OR c.first_name LIKE ? OR c.last_name LIKE ?)');
    const like = `%${req.query.search}%`;
    params.push(like, like, like, like);
  }

  const rows = all(
    `SELECT o.*, c.first_name, c.last_name, c.email,
            COUNT(oi.id) AS item_count
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN order_items oi ON oi.order_id = o.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY o.id
     ORDER BY o.created_at DESC
     LIMIT 100`,
    params
  );
  res.json({ data: rows });
});

router.get('/:id', requireAdmin, (req, res) => {
  const order = hydrateOrder(get('SELECT * FROM orders WHERE id = ?', [req.params.id]));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json({ data: order });
});

router.patch('/:id/status', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      status: z.enum(['created', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded']).optional(),
      payment_status: z.enum(['pending', 'authorized', 'paid', 'partially_refunded', 'refunded', 'failed']).optional(),
      fulfillment_status: z.enum(['unfulfilled', 'partial', 'fulfilled', 'returned']).optional(),
      note: z.string().optional()
    }).parse(req.body);

    const order = get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    run(
      `UPDATE orders
       SET status = ?, payment_status = ?, fulfillment_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.status || order.status,
        payload.payment_status || order.payment_status,
        payload.fulfillment_status || order.fulfillment_status,
        order.id
      ]
    );
    audit(req.user.id, 'status_update', 'order', order.id, payload);
    return res.json({ data: hydrateOrder(get('SELECT * FROM orders WHERE id = ?', [order.id])) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/refund', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      amount: z.coerce.number().positive(),
      note: z.string().optional()
    }).parse(req.body);
    const order = get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (payload.amount > Number(order.total)) return res.status(422).json({ error: 'Refund exceeds order total' });

    const paymentStatus = payload.amount === Number(order.total) ? 'refunded' : 'partially_refunded';
    run('UPDATE orders SET status = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', ['refunded', paymentStatus, order.id]);
    run(
      `INSERT INTO payments (order_id, provider, method, status, amount, raw_response_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [order.id, 'manual', 'refund', 'refunded', -payload.amount, JSON.stringify({ note: payload.note || null })]
    );
    audit(req.user.id, 'refund', 'order', order.id, payload);
    return res.json({ data: hydrateOrder(get('SELECT * FROM orders WHERE id = ?', [order.id])) });
  } catch (error) {
    return next(error);
  }
});

export default router;


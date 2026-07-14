import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run } from '../db/database.js';
import { optionalAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/products/:productId', (_req, res) => {
  const rows = all(
    `SELECT r.*, c.first_name, c.last_name
     FROM reviews r
     LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.product_id = ? AND r.status = 'approved'
     ORDER BY r.created_at DESC`,
    [_req.params.productId]
  );
  res.json({ data: rows });
});

router.post('/', optionalAuth, (req, res, next) => {
  try {
    const payload = z.object({
      product_id: z.coerce.number().int(),
      customer_email: z.string().email().optional(),
      rating: z.coerce.number().int().min(1).max(5),
      title: z.string().optional(),
      body: z.string().optional(),
      photo_url: z.string().optional(),
      video_url: z.string().optional()
    }).parse(req.body);

    let customer = null;
    if (req.user) customer = get('SELECT * FROM customers WHERE user_id = ?', [req.user.id]);
    if (!customer && payload.customer_email) customer = get('SELECT * FROM customers WHERE email = ?', [payload.customer_email]);

    const verified = customer
      ? get(
        `SELECT oi.id
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
         WHERE o.customer_id = ? AND oi.product_id = ?
         LIMIT 1`,
        [customer.id, payload.product_id]
      )
      : null;

    const id = insertAndGetId(
      `INSERT INTO reviews (product_id, customer_id, rating, title, body, status, verified_purchase, photo_url, video_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payload.product_id, customer?.id || null, payload.rating, payload.title || null, payload.body || null, 'pending', verified ? 1 : 0, payload.photo_url || null, payload.video_url || null]
    );
    res.status(201).json({ data: get('SELECT * FROM reviews WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAdmin, (_req, res) => {
  res.json({
    data: all(
      `SELECT r.*, p.title AS product_title, c.first_name, c.last_name
       FROM reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN customers c ON c.id = r.customer_id
       ORDER BY r.created_at DESC`
    )
  });
});

router.patch('/:id/moderate', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      status: z.enum(['pending', 'approved', 'rejected']),
      reply: z.string().optional()
    }).parse(req.body);
    const review = get('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    run('UPDATE reviews SET status = ?, reply = ? WHERE id = ?', [payload.status, payload.reply ?? review.reply, review.id]);
    return res.json({ data: get('SELECT * FROM reviews WHERE id = ?', [review.id]) });
  } catch (error) {
    return next(error);
  }
});

export default router;


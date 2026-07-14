import { Router } from 'express';
import { z } from 'zod';
import { get, insertAndGetId, run } from '../db/database.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();

router.post('/register', async (req, res, next) => {
  try {
    const payload = z.object({
      name: z.string().min(2),
      email: z.string().email(),
      password: z.string().min(8),
      phone: z.string().optional()
    }).parse(req.body);

    const existing = get('SELECT id FROM users WHERE email = ?', [payload.email]);
    if (existing) return res.status(409).json({ error: 'Email already exists' });

    const passwordHash = await hashPassword(payload.password);
    const userId = insertAndGetId(
      `INSERT INTO users (name, email, password_hash, role, status, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [payload.name, payload.email, passwordHash, 'customer', 'active', payload.phone || null]
    );

    const [firstName, ...rest] = payload.name.split(' ');
    run(
      `INSERT INTO customers (user_id, first_name, last_name, email, phone)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, firstName, rest.join(' ') || null, payload.email, payload.phone || null]
    );

    const user = get('SELECT id, name, email, role, status, phone FROM users WHERE id = ?', [userId]);
    return res.status(201).json({ data: user, token: signToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const payload = z.object({
      email: z.string().email(),
      password: z.string().min(1)
    }).parse(req.body);

    const user = get('SELECT * FROM users WHERE email = ?', [payload.email]);
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'Invalid login' });

    const ok = await comparePassword(payload.password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid login' });

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      phone: user.phone,
      email_verified: Boolean(user.email_verified)
    };

    return res.json({ data: safeUser, token: signToken(user) });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, (req, res) => {
  const customer = get('SELECT * FROM customers WHERE user_id = ?', [req.user.id]);
  res.json({ data: { ...req.user, customer } });
});

export default router;


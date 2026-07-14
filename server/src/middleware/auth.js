import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get } from '../db/database.js';

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) return next();

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = get(
      'SELECT id, name, email, role, status, phone, email_verified FROM users WHERE id = ?',
      [payload.sub]
    );

    if (user && user.status === 'active') req.user = user;
  } catch {
    req.user = null;
  }

  return next();
}

export function requireAuth(req, res, next) {
  optionalAuth(req, res, () => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    return next();
  });
}

export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!['admin', 'manager'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return next();
  });
}


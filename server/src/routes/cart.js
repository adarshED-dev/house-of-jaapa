import { Router } from 'express';
import { z } from 'zod';
import { get, run } from '../db/database.js';
import { optionalAuth } from '../middleware/auth.js';
import { addCartItem, getOrCreateCart, hydrateCart } from '../services/cart.js';

const router = Router();

function customerForUser(user) {
  if (!user) return null;
  return get('SELECT * FROM customers WHERE user_id = ?', [user.id]);
}

router.get('/', optionalAuth, (req, res) => {
  const customer = customerForUser(req.user);
  const cart = getOrCreateCart({
    sessionId: req.query.session_id,
    customerId: customer?.id || null
  });
  res.json({ data: hydrateCart(cart.id) });
});

router.post('/items', optionalAuth, (req, res, next) => {
  try {
    const payload = z.object({
      session_id: z.string().optional(),
      cart_id: z.coerce.number().int().optional(),
      product_id: z.coerce.number().int(),
      variant_id: z.coerce.number().int().nullable().optional(),
      quantity: z.coerce.number().int().positive().max(99)
    }).parse(req.body);

    const customer = customerForUser(req.user);
    const cart = payload.cart_id
      ? get('SELECT * FROM carts WHERE id = ? AND status = ?', [payload.cart_id, 'open'])
      : getOrCreateCart({ sessionId: payload.session_id, customerId: customer?.id || null });

    if (!cart) return res.status(404).json({ error: 'Cart not found' });

    addCartItem({
      cartId: cart.id,
      productId: payload.product_id,
      variantId: payload.variant_id || null,
      quantity: payload.quantity
    });

    return res.status(201).json({ data: hydrateCart(cart.id) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/items/:id', optionalAuth, (req, res, next) => {
  try {
    const payload = z.object({
      quantity: z.coerce.number().int().min(0).max(99)
    }).parse(req.body);
    const item = get('SELECT * FROM cart_items WHERE id = ?', [req.params.id]);
    if (!item) return res.status(404).json({ error: 'Cart item not found' });

    if (payload.quantity === 0) {
      run('DELETE FROM cart_items WHERE id = ?', [item.id]);
    } else {
      run('UPDATE cart_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [payload.quantity, item.id]);
    }

    return res.json({ data: hydrateCart(item.cart_id) });
  } catch (error) {
    return next(error);
  }
});

router.delete('/items/:id', optionalAuth, (req, res) => {
  const item = get('SELECT * FROM cart_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Cart item not found' });

  run('DELETE FROM cart_items WHERE id = ?', [item.id]);
  return res.json({ data: hydrateCart(item.cart_id) });
});

router.post('/discount', optionalAuth, (req, res, next) => {
  try {
    const payload = z.object({
      session_id: z.string().optional(),
      cart_id: z.coerce.number().int().optional(),
      code: z.string().min(1)
    }).parse(req.body);

    const cart = payload.cart_id
      ? get('SELECT * FROM carts WHERE id = ? AND status = ?', [payload.cart_id, 'open'])
      : getOrCreateCart({ sessionId: payload.session_id });

    if (!cart) return res.status(404).json({ error: 'Cart not found' });
    run('UPDATE carts SET coupon_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [payload.code.toUpperCase(), cart.id]);

    const hydrated = hydrateCart(cart.id);
    if (!hydrated.discount) {
      run('UPDATE carts SET coupon_code = NULL WHERE id = ?', [cart.id]);
      return res.status(422).json({ error: 'Discount code is not valid for this cart', data: hydrateCart(cart.id) });
    }

    return res.json({ data: hydrated });
  } catch (error) {
    return next(error);
  }
});

export default router;


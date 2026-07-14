import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run, transaction } from '../db/database.js';
import { optionalAuth } from '../middleware/auth.js';
import { activeDiscount, discountAmount, hydrateCart } from '../services/cart.js';
import { audit } from '../utils/audit.js';
import { cents, todayKey } from '../utils/format.js';

const router = Router();

function orderNumber() {
  const key = todayKey();
  const row = get('SELECT COUNT(*) AS count FROM orders WHERE order_number LIKE ?', [`HOJ-${key}-%`]);
  return `HOJ-${key}-${String(Number(row.count || 0) + 1).padStart(4, '0')}`;
}

function addressSchema() {
  return z.object({
    full_name: z.string().min(2),
    phone: z.string().min(6),
    line1: z.string().min(2),
    line2: z.string().optional(),
    city: z.string().min(2),
    state: z.string().min(2),
    country: z.string().optional().default('India'),
    postal_code: z.string().min(3)
  });
}

function getOrCreateCustomer(customerPayload, user) {
  if (user) {
    const existing = get('SELECT * FROM customers WHERE user_id = ?', [user.id]);
    if (existing) return existing;
  }

  const existingByEmail = get('SELECT * FROM customers WHERE email = ?', [customerPayload.email]);
  if (existingByEmail) return existingByEmail;

  const id = insertAndGetId(
    `INSERT INTO customers (first_name, last_name, email, phone, status, group_name)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      customerPayload.first_name,
      customerPayload.last_name || null,
      customerPayload.email,
      customerPayload.phone || null,
      'active',
      'retail'
    ]
  );
  return get('SELECT * FROM customers WHERE id = ?', [id]);
}

function reduceInventory(item, actorId) {
  const product = get('SELECT * FROM products WHERE id = ?', [item.product_id]);
  if (!product || !Number(product.track_inventory)) return;

  if (!Number(product.continue_selling) && Number(item.available_stock) < Number(item.quantity)) {
    const error = new Error(`${item.product_title} has insufficient stock`);
    error.status = 422;
    throw error;
  }

  let remaining = Number(item.quantity);
  const stocks = all(
    `SELECT *
     FROM inventory
     WHERE product_id = ? AND COALESCE(variant_id, 0) = COALESCE(?, 0)
     ORDER BY (quantity - reserved_quantity) DESC`,
    [item.product_id, item.variant_id || null]
  );

  for (const stock of stocks) {
    if (remaining <= 0) break;
    const available = Math.max(Number(stock.quantity) - Number(stock.reserved_quantity), 0);
    const take = Math.min(available || remaining, remaining);
    run(
      'UPDATE inventory SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [take, stock.id]
    );
    insertAndGetId(
      `INSERT INTO inventory_movements (
        product_id, variant_id, warehouse_id, change_quantity, movement_type, note, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.product_id, item.variant_id || null, stock.warehouse_id, -take, 'sale', `Order checkout for ${item.product_title}`, actorId || null]
    );
    remaining -= take;
  }
}

router.post('/', optionalAuth, (req, res, next) => {
  try {
    const payload = z.object({
      cart_id: z.coerce.number().int().optional(),
      session_id: z.string().optional(),
      customer: z.object({
        first_name: z.string().min(1),
        last_name: z.string().optional(),
        email: z.string().email(),
        phone: z.string().optional()
      }),
      shipping_address: addressSchema(),
      billing_address: addressSchema().optional(),
      payment_method: z.enum(['cod', 'upi', 'card', 'net_banking', 'wallet', 'bnpl']).default('cod'),
      shipping_method: z.string().optional().default('Standard Shipping'),
      notes: z.string().optional(),
      terms_accepted: z.coerce.boolean()
    }).parse(req.body);

    if (!payload.terms_accepted) return res.status(422).json({ error: 'Terms must be accepted' });

    const cartRow = payload.cart_id
      ? get('SELECT * FROM carts WHERE id = ? AND status = ?', [payload.cart_id, 'open'])
      : get('SELECT * FROM carts WHERE session_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [payload.session_id, 'open']);

    if (!cartRow) return res.status(404).json({ error: 'Cart not found' });

    const cart = hydrateCart(cartRow.id);
    if (!cart.items.length) return res.status(422).json({ error: 'Cart is empty' });

    const created = transaction(() => {
      const customer = getOrCreateCustomer(payload.customer, req.user);

      const discount = activeDiscount(cart.coupon_code, cart.totals.subtotal);
      const discountTotal = discountAmount(discount, cart.totals.subtotal);
      const taxable = Math.max(cart.totals.subtotal - discountTotal, 0);
      const shippingRate = get(
        `SELECT *
         FROM shipping_rates
         WHERE active = 1 AND min_order_value <= ?
         ORDER BY price ASC, min_order_value DESC
         LIMIT 1`,
        [taxable]
      );
      const shippingTotal = cents(Number(shippingRate?.price ?? 199));
      const taxTotal = cart.totals.tax_total;
      const total = cents(taxable + taxTotal + shippingTotal);

      const orderId = insertAndGetId(
        `INSERT INTO orders (
          order_number, customer_id, status, payment_status, fulfillment_status, currency,
          subtotal, discount_total, tax_total, shipping_total, total,
          shipping_address_json, billing_address_json, payment_method, shipping_method,
          coupon_code, notes, tags, fraud_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderNumber(),
          customer.id,
          'confirmed',
          payload.payment_method === 'cod' ? 'pending' : 'authorized',
          'unfulfilled',
          'INR',
          cart.totals.subtotal,
          discountTotal,
          taxTotal,
          shippingTotal,
          total,
          JSON.stringify(payload.shipping_address),
          JSON.stringify(payload.billing_address || payload.shipping_address),
          payload.payment_method,
          shippingRate?.name || payload.shipping_method,
          discount?.code || null,
          payload.notes || null,
          null,
          0
        ]
      );

      for (const item of cart.items) {
        reduceInventory(item, req.user?.id || null);
        insertAndGetId(
          `INSERT INTO order_items (order_id, product_id, variant_id, title, sku, quantity, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            orderId,
            item.product_id,
            item.variant_id || null,
            item.variant_title ? `${item.product_title} - ${item.variant_title}` : item.product_title,
            item.variant_sku || item.product_sku,
            item.quantity,
            item.unit_price,
            item.line_total
          ]
        );
      }

      insertAndGetId(
        `INSERT INTO payments (order_id, provider, method, status, amount)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, 'manual', payload.payment_method, payload.payment_method === 'cod' ? 'pending' : 'authorized', total]
      );

      insertAndGetId(
        `INSERT INTO shipments (order_id, carrier, status, estimated_delivery)
         VALUES (?, ?, ?, ?)`,
        [orderId, 'Manual', 'pending', shippingRate?.estimated_days || '3-6 business days']
      );

      if (discount?.id) {
        run('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?', [discount.id]);
      }

      run("UPDATE carts SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [cart.id]);
      audit(req.user?.id || null, 'checkout', 'order', orderId, { cart_id: cart.id });

      return get('SELECT * FROM orders WHERE id = ?', [orderId]);
    });

    return res.status(201).json({ data: created });
  } catch (error) {
    return next(error);
  }
});

export default router;


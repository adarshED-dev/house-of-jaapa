import { all, get, insertAndGetId, run } from '../db/database.js';
import { cents } from '../utils/format.js';

export function activeDiscount(code, subtotal) {
  if (!code) return null;
  const now = new Date().toISOString();
  const discount = get(
    `SELECT *
     FROM discounts
     WHERE upper(code) = upper(?)
       AND active = 1
       AND (starts_at IS NULL OR starts_at <= ?)
       AND (ends_at IS NULL OR ends_at >= ?)
       AND (usage_limit IS NULL OR used_count < usage_limit)
     LIMIT 1`,
    [code, now, now]
  );

  if (!discount || Number(subtotal || 0) < Number(discount.min_order_value || 0)) return null;
  return discount;
}

export function discountAmount(discount, subtotal) {
  if (!discount) return 0;
  if (discount.discount_type === 'percentage') {
    return cents((Number(subtotal) * Number(discount.value)) / 100);
  }
  if (discount.discount_type === 'fixed') {
    return cents(Math.min(Number(discount.value), Number(subtotal)));
  }
  return 0;
}

export function getOrCreateCart({ sessionId, customerId = null }) {
  let cart = null;

  if (customerId) {
    cart = get('SELECT * FROM carts WHERE customer_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [customerId, 'open']);
  }

  if (!cart && sessionId) {
    cart = get('SELECT * FROM carts WHERE session_id = ? AND status = ? ORDER BY id DESC LIMIT 1', [sessionId, 'open']);
  }

  if (cart) return cart;

  const id = insertAndGetId(
    'INSERT INTO carts (customer_id, session_id, status) VALUES (?, ?, ?)',
    [customerId, sessionId || `guest-${Date.now()}`, 'open']
  );
  return get('SELECT * FROM carts WHERE id = ?', [id]);
}

export function hydrateCart(cartId) {
  const cart = get('SELECT * FROM carts WHERE id = ?', [cartId]);
  if (!cart) return null;

  const items = all(
    `SELECT ci.*, p.title AS product_title, p.slug AS product_slug, p.status AS product_status,
            p.track_inventory, p.continue_selling, p.sku AS product_sku,
            pv.title AS variant_title, pv.sku AS variant_sku,
            (SELECT url FROM product_media pm WHERE pm.product_id = p.id ORDER BY position, id LIMIT 1) AS image_url,
            COALESCE(SUM(i.quantity - i.reserved_quantity), 0) AS available_stock
     FROM cart_items ci
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN product_variants pv ON pv.id = ci.variant_id
     LEFT JOIN inventory i ON i.product_id = p.id AND (ci.variant_id IS NULL OR i.variant_id = ci.variant_id)
     WHERE ci.cart_id = ?
     GROUP BY ci.id
     ORDER BY ci.created_at`,
    [cartId]
  ).map((item) => ({
    ...item,
    line_total: cents(Number(item.quantity) * Number(item.unit_price)),
    available_stock: Number(item.available_stock || 0)
  }));

  const subtotal = cents(items.reduce((sum, item) => sum + item.line_total, 0));
  const discount = activeDiscount(cart.coupon_code, subtotal);
  const discount_total = discountAmount(discount, subtotal);
  const taxable = Math.max(subtotal - discount_total, 0);
  const taxRule = get('SELECT * FROM tax_rules WHERE active = 1 ORDER BY id LIMIT 1');
  const tax_rate = Number(taxRule?.rate || 0);
  const tax_total = cents((taxable * tax_rate) / 100);

  return {
    ...cart,
    items,
    discount,
    totals: {
      subtotal,
      discount_total,
      tax_total,
      tax_rate,
      item_count: items.reduce((sum, item) => sum + Number(item.quantity), 0)
    }
  };
}

export function addCartItem({ cartId, productId, variantId = null, quantity }) {
  const product = get(
    `SELECT p.*, pv.id AS selected_variant_id, pv.regular_price AS variant_price, pv.sku AS variant_sku
     FROM products p
     LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.id = ?
     WHERE p.id = ?`,
    [variantId || null, productId]
  );

  if (!product || product.status !== 'active') {
    const error = new Error('Product is not available');
    error.status = 422;
    throw error;
  }

  const unitPrice = Number(product.variant_price ?? product.regular_price);
  const existing = get(
    `SELECT * FROM cart_items
     WHERE cart_id = ? AND product_id = ? AND COALESCE(variant_id, 0) = COALESCE(?, 0)`,
    [cartId, productId, variantId || null]
  );

  if (existing) {
    run(
      'UPDATE cart_items SET quantity = quantity + ?, unit_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [quantity, unitPrice, existing.id]
    );
    return existing.id;
  }

  return insertAndGetId(
    `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, unit_price)
     VALUES (?, ?, ?, ?, ?)`,
    [cartId, productId, variantId || null, quantity, unitPrice]
  );
}


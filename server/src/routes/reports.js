import { Router } from 'express';
import { all, get } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', requireAdmin, (_req, res) => {
  const sales = get(
    `SELECT COUNT(*) AS order_count,
            COALESCE(SUM(total), 0) AS revenue,
            COALESCE(AVG(total), 0) AS average_order_value
     FROM orders
     WHERE status NOT IN ('cancelled')`
  );
  const products = get('SELECT COUNT(*) AS count FROM products WHERE status != ?', ['archived']);
  const customers = get('SELECT COUNT(*) AS count FROM customers');
  const lowStock = get(
    `SELECT COUNT(*) AS count
     FROM inventory
     WHERE (quantity - reserved_quantity) <= low_stock_threshold`
  );
  const recentOrders = all(
    `SELECT o.*, c.first_name, c.last_name, c.email
     FROM orders o
     LEFT JOIN customers c ON c.id = o.customer_id
     ORDER BY o.created_at DESC
     LIMIT 8`
  );
  const topProducts = all(
    `SELECT oi.product_id, oi.title, SUM(oi.quantity) AS units_sold, SUM(oi.line_total) AS revenue
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.status NOT IN ('cancelled')
     GROUP BY oi.product_id, oi.title
     ORDER BY units_sold DESC
     LIMIT 8`
  );

  res.json({
    data: {
      sales,
      products,
      customers,
      low_stock: lowStock,
      recent_orders: recentOrders,
      top_products: topProducts
    }
  });
});

router.get('/sales', requireAdmin, (_req, res) => {
  const rows = all(
    `SELECT date(created_at) AS day,
            COUNT(*) AS order_count,
            COALESCE(SUM(subtotal), 0) AS subtotal,
            COALESCE(SUM(discount_total), 0) AS discounts,
            COALESCE(SUM(tax_total), 0) AS taxes,
            COALESCE(SUM(shipping_total), 0) AS shipping,
            COALESCE(SUM(total), 0) AS revenue
     FROM orders
     WHERE status NOT IN ('cancelled')
     GROUP BY date(created_at)
     ORDER BY day DESC
     LIMIT 60`
  );
  res.json({ data: rows });
});

router.get('/inventory', requireAdmin, (_req, res) => {
  const rows = all(
    `SELECT p.id AS product_id, p.title, p.sku,
            SUM(i.quantity) AS stock_quantity,
            SUM(i.reserved_quantity) AS reserved_quantity,
            SUM(i.incoming_quantity) AS incoming_quantity,
            SUM(i.quantity - i.reserved_quantity) AS available_quantity
     FROM products p
     LEFT JOIN inventory i ON i.product_id = p.id
     GROUP BY p.id
     ORDER BY available_quantity ASC`
  );
  res.json({ data: rows });
});

export default router;


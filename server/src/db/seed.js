import { initDb, get, run, insertAndGetId } from './database.js';
import { hashPassword } from '../utils/password.js';
import { slugify } from '../utils/format.js';

initDb();

const existingAdmin = get('SELECT id FROM users WHERE email = ?', ['admin@houseofjaapa.com']);

if (!existingAdmin) {
  const passwordHash = await hashPassword('admin12345');

  const adminId = insertAndGetId(
    `INSERT INTO users (name, email, password_hash, role, status, email_verified)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['House of Jaapa Admin', 'admin@houseofjaapa.com', passwordHash, 'admin', 'active', 1]
  );

  const customerId = insertAndGetId(
    `INSERT INTO customers (first_name, last_name, email, phone, group_name, tags, reward_points)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['Anaya', 'Sharma', 'anaya@example.com', '9876543210', 'vip', 'repeat,ethnicwear', 240]
  );

  run(
    `INSERT INTO addresses (customer_id, type, full_name, phone, line1, city, state, country, postal_code, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customerId, 'shipping', 'Anaya Sharma', '9876543210', '14 Garden Road', 'Jaipur', 'Rajasthan', 'India', '302001', 1]
  );

  const brandId = insertAndGetId(
    'INSERT INTO brands (name, slug, description) VALUES (?, ?, ?)',
    ['House of Jaapa', 'house-of-jaapa', 'Modern Indian festive and everyday wear.']
  );
  const vendorId = insertAndGetId(
    'INSERT INTO vendors (name, email, phone) VALUES (?, ?, ?)',
    ['Jaapa Studio', 'studio@houseofjaapa.com', '9000000000']
  );

  const womenId = insertAndGetId(
    `INSERT INTO categories (name, slug, description, seo_title, seo_description, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['Women', 'women', 'Kurtas, co-ords, dresses, and festive sets.', 'Women Ethnic Wear', 'Shop House of Jaapa women clothing.', 1]
  );
  const festiveId = insertAndGetId(
    `INSERT INTO categories (parent_id, name, slug, description, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [womenId, 'Festive Sets', 'festive-sets', 'Occasion-ready coordinated pieces.', 1]
  );

  const collectionId = insertAndGetId(
    `INSERT INTO collections (name, slug, type, status, conditions_json, seo_title, seo_description)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['New Festive Edit', 'new-festive-edit', 'manual', 'active', JSON.stringify({ match: 'manual' }), 'New Festive Edit', 'Fresh occasionwear arrivals from House of Jaapa.']
  );

  const warehouseId = insertAndGetId(
    `INSERT INTO warehouses (name, code, address, city, state, postal_code)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['Main Jaipur Warehouse', 'JP-MAIN', 'Sitapura Industrial Area', 'Jaipur', 'Rajasthan', '302022']
  );

  const productSeeds = [
    {
      title: 'Ivory Bloom Kurta Set',
      sku: 'HOJ-IVORY-BLOOM',
      barcode: '890100000001',
      price: 4299,
      compare: 4999,
      color: 'Ivory',
      size: 'M',
      stock: 24,
      image: 'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=900&q=80',
      tags: 'kurta,set,festive'
    },
    {
      title: 'Sage Garden Co-ord',
      sku: 'HOJ-SAGE-COORD',
      barcode: '890100000002',
      price: 3899,
      compare: 4599,
      color: 'Sage',
      size: 'L',
      stock: 18,
      image: 'https://images.unsplash.com/photo-1603217192634-61068e4d4bf0?auto=format&fit=crop&w=900&q=80',
      tags: 'coord,cotton,new'
    },
    {
      title: 'Ruby Handblock Anarkali',
      sku: 'HOJ-RUBY-ANARKALI',
      barcode: '890100000003',
      price: 7299,
      compare: 8499,
      color: 'Ruby',
      size: 'S',
      stock: 7,
      image: 'https://images.unsplash.com/photo-1617019114583-affb34d1b3cd?auto=format&fit=crop&w=900&q=80',
      tags: 'anarkali,handblock,premium'
    }
  ];

  for (const item of productSeeds) {
    const productId = insertAndGetId(
      `INSERT INTO products (
        title, slug, description, status, product_type, category_id, brand_id, vendor_id,
        sku, barcode, regular_price, compare_at_price, cost_price, wholesale_price,
        tags, attributes_json, seo_title, seo_description, featured, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        item.title,
        slugify(item.title),
        'A House of Jaapa signature piece with breathable fabric, refined finishing, and easy occasion styling.',
        'active',
        'physical',
        festiveId,
        brandId,
        vendorId,
        item.sku,
        item.barcode,
        item.price,
        item.compare,
        Math.round(item.price * 0.45),
        Math.round(item.price * 0.75),
        item.tags,
        JSON.stringify({ fabric: 'Cotton blend', care: 'Dry clean recommended', occasion: 'Festive' }),
        item.title,
        `Buy ${item.title} from House of Jaapa.`,
        1
      ]
    );

    const variantId = insertAndGetId(
      `INSERT INTO product_variants (product_id, title, sku, barcode, size, color, material, regular_price, compare_at_price, cost_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [productId, `${item.color} / ${item.size}`, `${item.sku}-${item.size}`, `${item.barcode}${item.size}`, item.size, item.color, 'Cotton blend', item.price, item.compare, Math.round(item.price * 0.45)]
    );

    run(
      `INSERT INTO product_media (product_id, type, url, alt_text, position)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, 'image', item.image, item.title, 0]
    );

    run(
      `INSERT INTO inventory (product_id, variant_id, warehouse_id, quantity, low_stock_threshold)
       VALUES (?, ?, ?, ?, ?)`,
      [productId, variantId, warehouseId, item.stock, 6]
    );

    run(
      `INSERT INTO collection_products (collection_id, product_id, position)
       VALUES (?, ?, ?)`,
      [collectionId, productId, productId]
    );
  }

  run(
    `INSERT INTO discounts (code, title, discount_type, value, min_order_value, usage_limit, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['JAAPA10', 'Launch offer', 'percentage', 10, 1500, 500, 1]
  );

  const zoneId = insertAndGetId(
    'INSERT INTO shipping_zones (name, countries) VALUES (?, ?)',
    ['India', 'India']
  );
  run(
    `INSERT INTO shipping_rates (zone_id, name, rate_type, price, min_order_value, estimated_days)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [zoneId, 'Standard Shipping', 'flat', 199, 0, '3-6 business days']
  );
  run(
    `INSERT INTO shipping_rates (zone_id, name, rate_type, price, min_order_value, estimated_days)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [zoneId, 'Free Shipping', 'free', 0, 5000, '3-6 business days']
  );

  run(
    'INSERT INTO tax_rules (name, region, tax_type, rate, hsn_sac_code) VALUES (?, ?, ?, ?, ?)',
    ['Apparel GST', 'India', 'GST', 5, '6204']
  );

  const settings = {
    store: {
      name: 'House of Jaapa',
      supportEmail: 'care@houseofjaapa.com',
      phone: '9000000000',
      country: 'India',
      timezone: 'Asia/Kolkata'
    },
    currency: { default: 'INR', enabled: ['INR'] },
    checkout: { guestCheckout: true, termsRequired: true },
    seo: { title: 'House of Jaapa', description: 'Thoughtful Indian wear for everyday and occasion dressing.' }
  };

  for (const [key, value] of Object.entries(settings)) {
    run('INSERT INTO settings (key, value_json) VALUES (?, ?)', [key, JSON.stringify(value)]);
  }

  run(
    `INSERT INTO cms_pages (title, slug, page_type, body, status, seo_title, seo_description, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ['About House of Jaapa', 'about', 'page', 'House of Jaapa creates expressive Indian wear with a focus on craft, comfort, and modern silhouettes.', 'published', 'About House of Jaapa', 'Learn about House of Jaapa.']
  );

  run(
    `INSERT INTO notifications (channel, template_key, subject, body)
     VALUES (?, ?, ?, ?)`,
    ['email', 'order_confirmation', 'Your House of Jaapa order is confirmed', 'Thank you for your order. We will notify you once it ships.']
  );

  run(
    `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata_json)
     VALUES (?, ?, ?, ?, ?)`,
    [adminId, 'seed', 'database', null, JSON.stringify({ message: 'Initial ecommerce data seeded' })]
  );

  console.log('Seeded House of Jaapa database.');
} else {
  console.log('Seed data already exists.');
}


import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run, transaction } from '../db/database.js';
import { requireAdmin, optionalAuth } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { normalizeTags, parseJson, slugify } from '../utils/format.js';

const router = Router();

const productSchema = z.object({
  title: z.string().min(2),
  description: z.string().optional().default(''),
  status: z.enum(['draft', 'active', 'archived']).optional().default('draft'),
  product_type: z.enum(['physical', 'digital']).optional().default('physical'),
  category_id: z.number().int().nullable().optional(),
  category_name: z.string().optional(),
  brand_id: z.number().int().nullable().optional(),
  brand_name: z.string().optional(),
  vendor_id: z.number().int().nullable().optional(),
  vendor_name: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  regular_price: z.coerce.number().nonnegative().default(0),
  compare_at_price: z.coerce.number().nonnegative().nullable().optional(),
  cost_price: z.coerce.number().nonnegative().nullable().optional(),
  wholesale_price: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().optional().default('INR'),
  tax_inclusive: z.coerce.boolean().optional().default(true),
  visibility: z.enum(['visible', 'hidden']).optional().default('visible'),
  tags: z.union([z.string(), z.array(z.string())]).optional(),
  attributes: z.record(z.any()).optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  featured: z.coerce.boolean().optional().default(false),
  digital: z.coerce.boolean().optional().default(false),
  downloadable_file_url: z.string().optional(),
  track_inventory: z.coerce.boolean().optional().default(true),
  continue_selling: z.coerce.boolean().optional().default(false),
  template_name: z.string().optional(),
  scheduled_for: z.string().nullable().optional(),
  variants: z.array(z.object({
    id: z.number().int().optional(),
    title: z.string().min(1),
    sku: z.string().min(1),
    barcode: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    material: z.string().optional(),
    regular_price: z.coerce.number().nonnegative().nullable().optional(),
    compare_at_price: z.coerce.number().nonnegative().nullable().optional(),
    cost_price: z.coerce.number().nonnegative().nullable().optional(),
    stock_policy: z.enum(['deny', 'continue']).optional().default('deny'),
    position: z.coerce.number().int().optional().default(0),
    initial_stock: z.coerce.number().int().optional().default(0)
  })).optional(),
  media: z.array(z.object({
    type: z.enum(['image', 'video', 'model', 'file']).optional().default('image'),
    url: z.string().min(1),
    alt_text: z.string().optional(),
    position: z.coerce.number().int().optional().default(0)
  })).optional()
});

function bool(value) {
  return Boolean(Number(value || 0));
}

function uniqueSlug(table, title, currentId = null) {
  const base = slugify(title) || 'item';
  let slug = base;
  let index = 2;

  while (
    get(
      `SELECT id FROM ${table} WHERE slug = ? ${currentId ? 'AND id != ?' : ''}`,
      currentId ? [slug, currentId] : [slug]
    )
  ) {
    slug = `${base}-${index}`;
    index += 1;
  }

  return slug;
}

function findOrCreateBrand(payload) {
  if (payload.brand_id) return payload.brand_id;
  if (!payload.brand_name) return null;

  const existing = get('SELECT id FROM brands WHERE lower(name) = lower(?)', [payload.brand_name]);
  if (existing) return existing.id;

  return insertAndGetId(
    'INSERT INTO brands (name, slug) VALUES (?, ?)',
    [payload.brand_name, uniqueSlug('brands', payload.brand_name)]
  );
}

function findOrCreateVendor(payload) {
  if (payload.vendor_id) return payload.vendor_id;
  if (!payload.vendor_name) return null;

  const existing = get('SELECT id FROM vendors WHERE lower(name) = lower(?)', [payload.vendor_name]);
  if (existing) return existing.id;

  return insertAndGetId('INSERT INTO vendors (name) VALUES (?)', [payload.vendor_name]);
}

function findOrCreateCategory(payload) {
  if (payload.category_id) return payload.category_id;
  if (!payload.category_name) return null;

  const existing = get('SELECT id FROM categories WHERE lower(name) = lower(?)', [payload.category_name]);
  if (existing) return existing.id;

  return insertAndGetId(
    'INSERT INTO categories (name, slug, status) VALUES (?, ?, ?)',
    [payload.category_name, uniqueSlug('categories', payload.category_name), 'active']
  );
}

function serializeProduct(row) {
  if (!row) return null;

  return {
    ...row,
    tax_inclusive: bool(row.tax_inclusive),
    featured: bool(row.featured),
    digital: bool(row.digital),
    track_inventory: bool(row.track_inventory),
    continue_selling: bool(row.continue_selling),
    attributes: parseJson(row.attributes_json, {}),
    available_stock: Number(row.available_stock || 0),
    media: all('SELECT * FROM product_media WHERE product_id = ? ORDER BY position, id', [row.id]),
    variants: all(
      `SELECT pv.*,
              COALESCE(SUM(i.quantity - i.reserved_quantity), 0) AS available_stock
       FROM product_variants pv
       LEFT JOIN inventory i ON i.variant_id = pv.id
       WHERE pv.product_id = ?
       GROUP BY pv.id
       ORDER BY pv.position, pv.id`,
      [row.id]
    ).map((variant) => ({ ...variant, available_stock: Number(variant.available_stock || 0) })),
    inventory: all(
      `SELECT i.*, w.name AS warehouse_name, w.code AS warehouse_code, pv.title AS variant_title
       FROM inventory i
       JOIN warehouses w ON w.id = i.warehouse_id
       LEFT JOIN product_variants pv ON pv.id = i.variant_id
       WHERE i.product_id = ?
       ORDER BY w.name`,
      [row.id]
    ),
    collections: all(
      `SELECT c.id, c.name, c.slug
       FROM collection_products cp
       JOIN collections c ON c.id = cp.collection_id
       WHERE cp.product_id = ?
       ORDER BY cp.position`,
      [row.id]
    )
  };
}

function getProduct(id) {
  const row = get(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name, v.name AS vendor_name,
            COALESCE(SUM(i.quantity - i.reserved_quantity), 0) AS available_stock
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.id = ?
     GROUP BY p.id`,
    [id]
  );

  return serializeProduct(row);
}

router.get('/', optionalAuth, (req, res) => {
  const params = [];
  const where = [];

  if (req.query.status) {
    where.push('p.status = ?');
    params.push(req.query.status);
  } else if (!req.user) {
    where.push("p.status = 'active'");
    where.push("p.visibility = 'visible'");
  }

  if (req.query.category_id) {
    where.push('p.category_id = ?');
    params.push(req.query.category_id);
  }

  if (req.query.featured) {
    where.push('p.featured = 1');
  }

  if (req.query.search) {
    where.push('(p.title LIKE ? OR p.sku LIKE ? OR p.tags LIKE ?)');
    const like = `%${req.query.search}%`;
    params.push(like, like, like);
  }

  const limit = Math.min(Number(req.query.limit || 50), 100);
  const offset = Math.max(Number(req.query.offset || 0), 0);

  const rows = all(
    `SELECT p.*, c.name AS category_name, b.name AS brand_name, v.name AS vendor_name,
            COALESCE(SUM(i.quantity - i.reserved_quantity), 0) AS available_stock,
            (SELECT url FROM product_media pm WHERE pm.product_id = p.id ORDER BY position, id LIMIT 1) AS primary_image
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN brands b ON b.id = p.brand_id
     LEFT JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN inventory i ON i.product_id = p.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY p.id
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ).map((row) => ({
    ...row,
    featured: bool(row.featured),
    digital: bool(row.digital),
    available_stock: Number(row.available_stock || 0)
  }));

  res.json({ data: rows, count: rows.length });
});

router.get('/:id', optionalAuth, (req, res) => {
  const product = getProduct(req.params.id);
  if (!product || (!req.user && product.status !== 'active')) {
    return res.status(404).json({ error: 'Product not found' });
  }
  return res.json({ data: product });
});

router.post('/', requireAdmin, (req, res, next) => {
  try {
    const payload = productSchema.parse(req.body);

    const productId = transaction(() => {
      const brandId = findOrCreateBrand(payload);
      const vendorId = findOrCreateVendor(payload);
      const categoryId = findOrCreateCategory(payload);
      const slug = uniqueSlug('products', payload.title);
      const sku = payload.sku || `HOJ-${Date.now()}`;

      const id = insertAndGetId(
        `INSERT INTO products (
          title, slug, description, status, product_type, category_id, brand_id, vendor_id,
          sku, barcode, regular_price, compare_at_price, cost_price, wholesale_price,
          currency, tax_inclusive, visibility, tags, attributes_json, seo_title,
          seo_description, url_handle, featured, digital, downloadable_file_url,
          track_inventory, continue_selling, template_name, scheduled_for,
          published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payload.title,
          slug,
          payload.description,
          payload.status,
          payload.product_type,
          categoryId,
          brandId,
          vendorId,
          sku,
          payload.barcode || null,
          payload.regular_price,
          payload.compare_at_price || null,
          payload.cost_price || null,
          payload.wholesale_price || null,
          payload.currency,
          payload.tax_inclusive ? 1 : 0,
          payload.visibility,
          normalizeTags(payload.tags),
          JSON.stringify(payload.attributes || {}),
          payload.seo_title || payload.title,
          payload.seo_description || null,
          slug,
          payload.featured ? 1 : 0,
          payload.digital ? 1 : 0,
          payload.downloadable_file_url || null,
          payload.track_inventory ? 1 : 0,
          payload.continue_selling ? 1 : 0,
          payload.template_name || null,
          payload.scheduled_for || null,
          payload.status === 'active' ? new Date().toISOString() : null
        ]
      );

      const warehouse = get('SELECT id FROM warehouses WHERE active = 1 ORDER BY id LIMIT 1');
      const variants = payload.variants?.length
        ? payload.variants
        : [{
          title: 'Default',
          sku,
          regular_price: payload.regular_price,
          compare_at_price: payload.compare_at_price || null,
          cost_price: payload.cost_price || null,
          initial_stock: 0
        }];

      for (const [index, variant] of variants.entries()) {
        const variantId = insertAndGetId(
          `INSERT INTO product_variants (
            product_id, title, sku, barcode, size, color, material, regular_price,
            compare_at_price, cost_price, stock_policy, position
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            variant.title,
            variant.sku,
            variant.barcode || null,
            variant.size || null,
            variant.color || null,
            variant.material || null,
            variant.regular_price ?? payload.regular_price,
            variant.compare_at_price ?? payload.compare_at_price ?? null,
            variant.cost_price ?? payload.cost_price ?? null,
            variant.stock_policy || 'deny',
            variant.position ?? index
          ]
        );

        if (warehouse) {
          run(
            `INSERT INTO inventory (product_id, variant_id, warehouse_id, quantity, low_stock_threshold)
             VALUES (?, ?, ?, ?, ?)`,
            [id, variantId, warehouse.id, Number(variant.initial_stock || 0), 5]
          );
        }
      }

      for (const [index, media] of (payload.media || []).entries()) {
        run(
          `INSERT INTO product_media (product_id, type, url, alt_text, position)
           VALUES (?, ?, ?, ?, ?)`,
          [id, media.type || 'image', media.url, media.alt_text || payload.title, media.position ?? index]
        );
      }

      audit(req.user.id, 'create', 'product', id, { title: payload.title });
      return id;
    });

    return res.status(201).json({ data: getProduct(productId) });
  } catch (error) {
    return next(error);
  }
});

router.put('/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = getProduct(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    const payload = productSchema.partial().parse(req.body);

    transaction(() => {
      const nextTitle = payload.title ?? existing.title;
      const slug = payload.title ? uniqueSlug('products', nextTitle, existing.id) : existing.slug;
      const brandId = findOrCreateBrand(payload) ?? existing.brand_id;
      const vendorId = findOrCreateVendor(payload) ?? existing.vendor_id;
      const categoryId = findOrCreateCategory(payload) ?? existing.category_id;

      run(
        `UPDATE products
         SET title = ?, slug = ?, description = ?, status = ?, product_type = ?, category_id = ?,
             brand_id = ?, vendor_id = ?, sku = ?, barcode = ?, regular_price = ?,
             compare_at_price = ?, cost_price = ?, wholesale_price = ?, currency = ?,
             tax_inclusive = ?, visibility = ?, tags = ?, attributes_json = ?,
             seo_title = ?, seo_description = ?, url_handle = ?, featured = ?, digital = ?,
             downloadable_file_url = ?, track_inventory = ?, continue_selling = ?,
             template_name = ?, scheduled_for = ?, published_at = COALESCE(published_at, ?),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          nextTitle,
          slug,
          payload.description ?? existing.description,
          payload.status ?? existing.status,
          payload.product_type ?? existing.product_type,
          categoryId || null,
          brandId || null,
          vendorId || null,
          payload.sku ?? existing.sku,
          payload.barcode ?? existing.barcode,
          payload.regular_price ?? existing.regular_price,
          payload.compare_at_price ?? existing.compare_at_price,
          payload.cost_price ?? existing.cost_price,
          payload.wholesale_price ?? existing.wholesale_price,
          payload.currency ?? existing.currency,
          payload.tax_inclusive === undefined ? Number(existing.tax_inclusive) : (payload.tax_inclusive ? 1 : 0),
          payload.visibility ?? existing.visibility,
          payload.tags === undefined ? existing.tags : normalizeTags(payload.tags),
          payload.attributes === undefined ? existing.attributes_json : JSON.stringify(payload.attributes),
          payload.seo_title ?? existing.seo_title,
          payload.seo_description ?? existing.seo_description,
          slug,
          payload.featured === undefined ? Number(existing.featured) : (payload.featured ? 1 : 0),
          payload.digital === undefined ? Number(existing.digital) : (payload.digital ? 1 : 0),
          payload.downloadable_file_url ?? existing.downloadable_file_url,
          payload.track_inventory === undefined ? Number(existing.track_inventory) : (payload.track_inventory ? 1 : 0),
          payload.continue_selling === undefined ? Number(existing.continue_selling) : (payload.continue_selling ? 1 : 0),
          payload.template_name ?? existing.template_name,
          payload.scheduled_for ?? existing.scheduled_for,
          payload.status === 'active' ? new Date().toISOString() : existing.published_at,
          existing.id
        ]
      );

      if (payload.variants) {
        run('DELETE FROM product_variants WHERE product_id = ?', [existing.id]);
        const warehouse = get('SELECT id FROM warehouses WHERE active = 1 ORDER BY id LIMIT 1');
        for (const [index, variant] of payload.variants.entries()) {
          const variantId = insertAndGetId(
            `INSERT INTO product_variants (
              product_id, title, sku, barcode, size, color, material, regular_price,
              compare_at_price, cost_price, stock_policy, position
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              existing.id,
              variant.title,
              variant.sku,
              variant.barcode || null,
              variant.size || null,
              variant.color || null,
              variant.material || null,
              variant.regular_price ?? payload.regular_price ?? existing.regular_price,
              variant.compare_at_price ?? payload.compare_at_price ?? existing.compare_at_price,
              variant.cost_price ?? payload.cost_price ?? existing.cost_price,
              variant.stock_policy || 'deny',
              variant.position ?? index
            ]
          );

          if (warehouse) {
            run(
              `INSERT INTO inventory (product_id, variant_id, warehouse_id, quantity, low_stock_threshold)
               VALUES (?, ?, ?, ?, ?)`,
              [existing.id, variantId, warehouse.id, Number(variant.initial_stock || 0), 5]
            );
          }
        }
      }

      if (payload.media) {
        run('DELETE FROM product_media WHERE product_id = ?', [existing.id]);
        for (const [index, media] of payload.media.entries()) {
          run(
            `INSERT INTO product_media (product_id, type, url, alt_text, position)
             VALUES (?, ?, ?, ?, ?)`,
            [existing.id, media.type || 'image', media.url, media.alt_text || nextTitle, media.position ?? index]
          );
        }
      }

      audit(req.user.id, 'update', 'product', existing.id, { title: nextTitle });
    });

    return res.json({ data: getProduct(req.params.id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/duplicate', requireAdmin, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const duplicateId = transaction(() => {
    const title = `Copy of ${existing.title}`;
    const slug = uniqueSlug('products', title);
    const sku = `${existing.sku}-COPY-${Date.now()}`;

    const id = insertAndGetId(
      `INSERT INTO products (
        title, slug, description, status, product_type, category_id, brand_id, vendor_id,
        sku, barcode, regular_price, compare_at_price, cost_price, wholesale_price,
        currency, tax_inclusive, visibility, tags, attributes_json, seo_title,
        seo_description, url_handle, featured, digital, downloadable_file_url,
        track_inventory, continue_selling, template_name
      )
      SELECT ?, ?, description, 'draft', product_type, category_id, brand_id, vendor_id,
             ?, NULL, regular_price, compare_at_price, cost_price, wholesale_price,
             currency, tax_inclusive, visibility, tags, attributes_json, ?, seo_description,
             ?, featured, digital, downloadable_file_url, track_inventory, continue_selling, template_name
      FROM products WHERE id = ?`,
      [title, slug, sku, title, slug, existing.id]
    );

    for (const variant of existing.variants) {
      insertAndGetId(
        `INSERT INTO product_variants (product_id, title, sku, barcode, size, color, material, regular_price, compare_at_price, cost_price, stock_policy, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, variant.title, `${variant.sku}-COPY-${Date.now()}`, null, variant.size, variant.color, variant.material, variant.regular_price, variant.compare_at_price, variant.cost_price, variant.stock_policy, variant.position]
      );
    }

    for (const media of existing.media) {
      run(
        'INSERT INTO product_media (product_id, type, url, alt_text, position) VALUES (?, ?, ?, ?, ?)',
        [id, media.type, media.url, media.alt_text, media.position]
      );
    }

    audit(req.user.id, 'duplicate', 'product', id, { source_product_id: existing.id });
    return id;
  });

  return res.status(201).json({ data: getProduct(duplicateId) });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  run("UPDATE products SET status = 'archived', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [existing.id]);
  audit(req.user.id, 'archive', 'product', existing.id);
  return res.json({ data: getProduct(existing.id) });
});

export default router;


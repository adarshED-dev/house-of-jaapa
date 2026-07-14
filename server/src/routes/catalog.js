import { Router } from 'express';
import { z } from 'zod';
import { all, get, insertAndGetId, run } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { parseJson, slugify } from '../utils/format.js';

const router = Router();

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

const categorySchema = z.object({
  parent_id: z.coerce.number().int().nullable().optional(),
  name: z.string().min(2),
  description: z.string().optional(),
  image_url: z.string().optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  sort_order: z.coerce.number().int().optional().default(0),
  status: z.enum(['active', 'draft', 'archived']).optional().default('active'),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional()
});

const collectionSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['manual', 'automatic']).optional().default('manual'),
  status: z.enum(['active', 'draft', 'archived']).optional().default('active'),
  conditions: z.record(z.any()).optional(),
  image_url: z.string().optional(),
  seo_title: z.string().optional(),
  seo_description: z.string().optional(),
  sort_order: z.coerce.number().int().optional().default(0),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  product_ids: z.array(z.coerce.number().int()).optional()
});

router.get('/categories', (_req, res) => {
  const categories = all(
    `SELECT c.*, p.name AS parent_name,
            (SELECT COUNT(*) FROM products pr WHERE pr.category_id = c.id) AS product_count
     FROM categories c
     LEFT JOIN categories p ON p.id = c.parent_id
     ORDER BY c.sort_order, c.name`
  );
  res.json({ data: categories });
});

router.post('/categories', requireAdmin, (req, res, next) => {
  try {
    const payload = categorySchema.parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO categories (
        parent_id, name, slug, description, image_url, seo_title, seo_description,
        sort_order, status, starts_at, ends_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.parent_id || null,
        payload.name,
        uniqueSlug('categories', payload.name),
        payload.description || null,
        payload.image_url || null,
        payload.seo_title || payload.name,
        payload.seo_description || null,
        payload.sort_order,
        payload.status,
        payload.starts_at || null,
        payload.ends_at || null
      ]
    );
    audit(req.user.id, 'create', 'category', id, { name: payload.name });
    res.status(201).json({ data: get('SELECT * FROM categories WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.put('/categories/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = get('SELECT * FROM categories WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const payload = categorySchema.partial().parse(req.body);
    const name = payload.name ?? existing.name;
    run(
      `UPDATE categories
       SET parent_id = ?, name = ?, slug = ?, description = ?, image_url = ?, seo_title = ?,
           seo_description = ?, sort_order = ?, status = ?, starts_at = ?, ends_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        payload.parent_id ?? existing.parent_id,
        name,
        payload.name ? uniqueSlug('categories', name, existing.id) : existing.slug,
        payload.description ?? existing.description,
        payload.image_url ?? existing.image_url,
        payload.seo_title ?? existing.seo_title,
        payload.seo_description ?? existing.seo_description,
        payload.sort_order ?? existing.sort_order,
        payload.status ?? existing.status,
        payload.starts_at ?? existing.starts_at,
        payload.ends_at ?? existing.ends_at,
        existing.id
      ]
    );
    audit(req.user.id, 'update', 'category', existing.id);
    return res.json({ data: get('SELECT * FROM categories WHERE id = ?', [existing.id]) });
  } catch (error) {
    return next(error);
  }
});

router.get('/collections', (_req, res) => {
  const collections = all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM collection_products cp WHERE cp.collection_id = c.id) AS product_count
     FROM collections c
     ORDER BY c.sort_order, c.name`
  ).map((collection) => ({
    ...collection,
    conditions: parseJson(collection.conditions_json, {})
  }));
  res.json({ data: collections });
});

router.post('/collections', requireAdmin, (req, res, next) => {
  try {
    const payload = collectionSchema.parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO collections (
        name, slug, type, status, conditions_json, image_url, seo_title,
        seo_description, sort_order, starts_at, ends_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.name,
        uniqueSlug('collections', payload.name),
        payload.type,
        payload.status,
        JSON.stringify(payload.conditions || {}),
        payload.image_url || null,
        payload.seo_title || payload.name,
        payload.seo_description || null,
        payload.sort_order,
        payload.starts_at || null,
        payload.ends_at || null
      ]
    );

    for (const [index, productId] of (payload.product_ids || []).entries()) {
      run(
        'INSERT OR IGNORE INTO collection_products (collection_id, product_id, position) VALUES (?, ?, ?)',
        [id, productId, index]
      );
    }

    audit(req.user.id, 'create', 'collection', id, { name: payload.name });
    res.status(201).json({ data: get('SELECT * FROM collections WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.put('/collections/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = get('SELECT * FROM collections WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Collection not found' });

    const payload = collectionSchema.partial().parse(req.body);
    const name = payload.name ?? existing.name;
    run(
      `UPDATE collections
       SET name = ?, slug = ?, type = ?, status = ?, conditions_json = ?, image_url = ?,
           seo_title = ?, seo_description = ?, sort_order = ?, starts_at = ?, ends_at = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        name,
        payload.name ? uniqueSlug('collections', name, existing.id) : existing.slug,
        payload.type ?? existing.type,
        payload.status ?? existing.status,
        payload.conditions === undefined ? existing.conditions_json : JSON.stringify(payload.conditions),
        payload.image_url ?? existing.image_url,
        payload.seo_title ?? existing.seo_title,
        payload.seo_description ?? existing.seo_description,
        payload.sort_order ?? existing.sort_order,
        payload.starts_at ?? existing.starts_at,
        payload.ends_at ?? existing.ends_at,
        existing.id
      ]
    );

    if (payload.product_ids) {
      run('DELETE FROM collection_products WHERE collection_id = ?', [existing.id]);
      for (const [index, productId] of payload.product_ids.entries()) {
        run(
          'INSERT OR IGNORE INTO collection_products (collection_id, product_id, position) VALUES (?, ?, ?)',
          [existing.id, productId, index]
        );
      }
    }

    audit(req.user.id, 'update', 'collection', existing.id);
    return res.json({ data: get('SELECT * FROM collections WHERE id = ?', [existing.id]) });
  } catch (error) {
    return next(error);
  }
});

router.get('/brands', (_req, res) => {
  res.json({ data: all('SELECT * FROM brands ORDER BY name') });
});

router.post('/brands', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      name: z.string().min(2),
      description: z.string().optional(),
      logo_url: z.string().optional(),
      status: z.enum(['active', 'draft', 'archived']).optional().default('active')
    }).parse(req.body);
    const id = insertAndGetId(
      'INSERT INTO brands (name, slug, description, logo_url, status) VALUES (?, ?, ?, ?, ?)',
      [payload.name, uniqueSlug('brands', payload.name), payload.description || null, payload.logo_url || null, payload.status]
    );
    res.status(201).json({ data: get('SELECT * FROM brands WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.get('/vendors', (_req, res) => {
  res.json({ data: all('SELECT * FROM vendors ORDER BY name') });
});

router.post('/vendors', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      name: z.string().min(2),
      email: z.string().email().optional(),
      phone: z.string().optional(),
      status: z.enum(['active', 'draft', 'archived']).optional().default('active')
    }).parse(req.body);
    const id = insertAndGetId(
      'INSERT INTO vendors (name, email, phone, status) VALUES (?, ?, ?, ?)',
      [payload.name, payload.email || null, payload.phone || null, payload.status]
    );
    res.status(201).json({ data: get('SELECT * FROM vendors WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

export default router;


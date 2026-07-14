import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, get, insertAndGetId, run } from '../db/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { slugify } from '../utils/format.js';

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.resolve(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const safe = `${Date.now()}-${slugify(file.originalname.replace(path.extname(file.originalname), ''))}${path.extname(file.originalname).toLowerCase()}`;
      cb(null, safe);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

function uniqueSlug(table, title, currentId = null) {
  const base = slugify(title) || 'content';
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

const pageSchema = z.object({
  title: z.string().min(2),
  page_type: z.enum(['page', 'landing', 'faq', 'testimonial', 'homepage_section']).optional().default('page'),
  body: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
  seo_title: z.string().optional(),
  seo_description: z.string().optional()
});

router.get('/pages', (_req, res) => {
  res.json({ data: all('SELECT * FROM cms_pages ORDER BY created_at DESC') });
});

router.post('/pages', requireAdmin, (req, res, next) => {
  try {
    const payload = pageSchema.parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO cms_pages (title, slug, page_type, body, status, seo_title, seo_description, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.title,
        uniqueSlug('cms_pages', payload.title),
        payload.page_type,
        payload.body || '',
        payload.status,
        payload.seo_title || payload.title,
        payload.seo_description || null,
        payload.status === 'published' ? new Date().toISOString() : null
      ]
    );
    res.status(201).json({ data: get('SELECT * FROM cms_pages WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.put('/pages/:id', requireAdmin, (req, res, next) => {
  try {
    const existing = get('SELECT * FROM cms_pages WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Page not found' });
    const payload = pageSchema.partial().parse(req.body);
    const title = payload.title ?? existing.title;
    run(
      `UPDATE cms_pages
       SET title = ?, slug = ?, page_type = ?, body = ?, status = ?, seo_title = ?,
           seo_description = ?, published_at = COALESCE(published_at, ?),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        title,
        payload.title ? uniqueSlug('cms_pages', title, existing.id) : existing.slug,
        payload.page_type ?? existing.page_type,
        payload.body ?? existing.body,
        payload.status ?? existing.status,
        payload.seo_title ?? existing.seo_title,
        payload.seo_description ?? existing.seo_description,
        payload.status === 'published' ? new Date().toISOString() : existing.published_at,
        existing.id
      ]
    );
    return res.json({ data: get('SELECT * FROM cms_pages WHERE id = ?', [existing.id]) });
  } catch (error) {
    return next(error);
  }
});

router.get('/blog', (_req, res) => {
  res.json({ data: all('SELECT * FROM blog_posts ORDER BY created_at DESC') });
});

router.post('/blog', requireAdmin, (req, res, next) => {
  try {
    const payload = z.object({
      title: z.string().min(2),
      category: z.string().optional(),
      tags: z.string().optional(),
      excerpt: z.string().optional(),
      body: z.string().optional(),
      status: z.enum(['draft', 'published', 'archived']).optional().default('draft'),
      seo_title: z.string().optional(),
      seo_description: z.string().optional()
    }).parse(req.body);
    const id = insertAndGetId(
      `INSERT INTO blog_posts (title, slug, category, tags, author_id, excerpt, body, status, seo_title, seo_description, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.title,
        uniqueSlug('blog_posts', payload.title),
        payload.category || null,
        payload.tags || null,
        req.user.id,
        payload.excerpt || null,
        payload.body || '',
        payload.status,
        payload.seo_title || payload.title,
        payload.seo_description || null,
        payload.status === 'published' ? new Date().toISOString() : null
      ]
    );
    res.status(201).json({ data: get('SELECT * FROM blog_posts WHERE id = ?', [id]) });
  } catch (error) {
    next(error);
  }
});

router.get('/media', requireAdmin, (_req, res) => {
  res.json({ data: all('SELECT * FROM media_assets ORDER BY created_at DESC') });
});

router.post('/media', requireAdmin, upload.single('file'), (req, res, next) => {
  try {
    if (!req.file) return res.status(422).json({ error: 'File is required' });
    const url = `/uploads/${req.file.filename}`;
    const id = insertAndGetId(
      `INSERT INTO media_assets (folder, file_type, url, alt_text, size_bytes, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.body.folder || 'general',
        req.file.mimetype,
        url,
        req.body.alt_text || req.file.originalname,
        req.file.size,
        JSON.stringify({ originalName: req.file.originalname })
      ]
    );
    return res.status(201).json({ data: get('SELECT * FROM media_assets WHERE id = ?', [id]) });
  } catch (error) {
    return next(error);
  }
});

export default router;


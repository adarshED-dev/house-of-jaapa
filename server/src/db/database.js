import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let database;

export function initDb() {
  if (database) return database;

  fs.mkdirSync(path.dirname(config.sqliteFile), { recursive: true });
  database = new DatabaseSync(config.sqliteFile);
  database.exec('PRAGMA foreign_keys = ON;');
  database.exec('PRAGMA journal_mode = WAL;');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  database.exec(schema);
  return database;
}

export function getDb() {
  return database || initDb();
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return getDb().prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function transaction(callback) {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE TRANSACTION;');

  try {
    const result = callback(db);
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
}

export function toNumber(value) {
  return typeof value === 'bigint' ? Number(value) : value;
}

export function insertAndGetId(sql, params = []) {
  const result = run(sql, params);
  return toNumber(result.lastInsertRowid);
}


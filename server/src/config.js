import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRoot = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || '127.0.0.1',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  jwtSecret: process.env.JWT_SECRET || 'dev-house-of-jaapa-secret',
  sqliteFile: path.resolve(serverRoot, process.env.SQLITE_FILE || './data/house_of_jaapa.sqlite'),
  isProduction: process.env.NODE_ENV === 'production'
};

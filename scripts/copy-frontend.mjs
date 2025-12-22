// electron/scripts/copy-frontend.mjs
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// source: ../frontend/dist
const SRC = path.resolve(__dirname, '../../frontend/dist');
// destination inside electron: ./frontend-dist
const DEST = path.resolve(__dirname, '../frontend-dist');

async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      await copyDir(s, d);
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

async function run() {
  if (!fs.existsSync(SRC)) {
    console.error('❌ Frontend build not er found at:', SRC);
    console.error('   Run this first:  cd ../frontend && npm run build');
    process.exit(1);
  }

  if (fs.existsSync(DEST)) {
    await fsp.rm(DEST, { recursive: true, force: true });
  }

  await copyDir(SRC, DEST);
  console.log('✅ Copied ../frontend/dist -> electron/frontend-dist');
}

run().catch(err => { console.error(err); process.exit(1); });

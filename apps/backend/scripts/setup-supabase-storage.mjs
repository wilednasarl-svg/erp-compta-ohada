#!/usr/bin/env node
// ------------------------------------------------------------------
// setup-supabase-storage.mjs
//
// Prépare le stockage Supabase pour la GED (Module 10) :
//   1. crée le bucket PRIVÉ (SUPABASE_STORAGE_BUCKET) s'il n'existe pas,
//   2. migre les fichiers locaux existants (DOC_STORAGE_DIR) vers le
//      bucket en CONSERVANT leur storage_key (= chemin relatif), pour
//      que les lignes `documents` déjà en base restent résolvables
//      après bascule sur le driver supabase.
//
// Idempotent : ré-exécutable sans risque (createBucket ignore "already
// exists", upload utilise upsert).
//
// Lit la config depuis apps/backend/.env (SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET, DOC_STORAGE_DIR).
//
// Usage :
//   node apps/backend/scripts/setup-supabase-storage.mjs
// ------------------------------------------------------------------

import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(BACKEND_ROOT, '.env');

/** Parse minimaliste d'un fichier .env (KEY=value, ignore #commentaires). */
async function loadEnv(envPath) {
  const raw = await fs.readFile(envPath, 'utf8').catch(() => {
    throw new Error(`Fichier .env introuvable : ${envPath}`);
  });
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/** Parcourt récursivement un dossier et renvoie les chemins de fichiers. */
async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.isFile() && !entry.name.startsWith('.')) {
      out.push(full);
    }
  }
  return out;
}

async function streamToBuffer(filePath) {
  const chunks = [];
  for await (const chunk of createReadStream(filePath)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const EXT_MIME = {
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function main() {
  const env = await loadEnv(ENV_PATH);
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = env.SUPABASE_STORAGE_BUCKET ?? 'documents';
  const storageDir = path.resolve(BACKEND_ROOT, env.DOC_STORAGE_DIR ?? './uploads/documents');

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      '\n[setup] ERREUR : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être renseignés dans .env.\n' +
        '         Récupère la clé dans Supabase → Project Settings → API → "service_role".\n',
    );
    process.exit(1);
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Node < 22 : fournir un transport WebSocket sinon createClient lève.
    realtime: { transport: WebSocket },
  });

  console.log(`\n[setup] Supabase : ${supabaseUrl}`);
  console.log(`[setup] Bucket   : ${bucket} (privé)`);
  console.log(`[setup] Source   : ${storageDir}\n`);

  // 1. Bucket privé (idempotent)
  const { error: createErr } = await client.storage.createBucket(bucket, { public: false });
  if (createErr) {
    const msg = createErr.message.toLowerCase();
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      console.log(`[bucket] « ${bucket} » existe déjà — OK.`);
    } else {
      console.error(`[bucket] ÉCHEC création : ${createErr.message}`);
      process.exit(1);
    }
  } else {
    console.log(`[bucket] « ${bucket} » créé (privé).`);
  }

  // 2. Migration des fichiers locaux (clé = chemin relatif = storage_key DB)
  const files = await walk(storageDir);
  if (files.length === 0) {
    console.log('\n[migrate] Aucun fichier local à migrer.');
  } else {
    console.log(`\n[migrate] ${files.length} fichier(s) local(aux) à téléverser…`);
    let ok = 0;
    let failed = 0;
    for (const file of files) {
      const key = path.relative(storageDir, file).split(path.sep).join('/');
      const ext = path.extname(file).toLowerCase();
      const contentType = EXT_MIME[ext] ?? 'application/octet-stream';
      const buffer = await streamToBuffer(file);
      const { error } = await client.storage
        .from(bucket)
        .upload(key, buffer, { contentType, upsert: true });
      if (error) {
        console.error(`  ✗ ${key} → ${error.message}`);
        failed += 1;
      } else {
        console.log(`  ✓ ${key} (${buffer.length} o)`);
        ok += 1;
      }
    }
    console.log(`\n[migrate] Terminé : ${ok} OK, ${failed} échec(s).`);
    if (failed > 0) process.exit(1);
  }

  console.log(
    '\n[setup] Terminé. Passe DOC_STORAGE_DRIVER=supabase dans .env puis redémarre le backend.\n',
  );
}

main().catch((err) => {
  console.error(`\n[setup] ERREUR : ${err.message}\n`);
  process.exit(1);
});

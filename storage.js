'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
const useDatabase = Boolean(process.env.DATABASE_URL);
const pool = useDatabase ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;

function readFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

async function initStorage() {
  if (!useDatabase) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
    if (!fs.existsSync(INVOICES_FILE)) fs.writeFileSync(INVOICES_FILE, '[]', 'utf8');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      data_key TEXT PRIMARY KEY,
      data_value JSONB NOT NULL
    )
  `);

  for (const [dataKey, file] of [['users', USERS_FILE], ['invoices', INVOICES_FILE]]) {
    await pool.query(
      'INSERT INTO app_data (data_key, data_value) VALUES ($1, $2::jsonb) ON CONFLICT (data_key) DO NOTHING',
      [dataKey, JSON.stringify(readFile(file))]
    );
  }
}

function keyFor(file) {
  return path.basename(file, '.json');
}

async function readJSON(file) {
  if (!useDatabase) return readFile(file);
  const result = await pool.query('SELECT data_value FROM app_data WHERE data_key = $1', [keyFor(file)]);
  return result.rows[0]?.data_value || [];
}

async function writeJSON(file, data) {
  if (!useDatabase) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return;
  }
  await pool.query(
    `INSERT INTO app_data (data_key, data_value) VALUES ($1, $2::jsonb)
     ON CONFLICT (data_key) DO UPDATE SET data_value = EXCLUDED.data_value`,
    [keyFor(file), JSON.stringify(data)]
  );
}

module.exports = { USERS_FILE, INVOICES_FILE, initStorage, readJSON, writeJSON, useDatabase };

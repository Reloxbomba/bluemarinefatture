'use strict';

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const INVOICES_FILE = path.join(DATA_DIR, 'invoices.json');
const ACTIVITIES_FILE = path.join(DATA_DIR, 'activities.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');

const useDatabase = Boolean(process.env.DATABASE_URL);
const pool = useDatabase ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
}) : null;

const DEFAULT_PRODUCTS = {
  A: { id: 'A', name: 'Combo cibo', format: 'NxN', prices: {1:600,2:1200,3:1800,4:2400,5:3000,6:3600,7:4200,8:4800,9:5400,10:6000,15:9000,20:12000} },
  B: { id: 'B', name: 'Antistress singolo', format: 'N', prices: {1:350,2:700,3:1050,4:1400,5:1750,6:2100,7:2450,8:2800,9:3150,10:3500,15:5250,20:7000} },
  C: { id: 'C', name: 'Combo cibo antistress', format: 'NxNxN', prices: {1:950,2:1900,3:2850,4:3800,5:4750,6:5700,7:6650,8:7600,9:8550,10:9500,15:14250,20:19000} },
  D: { id: 'D', name: 'Personalizzata', format: 'custom', prices: null },
  E: { id: 'E', name: 'Coupon', format: 'custom_qty', prices: null }
};

function readFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

function readProductsFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') return DEFAULT_PRODUCTS;
    return data;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

async function initStorage() {
  if (!useDatabase) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');
    if (!fs.existsSync(INVOICES_FILE)) fs.writeFileSync(INVOICES_FILE, '[]', 'utf8');
    if (!fs.existsSync(ACTIVITIES_FILE)) fs.writeFileSync(ACTIVITIES_FILE, '[]', 'utf8');
    if (!fs.existsSync(PRODUCTS_FILE)) fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(DEFAULT_PRODUCTS, null, 2), 'utf8');
    if (!fs.existsSync(PAYMENTS_FILE)) fs.writeFileSync(PAYMENTS_FILE, '[]', 'utf8');
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      data_key TEXT PRIMARY KEY,
      data_value JSONB NOT NULL
    )
  `);

  const fileConfigs = [
    ['users', USERS_FILE, []],
    ['invoices', INVOICES_FILE, []],
    ['activities', ACTIVITIES_FILE, []],
    ['products', PRODUCTS_FILE, DEFAULT_PRODUCTS],
    ['payments', PAYMENTS_FILE, []]
  ];

  for (const [dataKey, file, defaultVal] of fileConfigs) {
    let content;
    if (dataKey === 'products') {
      content = readProductsFile(file);
    } else {
      content = readFile(file);
      if (!content || !Array.isArray(content)) content = defaultVal;
    }
    await pool.query(
      'INSERT INTO app_data (data_key, data_value) VALUES ($1, $2::jsonb) ON CONFLICT (data_key) DO NOTHING',
      [dataKey, JSON.stringify(content)]
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

module.exports = { USERS_FILE, INVOICES_FILE, ACTIVITIES_FILE, PRODUCTS_FILE, PAYMENTS_FILE, initStorage, readJSON, writeJSON, useDatabase };

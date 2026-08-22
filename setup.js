/**
 * setup.js – Eseguire UNA VOLTA per creare il primo account amministratore.
 * Comando: npm run setup
 */

'use strict';

const bcrypt   = require('bcrypt');
const fs       = require('fs');
const path     = require('path');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');

const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

if (!fs.existsSync(DATA_DIR))   fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]', 'utf8');

const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

async function main() {
  console.log('\n🚢 ═══════════════════════════════════════════');
  console.log('   Blue Marine NOW – Setup Amministratore');
  console.log('═══════════════════════════════════════════\n');

  const username = (await ask('👤  Username admin: ')).trim();
  if (!username || username.length < 3) {
    console.error('❌  Username troppo corto (min. 3 caratteri)');
    rl.close(); process.exit(1);
  }

  const password = (await ask('🔒  Password admin:  ')).trim();
  if (!password || password.length < 4) {
    console.error('❌  Password troppo corta (min. 4 caratteri)');
    rl.close(); process.exit(1);
  }

  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    console.error(`❌  Username "${username}" già in uso`);
    rl.close(); process.exit(1);
  }

  const hashed  = await bcrypt.hash(password, 10);
  const newUser = { id: uuidv4(), username, password: hashed, role: 'admin', createdAt: new Date().toISOString() };

  users.push(newUser);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');

  console.log(`\n✅  Admin "${username}" creato con successo!`);
  console.log('   Avvia il portale con:  npm start');
  console.log('   Oppure in dev mode:    npm run dev\n');
  rl.close();
}

main().catch(err => { console.error('Errore:', err.message); process.exit(1); });

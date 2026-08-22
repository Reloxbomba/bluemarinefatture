'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { USERS_FILE, INVOICES_FILE, initStorage, readJSON, writeJSON } = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'local-development-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ─── Guards ───────────────────────────────────────────────────────
const requireAuth  = (req, res, next) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Non autenticato' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!req.session?.user || req.session.user.role !== 'admin')
    return res.status(403).json({ error: 'Accesso negato – solo admin' });
  next();
};

// ─── Product Catalog ──────────────────────────────────────────────
const PRODUCTS = {
  A: { id: 'A', name: 'Categoria A', format: 'NxN',    prices: {1:600,2:1200,3:1800,4:2400,5:3000,6:3600,7:4200,8:4800,9:5400,10:6000} },
  B: { id: 'B', name: 'Categoria B', format: 'N',      prices: {1:350,2:700,3:1050,4:1400,5:1750,6:2100,7:2450,8:2800,9:3150,10:3500} },
  C: { id: 'C', name: 'Categoria C', format: 'NxNxN',  prices: {1:950,2:1900,3:2850,4:3800,5:4750,6:5700,7:6650,8:7600,9:8550,10:9500} },
  D: { id: 'D', name: 'Categoria D', format: 'custom', prices: null } // quantità e prezzo liberi
};

// ══════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username e password richiesti' });

  const users = await readJSON(USERS_FILE);
  const user  = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Credenziali non valide' });

  const match = await bcrypt.compare(password, user.password);
  if (!match)  return res.status(401).json({ error: 'Credenziali non valide' });

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ success: true, role: user.role, username: user.username });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Non autenticato' });
  res.json(req.session.user);
});

// ══════════════════════════════════════════════════════════════════
// PRODUCTS
// ══════════════════════════════════════════════════════════════════
app.get('/api/products', requireAuth, (req, res) => res.json(PRODUCTS));

// ══════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════

// Employee: create invoice
app.post('/api/invoices', requireAuth, async (req, res) => {
  const { clientName, productType, quantity, notes, manualPrice } = req.body;
  const product = PRODUCTS[productType];
  const qty     = parseInt(quantity);

  if (!product) return res.status(400).json({ error: 'Prodotto non valido' });

  let finalPrice;

  if (productType === 'D') {
    // Categoria D: quantità e prezzo liberi
    if (!qty || qty < 1 || qty > 99999)
      return res.status(400).json({ error: 'Quantità non valida (1-99999)' });
    const pMan = parseFloat(manualPrice);
    if (isNaN(pMan) || pMan <= 0)
      return res.status(400).json({ error: 'Prezzo non valido' });
    finalPrice = Math.round(pMan * 100) / 100;
  } else {
    if (!qty || qty < 1 || qty > 10)
      return res.status(400).json({ error: 'Dati non validi' });
    finalPrice = product.prices[qty];
  }

  const invoice = {
    id:            uuidv4(),
    employeeId:    req.session.user.id,
    employeeName:  req.session.user.username,
    clientName:    (clientName || 'Anonimo').trim().substring(0, 100),
    productType,
    productName:   product.name,
    productFormat: product.format,
    quantity:      qty,
    price:         finalPrice,
    notes:         (notes || '').trim().substring(0, 500),
    createdAt:     new Date().toISOString()
  };

  const invoices = await readJSON(INVOICES_FILE);
  invoices.push(invoice);
  await writeJSON(INVOICES_FILE, invoices);
  res.json({ success: true, invoice });
});

// Employee: own invoices
app.get('/api/invoices/my', requireAuth, async (req, res) => {
  const all = await readJSON(INVOICES_FILE);
  res.json([...all.filter(i => i.employeeId === req.session.user.id)].reverse());
});

// Admin: all invoices (with optional filters)
app.get('/api/invoices', requireAdmin, async (req, res) => {
  const { employeeId, productType, dateFrom, dateTo } = req.query;
  let list = await readJSON(INVOICES_FILE);

  if (employeeId)  list = list.filter(i => i.employeeId   === employeeId);
  if (productType) list = list.filter(i => i.productType  === productType);
  if (dateFrom)    list = list.filter(i => i.createdAt    >= dateFrom);
  if (dateTo)      list = list.filter(i => i.createdAt    <= dateTo + 'T23:59:59.999Z');

  res.json([...list].reverse());
});

// Admin: delete invoice
app.delete('/api/invoices/:id', requireAdmin, async (req, res) => {
  let list = await readJSON(INVOICES_FILE);
  const before = list.length;
  list = list.filter(i => i.id !== req.params.id);
  if (list.length === before) return res.status(404).json({ error: 'Fattura non trovata' });
  await writeJSON(INVOICES_FILE, list);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════════
app.get('/api/stats', requireAdmin, async (req, res) => {
  const invoices  = await readJSON(INVOICES_FILE);
  const users     = await readJSON(USERS_FILE);
  const today     = new Date().toISOString().slice(0, 10);
  const todayList = invoices.filter(i => i.createdAt.startsWith(today));

  const employeeStats = users.filter(u => u.role === 'employee').map(emp => {
    const empAll   = invoices.filter(i => i.employeeId === emp.id);
    const empToday = empAll.filter(i => i.createdAt.startsWith(today));
    const commissionPercentage = Number.isFinite(Number(emp.commissionPercentage))
      ? Number(emp.commissionPercentage)
      : 0;
    return {
      id:            emp.id,
      username:      emp.username,
      commissionPercentage,
      totalInvoices: empAll.length,
      totalAmount:   empAll.reduce((s, i) => s + i.price, 0),
      amountDue:     Math.round(empAll.reduce((s, i) => s + i.price, 0) * commissionPercentage * 100) / 100,
      todayInvoices: empToday.length,
      todayAmount:   empToday.reduce((s, i) => s + i.price, 0),
      lastActivity:  empAll.length ? empAll[empAll.length - 1].createdAt : null
    };
  });

  const productStats = Object.values(PRODUCTS).map(p => ({
    type:   p.id,
    name:   p.name,
    count:  invoices.filter(i => i.productType === p.id).length,
    amount: invoices.filter(i => i.productType === p.id).reduce((s, i) => s + i.price, 0)
  }));

  res.json({
    total:     { invoices: invoices.length,  amount: invoices.reduce((s, i) => s + i.price, 0) },
    today:     { invoices: todayList.length, amount: todayList.reduce((s, i) => s + i.price, 0) },
    employees: employeeStats,
    products:  productStats
  });
});

// ══════════════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════════════
app.get('/api/users', requireAdmin, async (req, res) => {
  res.json((await readJSON(USERS_FILE)).map(u => ({
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
    commissionPercentage: Number.isFinite(Number(u.commissionPercentage)) ? Number(u.commissionPercentage) : 0
  })));
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !['employee', 'admin'].includes(role))
    return res.status(400).json({ error: 'Dati non validi' });
  if (username.length < 3 || username.length > 30)
    return res.status(400).json({ error: 'Username: 3-30 caratteri' });

  const users = await readJSON(USERS_FILE);
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase()))
    return res.status(400).json({ error: 'Username già in uso' });

  const hashed = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(), username: username.trim(), password: hashed, role,
    commissionPercentage: 0,
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  await writeJSON(USERS_FILE, users);
  res.status(201).json({ success: true, user: { id: newUser.id, username: newUser.username, role: newUser.role } });
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.session.user.id)
    return res.status(400).json({ error: 'Non puoi eliminare il tuo account' });
  let users = await readJSON(USERS_FILE);
  const before = users.length;
  users = users.filter(u => u.id !== req.params.id);
  if (users.length === before) return res.status(404).json({ error: 'Utente non trovato' });
  await writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

app.put('/api/users/:id/password', requireAdmin, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4)
    return res.status(400).json({ error: 'Password troppo corta (min. 4 caratteri)' });
  const users = await readJSON(USERS_FILE);
  const user  = users.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  user.password = await bcrypt.hash(password, 10);
  await writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

app.put('/api/users/:id/commission', requireAdmin, async (req, res) => {
  const commissionPercentage = Number(req.body.commissionPercentage);
  if (!Number.isFinite(commissionPercentage) || commissionPercentage < 0 || commissionPercentage > 100)
    return res.status(400).json({ error: 'La percentuale deve essere compresa tra 0 e 100' });

  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.params.id && u.role === 'employee');
  if (!user) return res.status(404).json({ error: 'Dipendente non trovato' });

  user.commissionPercentage = Math.round(commissionPercentage * 100) / 100;
  await writeJSON(USERS_FILE, users);
  res.json({ success: true, commissionPercentage: user.commissionPercentage });
});

// ══════════════════════════════════════════════════════════════════
// CSV EXPORT
// ══════════════════════════════════════════════════════════════════
app.get('/api/export/csv', requireAdmin, async (req, res) => {
  const invoices = await readJSON(INVOICES_FILE);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const header = ['ID','Dipendente','Cliente','Prodotto','Quantità','Prezzo ($)','Note','Data e Ora'];
  const rows   = invoices.map(i => [
    esc(i.id), esc(i.employeeName), esc(i.clientName), esc(i.productName),
    esc(i.quantity), esc(i.price), esc(i.notes),
    esc(new Date(i.createdAt).toLocaleString('it-IT'))
  ]);

  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fatture_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel
});

// ──────────────────────────────────────────────────────────────────
async function start() {
  await initStorage();
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET)
    throw new Error('SESSION_SECRET è obbligatoria in produzione');

  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const users = await readJSON(USERS_FILE);
    if (!users.length) {
      users.push({
        id: uuidv4(),
        username: process.env.ADMIN_USERNAME.trim(),
        password: await bcrypt.hash(process.env.ADMIN_PASSWORD, 10),
        role: 'admin',
        commissionPercentage: 0,
        createdAt: new Date().toISOString()
      });
      await writeJSON(USERS_FILE, users);
      console.log(`Admin "${process.env.ADMIN_USERNAME}" creato dal bootstrap Render`);
    }
  }

  app.listen(PORT, () => {
  console.log('\n🚢 ════════════════════════════════════════════');
  console.log('   Blue Marine NOW  –  Portale Fatture');
  console.log(`   Server attivo → http://localhost:${PORT}`);
  console.log('════════════════════════════════════════════\n');
    readJSON(USERS_FILE).then(users => {
      if (users.length === 0) {
        console.log('⚠️  Nessun utente trovato! Esegui prima: npm run setup\n');
      } else {
        console.log(`✅  ${users.length} utente/i registrato/i\n`);
      }
    });
  });
}

start().catch(err => {
  console.error('Avvio fallito:', err.message);
  process.exit(1);
});

'use strict';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { USERS_FILE, INVOICES_FILE, ACTIVITIES_FILE, PRODUCTS_FILE, PAYMENTS_FILE, initStorage, readJSON, writeJSON } = require('./storage');

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

// Helper per ottenere la data YYYY-MM-DD nel fuso orario italiano
function getLocalDateString(dateInput = new Date()) {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

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
app.get('/api/products', requireAuth, async (req, res) => {
  const products = await readJSON(PRODUCTS_FILE);
  res.json(products);
});

app.get('/api/activities', requireAuth, async (req, res) => {
  const activities = await readJSON(ACTIVITIES_FILE);
  res.json(activities.filter(activity => activity.active !== false));
});

// ══════════════════════════════════════════════════════════════════
// INVOICES
// ══════════════════════════════════════════════════════════════════

// Employee: create invoice
app.post('/api/invoices', requireAuth, async (req, res) => {
  const { clientName, productType, quantity, notes, manualPrice, activityId } = req.body;
  const products = await readJSON(PRODUCTS_FILE);
  const product = products[productType];
  const qty = productType === 'D'
    ? String(quantity ?? '').trim()
    : parseInt(quantity, 10);

  if (!product) return res.status(400).json({ error: 'Prodotto non valido' });

  let finalPrice;

  if (productType === 'D') {
    // Categoria D: Personalizzata (quantità e prezzo liberi)
    if (!qty || qty.length > 100)
      return res.status(400).json({ error: 'Quantità non valida (1-100 caratteri)' });
    const pMan = parseFloat(manualPrice);
    if (isNaN(pMan) || pMan <= 0)
      return res.status(400).json({ error: 'Prezzo non valido' });
    finalPrice = Math.round(pMan * 100) / 100;
  } else if (productType === 'E') {
    // Categoria E: Coupon (quantità manuale, prezzo 0)
    if (isNaN(qty) || qty <= 0)
      return res.status(400).json({ error: 'Quantità coupon non valida' });
    finalPrice = 0;
  } else {
    if (!Object.prototype.hasOwnProperty.call(product.prices, qty))
      return res.status(400).json({ error: 'Dati non validi' });
    finalPrice = product.prices[qty];
  }

  let activity = null;
  let discountPercentage = 0;
  if (activityId) {
    const activities = await readJSON(ACTIVITIES_FILE);
    activity = activities.find(item => item.id === activityId && item.active !== false);
    if (!activity) return res.status(400).json({ error: 'Attività non valida o non più disponibile' });
    discountPercentage = Number(activity.discountPercentage);
  }
  const discountAmount = Math.round(finalPrice * discountPercentage) / 100;
  const discountedPrice = Math.round((finalPrice - discountAmount) * 100) / 100;

  const invoice = {
    id:            uuidv4(),
    employeeId:    req.session.user.id,
    employeeName:  req.session.user.username,
    clientName:    (clientName || 'Anonimo').trim().substring(0, 100),
    productType,
    productName:   product.name,
    productFormat: product.format,
    quantity:      qty,
    originalPrice: finalPrice,
    discountPercentage,
    discountAmount,
    activityId:    activity?.id || null,
    activityName:  activity?.name || null,
    price:         discountedPrice,
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
  const today     = getLocalDateString();
  const todayList = invoices.filter(i => getLocalDateString(i.createdAt) === today);

  const employeeStats = users.filter(u => u.role === 'employee').map(emp => {
    const empAll   = invoices.filter(i => i.employeeId === emp.id);
    const salaryResetAt = emp.salaryResetAt || null;
    const payableInvoices = salaryResetAt
      ? empAll.filter(i => i.createdAt > salaryResetAt)
      : empAll;
    const empToday = empAll.filter(i => getLocalDateString(i.createdAt) === today);
    const commissionPercentage = Number.isFinite(Number(emp.commissionPercentage))
      ? Number(emp.commissionPercentage)
      : 0;

    const totalCoupons = empAll
      .filter(i => i.productType === 'E')
      .reduce((s, i) => s + (parseInt(i.quantity, 10) || 0), 0);

    const payableCoupons = payableInvoices
      .filter(i => i.productType === 'E')
      .reduce((s, i) => s + (parseInt(i.quantity, 10) || 0), 0);

    const couponPay = payableCoupons * 200;
    const commissionPay = Math.round(payableInvoices.reduce((s, i) => s + i.price, 0) * commissionPercentage) / 100;

    return {
      id:            emp.id,
      username:      emp.username,
      commissionPercentage,
      totalInvoices: empAll.length,
      totalAmount:   empAll.reduce((s, i) => s + i.price, 0),
      payableAmount:  payableInvoices.reduce((s, i) => s + i.price, 0),
      amountDue:     commissionPay + couponPay,
      totalCoupons,
      payableCoupons,
      salaryResetAt,
      todayInvoices: empToday.length,
      todayAmount:   empToday.reduce((s, i) => s + i.price, 0),
      lastActivity:  empAll.length ? empAll[empAll.length - 1].createdAt : null
    };
  });

  const products = await readJSON(PRODUCTS_FILE);
  const productStats = Object.values(products).map(p => ({
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
app.get('/api/admin/activities', requireAdmin, async (req, res) => {
  res.json(await readJSON(ACTIVITIES_FILE));
});

app.post('/api/admin/activities', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const discountPercentage = Number(req.body.discountPercentage);
  if (!name || name.length > 100 || !Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100)
    return res.status(400).json({ error: 'Inserisci un nome e una percentuale tra 0 e 100' });

  const activities = await readJSON(ACTIVITIES_FILE);
  if (activities.some(activity => activity.name.toLowerCase() === name.toLowerCase() && activity.active !== false))
    return res.status(400).json({ error: 'Attività già presente' });

  const activity = {
    id: uuidv4(),
    name,
    discountPercentage: Math.round(discountPercentage * 100) / 100,
    active: true,
    createdAt: new Date().toISOString()
  };
  activities.push(activity);
  await writeJSON(ACTIVITIES_FILE, activities);
  res.status(201).json({ success: true, activity });
});

app.put('/api/admin/activities/:id', requireAdmin, async (req, res) => {
  const name = String(req.body.name || '').trim();
  const discountPercentage = Number(req.body.discountPercentage);
  if (!name || name.length > 100 || !Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100)
    return res.status(400).json({ error: 'Inserisci un nome e una percentuale tra 0 e 100' });

  const activities = await readJSON(ACTIVITIES_FILE);
  const activity = activities.find(item => item.id === req.params.id);
  if (!activity) return res.status(404).json({ error: 'Attività non trovata' });
  if (activities.some(item => item.id !== activity.id && item.active !== false && item.name.toLowerCase() === name.toLowerCase()))
    return res.status(400).json({ error: 'Attività già presente' });
  activity.name = name;
  activity.discountPercentage = Math.round(discountPercentage * 100) / 100;
  activity.active = true;
  await writeJSON(ACTIVITIES_FILE, activities);
  res.json({ success: true, activity });
});

app.delete('/api/admin/activities/:id', requireAdmin, async (req, res) => {
  const activities = await readJSON(ACTIVITIES_FILE);
  const activity = activities.find(item => item.id === req.params.id);
  if (!activity) return res.status(404).json({ error: 'Attività non trovata' });
  activity.active = false;
  await writeJSON(ACTIVITIES_FILE, activities);
  res.json({ success: true });
});

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

app.put('/api/users/:id/salary-reset', requireAdmin, async (req, res) => {
  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.params.id && u.role === 'employee');
  if (!user) return res.status(404).json({ error: 'Dipendente non trovato' });

  // Calcolo statistiche per lo storico pagamenti
  const invoices = await readJSON(INVOICES_FILE);
  const empAll = invoices.filter(i => i.employeeId === user.id);
  const salaryResetAt = user.salaryResetAt || null;
  const payableInvoices = salaryResetAt
    ? empAll.filter(i => i.createdAt > salaryResetAt)
    : empAll;
  
  const commissionPercentage = Number.isFinite(Number(user.commissionPercentage))
    ? Number(user.commissionPercentage)
    : 0;

  const payableCoupons = payableInvoices
    .filter(i => i.productType === 'E')
    .reduce((s, i) => s + (parseInt(i.quantity, 10) || 0), 0);

  const couponPay = payableCoupons * 200;
  const commissionPay = Math.round(payableInvoices.reduce((s, i) => s + i.price, 0) * commissionPercentage) / 100;
  const amountDue = commissionPay + couponPay;
  const payableAmount = payableInvoices.reduce((s, i) => s + i.price, 0);

  // Registrazione pagamento in payments.json
  const payments = await readJSON(PAYMENTS_FILE);
  const newPayment = {
    id: uuidv4(),
    employeeId: user.id,
    employeeName: user.username,
    amountPaid: amountDue,
    payableAmount,
    payableCoupons,
    commissionPercentage,
    paymentDate: new Date().toISOString(),
    periodFrom: salaryResetAt || user.createdAt,
    periodTo: new Date().toISOString()
  };
  payments.push(newPayment);
  await writeJSON(PAYMENTS_FILE, payments);

  user.salaryResetAt = new Date().toISOString();
  await writeJSON(USERS_FILE, users);
  res.json({ success: true, salaryResetAt: user.salaryResetAt, payment: newPayment });
});

// ══════════════════════════════════════════════════════════════════
// CSV EXPORT
// ══════════════════════════════════════════════════════════════════
app.get('/api/export/csv', requireAdmin, async (req, res) => {
  const invoices = await readJSON(INVOICES_FILE);
  const products = await readJSON(PRODUCTS_FILE);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  const header = ['ID','Dipendente','Cliente','Prodotto','Quantità','Prezzo originale ($)','Sconto (%)','Risparmio ($)','Prezzo pagato ($)','Attività','Note','Data e Ora'];
  const rows   = invoices.map(i => [
    esc(i.id), esc(i.employeeName), esc(i.clientName), esc(products[i.productType]?.name || i.productName),
    esc(i.quantity), esc(i.originalPrice ?? i.price), esc(i.discountPercentage ?? 0), esc(i.discountAmount ?? 0),
    esc(i.price), esc(i.activityName), esc(i.notes),
    esc(new Date(i.createdAt).toLocaleString('it-IT'))
  ]);

  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="fatture_${new Date().toISOString().slice(0,10)}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel
});

// ══════════════════════════════════════════════════════════════════
// ADMIN: PRODUCTS CRUD
// ══════════════════════════════════════════════════════════════════
app.get('/api/admin/products', requireAdmin, async (req, res) => {
  res.json(await readJSON(PRODUCTS_FILE));
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
  const { id, name, format, prices } = req.body;
  if (!id || !name || !format) return res.status(400).json({ error: 'Campi obbligatori mancanti' });

  const products = await readJSON(PRODUCTS_FILE);
  if (products[id]) return res.status(400).json({ error: 'ID prodotto già esistente' });

  products[id] = { id, name, format, prices: prices || null };
  await writeJSON(PRODUCTS_FILE, products);
  res.status(201).json({ success: true, product: products[id] });
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const { name, format, prices } = req.body;
  if (!name || !format) return res.status(400).json({ error: 'Campi obbligatori mancanti' });

  const products = await readJSON(PRODUCTS_FILE);
  const product = products[req.params.id];
  if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

  product.name = name;
  product.format = format;
  product.prices = prices || null;

  await writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true, product });
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
  const products = await readJSON(PRODUCTS_FILE);
  if (!products[req.params.id]) return res.status(404).json({ error: 'Prodotto non trovato' });

  delete products[req.params.id];
  await writeJSON(PRODUCTS_FILE, products);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// AUTH PASSWORD CHANGE
// ══════════════════════════════════════════════════════════════════
app.put('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'La nuova password deve contenere almeno 4 caratteri' });
  }

  const users = await readJSON(USERS_FILE);
  const user = users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });

  if (currentPassword) {
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ error: 'Password attuale errata' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// INVOICE DELETION (STORNO 15 MINUTI)
// ══════════════════════════════════════════════════════════════════
app.delete('/api/invoices/my/:id', requireAuth, async (req, res) => {
  let invoices = await readJSON(INVOICES_FILE);
  const invoice = invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Fattura non trovata' });
  
  if (invoice.employeeId !== req.session.user.id) {
    return res.status(403).json({ error: 'Accesso negato: puoi eliminare solo le tue fatture' });
  }

  const timeDiffMs = new Date() - new Date(invoice.createdAt);
  const timeDiffMins = timeDiffMs / (1000 * 60);
  if (timeDiffMins > 15) {
    return res.status(400).json({ error: 'Tempo scaduto: puoi stornare una fattura solo entro 15 minuti' });
  }

  invoices = invoices.filter(i => i.id !== req.params.id);
  await writeJSON(INVOICES_FILE, invoices);
  res.json({ success: true });
});

// ══════════════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════════════
app.get('/api/payments', requireAdmin, async (req, res) => {
  const payments = await readJSON(PAYMENTS_FILE);
  res.json([...payments].reverse());
});

app.get('/api/payments/my', requireAuth, async (req, res) => {
  const payments = await readJSON(PAYMENTS_FILE);
  const my = payments.filter(p => p.employeeId === req.session.user.id);
  res.json([...my].reverse());
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

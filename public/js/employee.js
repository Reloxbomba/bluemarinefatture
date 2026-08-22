'use strict';

// ─── Product catalog (mirrors server) ────────────────────────────
const PRODUCTS = {
  A: {
    name: 'Categoria A',
    fmt:  (n) => `${n}×${n}`,
    prices: {1:600,2:1200,3:1800,4:2400,5:3000,6:3600,7:4200,8:4800,9:5400,10:6000}
  },
  B: {
    name: 'Categoria B',
    fmt:  (n) => `${n}`,
    prices: {1:350,2:700,3:1050,4:1400,5:1750,6:2100,7:2450,8:2800,9:3150,10:3500}
  },
  C: {
    name: 'Categoria C',
    fmt:  (n) => `${n}×${n}×${n}`,
    prices: {1:950,2:1900,3:2850,4:3800,5:4750,6:5700,7:6650,8:7600,9:8550,10:9500}
  },
  D: {
    name: 'Categoria D',
    fmt:  (n) => `${n}`,
    prices: null  // manuale
  }
};

let currentUser = null;
let myInvoices  = [];

// ─── Utils ────────────────────────────────────────────────────────
const fmt$  = (n) => '$' + Number(n).toLocaleString('it-IT');
const fmtDT = (iso) => new Date(iso).toLocaleString('it-IT', {
  day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
});

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'fa-circle-check', error:'fa-circle-exclamation', info:'fa-circle-info' };
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 3500);
}

function hideBadge(type) {
  const b = { A:'badge-A', B:'badge-B', C:'badge-C', D:'badge-D' };
  return `<span class="badge ${b[type] || ''}">${
    PRODUCTS[type]?.name || type
  }</span>`;
}

// ─── Auth & init ──────────────────────────────────────────────────
async function init() {
  try {
    const res  = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();
    if (user.role === 'admin') { window.location.href = '/admin.html'; return; }

    currentUser = user;
    document.getElementById('user-name').textContent   = user.username;
    document.getElementById('user-avatar').textContent = user.username[0].toUpperCase();

    await loadMyInvoices();
    hideLoader();
  } catch {
    window.location.href = '/';
  }
}

function hideLoader() {
  const l = document.getElementById('page-loader');
  l.classList.add('fade-out');
  setTimeout(() => l.remove(), 500);
}

// ─── Invoices ─────────────────────────────────────────────────────
async function loadMyInvoices() {
  try {
    const res = await fetch('/api/invoices/my');
    myInvoices = await res.json();
    renderInvoices();
    updateStats();
  } catch {
    toast('Errore nel caricamento fatture', 'error');
  }
}

function updateStats() {
  const today = new Date().toISOString().slice(0,10);
  const tInv  = myInvoices.filter(i => i.createdAt.startsWith(today));

  document.getElementById('stat-today-count').textContent  = tInv.length;
  document.getElementById('stat-today-amount').textContent = fmt$(tInv.reduce((s,i) => s + i.price, 0));
  document.getElementById('stat-total-count').textContent  = myInvoices.length;
  document.getElementById('stat-total-amount').textContent = fmt$(myInvoices.reduce((s,i) => s + i.price, 0));
  document.getElementById('invoices-badge').textContent    = `${myInvoices.length} fatture`;
}

function renderInvoices() {
  const tbody = document.getElementById('my-invoices-body');
  if (myInvoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">
      <i class="fa-solid fa-inbox"></i><p>Nessuna fattura ancora registrata</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = myInvoices.map(inv => `
    <tr>
      <td><span style="color:var(--text-3);font-size:.8rem;">${fmtDT(inv.createdAt)}</span></td>
      <td>${inv.clientName}</td>
      <td>${hideBadge(inv.productType)}</td>
      <td><span class="qty-pill">${PRODUCTS[inv.productType]?.fmt(inv.quantity) ?? inv.quantity}</span></td>
      <td class="price-cell">${fmt$(inv.price)}</td>
    </tr>
  `).join('');
}

// ─── Invoice Form ─────────────────────────────────────────────────
const selProduct  = document.getElementById('product-type');
const selQty      = document.getElementById('quantity');
const priceDisp   = document.getElementById('price-display');
const priceAmt    = document.getElementById('price-amount');
const invoiceForm = document.getElementById('invoice-form');
const submitBtn   = document.getElementById('submit-btn');

const qtySelectGroup = document.getElementById('qty-select-group');
const catDFields     = document.getElementById('cat-d-fields');
const manualQtyInp   = document.getElementById('manual-quantity');
const manualPriceInp = document.getElementById('manual-price');

selProduct.addEventListener('change', () => {
  const type = selProduct.value;
  priceAmt.textContent = '–';
  priceDisp.classList.remove('active');

  if (!type) {
    selQty.disabled = true;
    selQty.innerHTML = '<option value="">— Prima seleziona un prodotto —</option>';
    qtySelectGroup.style.display = '';
    catDFields.style.display = 'none';
    return;
  }

  if (type === 'D') {
    // Categoria D – campi manuali
    qtySelectGroup.style.display = 'none';
    catDFields.style.display = 'flex';
    manualQtyInp.value = '';
    manualPriceInp.value = '';
    return;
  }

  // Categorie A/B/C – select classico
  qtySelectGroup.style.display = '';
  catDFields.style.display = 'none';
  const p = PRODUCTS[type];
  selQty.disabled = false;
  selQty.innerHTML = '<option value="">— Seleziona quantità —</option>' +
    Array.from({length:10}, (_,i) => i+1).map(q =>
      `<option value="${q}">${p.fmt(q)}  →  ${fmt$(p.prices[q])}</option>`
    ).join('');
});

selQty.addEventListener('change', () => {
  const type = selProduct.value;
  const qty  = parseInt(selQty.value);
  if (!type || !qty) { priceAmt.textContent = '–'; priceDisp.classList.remove('active'); return; }
  priceAmt.textContent = fmt$(PRODUCTS[type].prices[qty]);
  priceDisp.classList.add('active');
});

// Aggiorna price display live per Cat D
function updateCatDPrice() {
  const price = parseFloat(manualPriceInp.value);
  if (!isNaN(price) && price > 0) {
    priceAmt.textContent = fmt$(price);
    priceDisp.classList.add('active');
  } else {
    priceAmt.textContent = '–';
    priceDisp.classList.remove('active');
  }
}
manualPriceInp.addEventListener('input', updateCatDPrice);
manualQtyInp.addEventListener('input', updateCatDPrice);

invoiceForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const productType = selProduct.value;
  if (!productType) { toast('Seleziona un prodotto', 'error'); return; }

  let quantity, manualPrice;

  if (productType === 'D') {
    quantity = parseInt(manualQtyInp.value);
    manualPrice = parseFloat(manualPriceInp.value);
    if (!quantity || quantity < 1) { toast('Inserisci una quantità valida', 'error'); return; }
    if (isNaN(manualPrice) || manualPrice <= 0) { toast('Inserisci un prezzo valido', 'error'); return; }
  } else {
    quantity = selQty.value;
    if (!quantity) { toast('Seleziona prodotto e quantità', 'error'); return; }
  }

  const origHTML = submitBtn.innerHTML;
  submitBtn.innerHTML = '<span class="spinner"></span> Registrazione...';
  submitBtn.disabled  = true;

  try {
    const body = {
      clientName:  document.getElementById('client-name').value.trim(),
      productType,
      quantity:    parseInt(quantity),
      notes:       document.getElementById('invoice-notes').value.trim()
    };
    if (productType === 'D') body.manualPrice = manualPrice;

    const res  = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`✅ Fattura registrata: ${fmt$(data.invoice.price)}`, 'success');

    invoiceForm.reset();
    selQty.disabled = true;
    selQty.innerHTML = '<option value="">— Prima seleziona un prodotto —</option>';
    qtySelectGroup.style.display = '';
    catDFields.style.display = 'none';
    priceAmt.textContent = '–';
    priceDisp.classList.remove('active');

    await loadMyInvoices();
  } catch (err) {
    toast(err.message || 'Errore durante la registrazione', 'error');
  } finally {
    submitBtn.innerHTML = origHTML;
    submitBtn.disabled  = false;
  }
});

// ─── Logout ───────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ─── Start ────────────────────────────────────────────────────────
init();

'use strict';

// ─── Product catalog (mirrors server) ────────────────────────────
const PRODUCTS = {
  A: {
    name: 'Combo cibo',
    fmt:  (n) => `${n}×${n}`,
    prices: {1:600,2:1200,3:1800,4:2400,5:3000,6:3600,7:4200,8:4800,9:5400,10:6000,15:9000,20:12000}
  },
  B: {
    name: 'Antistress singolo',
    fmt:  (n) => `${n}`,
    prices: {1:350,2:700,3:1050,4:1400,5:1750,6:2100,7:2450,8:2800,9:3150,10:3500,15:5250,20:7000}
  },
  C: {
    name: 'Combo cibo antistress',
    fmt:  (n) => `${n}×${n}×${n}`,
    prices: {1:950,2:1900,3:2850,4:3800,5:4750,6:5700,7:6650,8:7600,9:8550,10:9500,15:14250,20:19000}
  },
  D: {
    name: 'Personalizzata',
    fmt:  (n) => `${n}`,
    prices: null  // manuale
  },
  E: {
    name: 'Coupon',
    fmt:  (n) => `${n}`,
    prices: null
  }
};

let currentUser = null;
let myInvoices  = [];
let activities  = [];

// ─── Utils ────────────────────────────────────────────────────────
const fmt$  = (n) => '$' + Number(n).toLocaleString('it-IT');
const fmtDT = (iso) => new Date(iso).toLocaleString('it-IT', {
  day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
});
const getLocalDateString = (dateInput = new Date()) => {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
};

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icons = { success:'fa-circle-check', error:'fa-circle-exclamation', info:'fa-circle-info' };
  el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 3500);
}

function hideBadge(type) {
  const b = { A:'badge-A', B:'badge-B', C:'badge-C', D:'badge-D', E:'badge-E' };
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

    await Promise.all([loadActivities(), loadMyInvoices()]);
    hideLoader();
  } catch {
    window.location.href = '/';
  }
}

async function loadActivities() {
  const res = await fetch('/api/activities');
  activities = await res.json();
  const select = document.getElementById('client-activity');
  select.innerHTML = '<option value="">Nessuna convenzione</option>' + activities.map(activity =>
    `<option value="${activity.id}">${activity.name} (-${activity.discountPercentage}%)</option>`
  ).join('');
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
  const today = getLocalDateString();
  const tInv  = myInvoices.filter(i => getLocalDateString(i.createdAt) === today);

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
      <td class="price-cell">${inv.productType === 'E' ? '–' : (inv.discountAmount ? `<s class="text-muted">${fmt$(inv.originalPrice)}</s> ${fmt$(inv.price)}` : fmt$(inv.price))}</td>
      <td>${inv.activityName ? `<span class="badge badge-success">-${inv.discountPercentage}%</span><div class="text-muted">${inv.activityName}</div>` : '<span class="text-muted">–</span>'}</td>
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
const activitySelect = document.getElementById('client-activity');
const discountHint = document.getElementById('discount-hint');
const discountPreview = document.getElementById('discount-preview');

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
    // Categoria D – Personalizzata (quantità e prezzo manuali)
    qtySelectGroup.style.display = 'none';
    catDFields.style.display = 'flex';
    document.getElementById('manual-price-group').style.display = 'block';
    manualQtyInp.value = '';
    manualPriceInp.value = '';
    manualQtyInp.placeholder = 'Es. 5, -- oppure xxx';
    return;
  }

  if (type === 'E') {
    // Categoria E – Coupon (quantità manuale, senza prezzo)
    qtySelectGroup.style.display = 'none';
    catDFields.style.display = 'flex';
    document.getElementById('manual-price-group').style.display = 'none';
    manualQtyInp.value = '';
    manualPriceInp.value = '';
    manualQtyInp.placeholder = 'Es. 3';
    return;
  }

  // Categorie A/B/C – select classico
  qtySelectGroup.style.display = '';
  catDFields.style.display = 'none';
  const p = PRODUCTS[type];
  selQty.disabled = false;
  selQty.innerHTML = '<option value="">— Seleziona quantità —</option>' +
    Object.keys(p.prices).map(Number).map(q =>
      `<option value="${q}">${p.fmt(q)}  →  ${fmt$(p.prices[q])}</option>`
    ).join('');
});

function updatePricePreview(originalPrice) {
  const activity = activities.find(item => item.id === activitySelect.value);
  const discount = activity ? Number(activity.discountPercentage) : 0;
  const total = Math.round((originalPrice * (1 - discount / 100)) * 100) / 100;
  if (!Number.isFinite(originalPrice) || originalPrice <= 0) {
    priceAmt.textContent = '–';
    priceDisp.classList.remove('active');
    discountPreview.classList.add('hidden');
    return;
  }
  priceAmt.textContent = fmt$(total);
  priceDisp.classList.add('active');
  if (activity) {
    discountHint.textContent = `${activity.name}: sconto del ${activity.discountPercentage}% applicato al cliente.`;
    discountPreview.textContent = `Prezzo originale ${fmt$(originalPrice)} · Risparmio ${fmt$(Math.round((originalPrice - total) * 100) / 100)}`;
    discountPreview.classList.remove('hidden');
  } else {
    discountHint.textContent = 'Se il cliente lavora in un’attività convenzionata, selezionala qui.';
    discountPreview.classList.add('hidden');
  }
}

activitySelect.addEventListener('change', () => {
  const originalPrice = selProduct.value === 'D' ? parseFloat(manualPriceInp.value) : (selProduct.value === 'E' ? 0 : PRODUCTS[selProduct.value]?.prices[parseInt(selQty.value)]);
  updatePricePreview(originalPrice);
});

selQty.addEventListener('change', () => {
  const type = selProduct.value;
  const qty  = parseInt(selQty.value);
  if (!type || !qty) { priceAmt.textContent = '–'; priceDisp.classList.remove('active'); return; }
  updatePricePreview(PRODUCTS[type].prices[qty]);
});

// Aggiorna price display live per Cat D
function updateCatDPrice() {
  if (selProduct.value === 'D') {
    const price = parseFloat(manualPriceInp.value);
    if (!isNaN(price) && price > 0) {
      updatePricePreview(price);
    } else {
      priceAmt.textContent = '–';
      priceDisp.classList.remove('active');
    }
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
    quantity = manualQtyInp.value.trim();
    manualPrice = parseFloat(manualPriceInp.value);
    if (!quantity) { toast('Inserisci una quantità valida', 'error'); return; }
    if (isNaN(manualPrice) || manualPrice <= 0) { toast('Inserisci un prezzo valido', 'error'); return; }
  } else if (productType === 'E') {
    quantity = manualQtyInp.value.trim();
    const qtyInt = parseInt(quantity, 10);
    if (!quantity || isNaN(qtyInt) || qtyInt <= 0) {
      toast('Inserisci una quantità valida (numero intero positivo)', 'error');
      return;
    }
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
      quantity,
      activityId:   activitySelect.value || null,
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

    toast(productType === 'E' ? '✅ Coupon registrato' : `✅ Fattura registrata: ${fmt$(data.invoice.price)}`, 'success');

    invoiceForm.reset();
    selQty.disabled = true;
    selQty.innerHTML = '<option value="">— Prima seleziona un prodotto —</option>';
    qtySelectGroup.style.display = '';
    catDFields.style.display = 'none';
    activitySelect.value = '';
    discountHint.textContent = 'Se il cliente lavora in un’attività convenzionata, selezionala qui.';
    discountPreview.classList.add('hidden');
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

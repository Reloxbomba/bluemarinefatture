'use strict';

// ─── Product catalog (loaded dynamically) ────────────────────────
let PRODUCTS = {};

let currentUser = null;
let myInvoices  = [];
let activities  = [];
let myPayments  = [];
let editingInvoiceId = null;

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

    const prodRes = await fetch('/api/products');
    PRODUCTS = await prodRes.json();

    await Promise.all([loadActivities(), loadMyInvoices(), loadMyPayments()]);
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

function formatQty(type, qty) {
  const p = PRODUCTS[type];
  if (!p) return qty;
  if (p.format === 'NxN') return `${qty}×${qty}`;
  if (p.format === 'NxNxN') return `${qty}×${qty}×${qty}`;
  return qty;
}

function renderInvoices() {
  const tbody = document.getElementById('my-invoices-body');
  if (myInvoices.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">
      <i class="fa-solid fa-inbox"></i><p>Nessuna fattura ancora registrata</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = myInvoices.map(inv => {
    const timeDiffMins = (new Date() - new Date(inv.createdAt)) / (1000 * 60);
    const canDelete = timeDiffMins <= 15;
    const canEdit = timeDiffMins <= 15;
    
    const deleteBtn = canDelete 
      ? `<button class="btn btn-danger btn-sm btn-icon" onclick="stornoInvoice('${inv.id}')" title="Storna/Annulla fattura" style="margin-left: 5px;"><i class="fa-solid fa-trash"></i></button>`
      : '';

    const editBtn = canEdit 
      ? `<button class="btn btn-ghost btn-sm btn-icon" onclick="editInvoice('${inv.id}')" title="Modifica fattura" style="margin-left: 5px;"><i class="fa-solid fa-pencil"></i></button>`
      : '';
      
    const printBtn = `<button class="btn btn-ghost btn-sm btn-icon" onclick="printReceipt('${inv.id}')" title="Stampa ricevuta cliente"><i class="fa-solid fa-print"></i></button>`;

    return `
      <tr>
        <td><span style="color:var(--text-3);font-size:.8rem;">${fmtDT(inv.createdAt)}</span></td>
        <td>${inv.clientName}</td>
        <td>${hideBadge(inv.productType)}</td>
        <td><span class="qty-pill">${formatQty(inv.productType, inv.quantity)}</span></td>
        <td class="price-cell">${inv.productType === 'E' ? '–' : (inv.discountAmount ? `<s class="text-muted">${fmt$(inv.originalPrice)}</s> ${fmt$(inv.price)}` : fmt$(inv.price))}</td>
        <td>${inv.activityName ? `<span class="badge badge-success">-${inv.discountPercentage}%</span><div class="text-muted">${inv.activityName}</div>` : '<span class="text-muted">–</span>'}</td>
        <td>
          <div style="display:flex;gap:.3rem;justify-content:center;align-items:center;">
            ${printBtn}
            ${editBtn}
            ${deleteBtn}
          </div>
        </td>
      </tr>
    `;
  }).join('');
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
      `<option value="${q}">${formatQty(type, q)}  →  ${fmt$(p.prices[q])}</option>`
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

  const isEditing = editingInvoiceId !== null;
  const url = isEditing ? `/api/invoices/my/${editingInvoiceId}` : '/api/invoices';
  const method = isEditing ? 'PUT' : 'POST';

  const origHTML = submitBtn.innerHTML;
  submitBtn.innerHTML = isEditing ? '<span class="spinner"></span> Salvataggio...' : '<span class="spinner"></span> Registrazione...';
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

    const res  = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (isEditing) {
      toast('✅ Fattura modificata con successo', 'success');
      cancelEdit();
    } else {
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
    }

    await loadMyInvoices();
  } catch (err) {
    toast(err.message || 'Errore durante l\'operazione', 'error');
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

// ─── Change Password Modal ────────────────────────────────────────
const pwModal = document.getElementById('modal-change-password');
const btnPwTrigger = document.getElementById('btn-change-password-trigger');
const oldPwInp = document.getElementById('old-password');
const newPwInp = document.getElementById('new-password-self');
const pwSaveBtn = document.getElementById('pw-modal-save');

function openPwModal() {
  oldPwInp.value = '';
  newPwInp.value = '';
  pwModal.classList.remove('hidden');
  oldPwInp.focus();
}

function closePwModal() {
  pwModal.classList.add('hidden');
}

btnPwTrigger.addEventListener('click', openPwModal);
['pw-modal-close', 'pw-modal-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closePwModal);
});
pwModal.addEventListener('click', e => {
  if (e.target === e.currentTarget) closePwModal();
});

pwSaveBtn.addEventListener('click', async () => {
  const currentPassword = oldPwInp.value;
  const newPassword = newPwInp.value;
  if (!currentPassword || !newPassword) {
    toast('Tutti i campi sono obbligatori', 'error');
    return;
  }
  if (newPassword.length < 4) {
    toast('La nuova password deve contenere almeno 4 caratteri', 'error');
    return;
  }
  
  try {
    const res = await fetch('/api/auth/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    toast('Password aggiornata con successo', 'success');
    closePwModal();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ─── Payments History ─────────────────────────────────────────────
async function loadMyPayments() {
  try {
    const res = await fetch('/api/payments/my');
    myPayments = await res.json();
    renderPayments();
  } catch {
    toast('Errore nel caricamento dei pagamenti', 'error');
  }
}

function renderPayments() {
  const tbody = document.getElementById('my-payments-body');
  if (!tbody) return;
  if (myPayments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">
      <i class="fa-solid fa-receipt"></i><p>Nessun pagamento ancora liquidato</p>
    </div></td></tr>`;
    return;
  }
  tbody.innerHTML = myPayments.map(p => `
    <tr>
      <td><span style="color:var(--text-3);font-size:.8rem;">${fmtDT(p.paymentDate)}</span></td>
      <td class="price-cell text-success" style="font-weight:700;">${fmt$(p.amountPaid)}</td>
      <td class="price-cell">${fmt$(p.payableAmount)}</td>
      <td><strong>${p.payableCoupons}</strong></td>
      <td>${p.commissionPercentage}%</td>
      <td><span style="color:var(--text-2);font-size:0.78rem;">Da: ${fmtDT(p.periodFrom)}<br>A: ${fmtDT(p.periodTo)}</span></td>
    </tr>
  `).join('');
}

// ─── Storno Invoice (15m window) ──────────────────────────────────
async function stornoInvoice(id) {
  if (!window.confirm('Sei sicuro di voler stornare/annullare questa fattura?')) return;
  try {
    const res = await fetch(`/api/invoices/my/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    toast('Fattura stornata con successo', 'success');
    await loadMyInvoices();
  } catch (err) {
    toast(err.message || 'Errore durante lo storno', 'error');
  }
}

// ─── Print Receipt ────────────────────────────────────────────────
function printReceipt(id) {
  const inv = myInvoices.find(i => i.id === id);
  if (!inv) return;

  const w = window.open('', '_blank', 'width=600,height=600');
  
  const originalPriceStr = inv.productType === 'E' ? '–' : fmt$(inv.originalPrice);
  const discountStr = inv.discountPercentage ? `${inv.discountPercentage}% (-${fmt$(inv.discountAmount)})` : 'Nessuno';
  const priceStr = inv.productType === 'E' ? '–' : fmt$(inv.price);

  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Ricevuta - Blue Marine NOW</title>
      <meta charset="utf-8" />
      <style>
        body {
          font-family: 'Courier New', Courier, monospace;
          color: #000;
          background: #fff;
          padding: 20px;
          max-width: 300px;
          margin: 0 auto;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .logo {
          font-size: 24px;
          margin: 0;
        }
        .subtitle {
          font-size: 12px;
          margin: 5px 0 0 0;
          color: #555;
        }
        .divider {
          border-top: 1px dashed #000;
          margin: 10px 0;
        }
        .info-row {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          margin: 4px 0;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          font-weight: bold;
          font-size: 16px;
          margin: 10px 0;
        }
        .footer-text {
          text-align: center;
          font-size: 11px;
          margin-top: 30px;
        }
        @media print {
          body { padding: 0; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h2 class="logo">⚓ Blue Marine NOW</h2>
        <p class="subtitle">Gestione Fatture di Servizio</p>
      </div>
      <div class="divider"></div>
      <div class="info-row">
        <span>Fattura ID:</span>
        <span style="font-size:10px;">${inv.id.slice(0,8)}...</span>
      </div>
      <div class="info-row">
        <span>Data:</span>
        <span>${new Date(inv.createdAt).toLocaleString('it-IT')}</span>
      </div>
      <div class="info-row">
        <span>Operatore:</span>
        <span>${inv.employeeName}</span>
      </div>
      <div class="info-row">
        <span>Cliente:</span>
        <span>${inv.clientName}</span>
      </div>
      <div class="divider"></div>
      <div class="info-row">
        <span>Prodotto:</span>
        <span><strong>${inv.productName}</strong></span>
      </div>
      <div class="info-row">
        <span>Quantità:</span>
        <span>${formatQty(inv.productType, inv.quantity)}</span>
      </div>
      <div class="divider"></div>
      <div class="info-row">
        <span>Prezzo originale:</span>
        <span>${originalPriceStr}</span>
      </div>
      <div class="info-row">
        <span>Convenzione:</span>
        <span style="max-width:180px;text-align:right;">${inv.activityName || 'Nessuna'}</span>
      </div>
      <div class="info-row">
        <span>Sconto:</span>
        <span>${discountStr}</span>
      </div>
      <div class="divider"></div>
      <div class="total-row">
        <span>TOTALE PAGATO:</span>
        <span>${priceStr}</span>
      </div>
      <div class="divider"></div>
      <div class="footer-text">
        Grazie per averci scelto!<br>Blue Marine NOW Portale Servizi
      </div>
      <script>
        window.onload = function() {
          window.print();
        }
      </script>
    </body>
    </html>
  `);
  w.document.close();
}

function editInvoice(id) {
  const inv = myInvoices.find(i => i.id === id);
  if (!inv) return;

  const timeDiffMins = (new Date() - new Date(inv.createdAt)) / (1000 * 60);
  if (timeDiffMins > 15) {
    toast('Tempo scaduto: puoi modificare una fattura solo entro 15 minuti', 'error');
    return;
  }

  editingInvoiceId = id;
  
  // Imposta i campi
  document.getElementById('client-name').value = inv.clientName === 'Anonimo' ? '' : inv.clientName;
  document.getElementById('client-activity').value = inv.activityId || '';
  
  selProduct.value = inv.productType;
  selProduct.dispatchEvent(new Event('change'));
  
  if (inv.productType === 'D') {
    manualQtyInp.value = inv.quantity;
    manualPriceInp.value = inv.originalPrice;
  } else if (inv.productType === 'E') {
    manualQtyInp.value = inv.quantity;
  } else {
    selQty.value = inv.quantity;
  }
  
  document.getElementById('invoice-notes').value = inv.notes || '';
  
  // Aggiorna prezzi
  updatePricePreview(inv.originalPrice);

  // Cambia UI del form in "Modifica"
  document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-pencil text-accent"></i>&nbsp; Modifica Fattura';
  submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salva Modifiche';
  submitBtn.className = 'btn btn-primary btn-lg';
  submitBtn.style.flex = '1';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');

  // Scorri fino al form
  document.getElementById('invoice-form').scrollIntoView({ behavior: 'smooth' });
}

function cancelEdit() {
  editingInvoiceId = null;
  invoiceForm.reset();
  
  // Ripristina select
  selQty.disabled = true;
  selQty.innerHTML = '<option value="">— Prima seleziona un prodotto —</option>';
  qtySelectGroup.style.display = '';
  catDFields.style.display = 'none';
  activitySelect.value = '';
  discountHint.textContent = 'Se il cliente lavora in un’attività convenzionata, selezionala qui.';
  discountPreview.classList.add('hidden');
  priceAmt.textContent = '–';
  priceDisp.classList.remove('active');

  // Ripristina UI del form in "Nuova Fattura"
  document.getElementById('form-title').innerHTML = '<i class="fa-solid fa-plus-circle text-accent"></i>&nbsp; Nuova Fattura';
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Registra Fattura';
  submitBtn.className = 'btn btn-success btn-lg';
  submitBtn.style.flex = '1';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
}

window.stornoInvoice = stornoInvoice;
window.printReceipt = printReceipt;
window.editInvoice = editInvoice;
window.cancelEdit = cancelEdit;

document.getElementById('cancel-edit-btn').addEventListener('click', cancelEdit);

// ─── Start ────────────────────────────────────────────────────────
init();

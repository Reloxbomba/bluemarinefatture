'use strict';

// ─── Fetch Interceptor & Silent Re-auth ───────────────────────────
const originalFetch = window.fetch;
let silentLoginPromise = null;

async function performSilentLogin(username, password) {
  if (silentLoginPromise) return silentLoginPromise;
  
  silentLoginPromise = (async () => {
    try {
      const loginRes = await originalFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      if (loginRes.ok) {
        return true;
      }
    } catch (err) {
      console.error('Silent re-auth failed:', err);
    } finally {
      silentLoginPromise = null;
    }
    return false;
  })();
  
  return silentLoginPromise;
}

window.fetch = async function(url, options = {}) {
  let res = await originalFetch(url, options);
  const urlStr = typeof url === 'string' ? url : (url.url || '');
  
  // Intercept 401 response (excluding login/logout calls)
  if (res.status === 401 && !urlStr.includes('/api/auth/login') && !urlStr.includes('/api/auth/logout')) {
    const username = localStorage.getItem('rememberedUsername');
    const password = localStorage.getItem('rememberedPassword');
    
    if (username && password) {
      const loginSuccess = await performSilentLogin(username, password);
      if (loginSuccess) {
        // Retry the original request
        res = await originalFetch(url, options);
        return res;
      }
    }
    
    // If no credentials or login failed, redirect to login page
    window.location.href = '/';
    throw new Error('Sessione scaduta. Reindirizzamento in corso...');
  }
  
  return res;
};

// ─── State ───────────────────────────────────────────────────────
let currentUser  = null;
let allInvoices  = [];
let allUsers     = [];
let allActivities = [];
let allProducts  = {};
let allPayments  = [];
let stats        = null;
let resetTargetId   = null;
let deleteTarget    = null; // { id, name, type: 'user'|'invoice'|'product' }
let salaryTarget    = null;
let empChart     = null;
let prodChart    = null;
let activityTargetId = null;
let productTargetId = null;

// ─── Utils ────────────────────────────────────────────────────────
const fmt$  = (n) => '$' + Number(n).toLocaleString('it-IT');
const fmtDT = (iso) => new Date(iso).toLocaleString('it-IT', {
  day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
});
const fmtD  = (iso) => new Date(iso).toLocaleString('it-IT', {
  day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'
});

function toast(msg, type = 'info') {
  const icons = { success:'fa-circle-check', error:'fa-circle-exclamation', info:'fa-circle-info' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type]}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 3800);
}

function getProdName(type) {
  return allProducts[type]?.name || type;
}
function formatQty(type, qty) {
  const p = allProducts[type];
  if (!p) return qty;
  if (p.format === 'NxN') return `${qty}×${qty}`;
  if (p.format === 'NxNxN') return `${qty}×${qty}×${qty}`;
  return qty;
}
function qtyPill(type, qty)  { return `<span class="qty-pill">${formatQty(type, qty)}</span>`; }
function prodBadge(type)     {
  const b = { A:'badge-A', B:'badge-B', C:'badge-C', D:'badge-D', E:'badge-E' };
  return `<span class="badge ${b[type] || 'badge-accent'}">${getProdName(type)}</span>`;
}
function roleBadge(role)     {
  return role === 'admin'
    ? '<span class="badge badge-admin">👑 Admin</span>'
    : '<span class="badge badge-employee">👤 Dipendente</span>';
}

// ─── Auth & Init ─────────────────────────────────────────────────
async function init() {
  try {
    const res  = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();
    if (user.role !== 'admin') { window.location.href = '/employee.html'; return; }

    currentUser = user;
    document.getElementById('user-name').textContent   = user.username;
    document.getElementById('user-avatar').textContent = user.username[0].toUpperCase();

    await refreshAll();
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

async function refreshAll() {
  await Promise.all([loadStats(), loadInvoices(), loadUsers(), loadActivities(), loadProducts(), loadPayments()]);
  renderOverview();
  populateProductFilter();
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'employees') renderEmployeeStats();
  if (activeTab === 'users') renderUsers();
  if (activeTab === 'activities') renderActivities();
  if (activeTab === 'products') renderProducts();
  if (activeTab === 'payments') renderPayments();
}

// ─── Data Fetching ────────────────────────────────────────────────
async function loadStats() {
  const res = await fetch('/api/stats');
  stats = await res.json();
}
async function loadInvoices() {
  const res  = await fetch('/api/invoices');
  allInvoices = await res.json();
}
async function loadUsers() {
  const res = await fetch('/api/users');
  allUsers  = await res.json();
}
async function loadActivities() {
  const res = await fetch('/api/admin/activities');
  allActivities = await res.json();
}
async function loadProducts() {
  const res = await fetch('/api/admin/products');
  allProducts = await res.json();
}
async function loadPayments() {
  const res = await fetch('/api/payments');
  allPayments = await res.json();
}

function populateProductFilter() {
  const sel = document.getElementById('f-product');
  if (!sel) return;
  const currentVal = sel.value;
  sel.innerHTML = '<option value="">Tutti i prodotti</option>' +
    Object.values(allProducts).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  sel.value = currentVal;
}

function displayPrice(invoice) {
  if (invoice.productType === 'E') return '–';
  return invoice.discountAmount
    ? `<s class="text-muted">${fmt$(invoice.originalPrice)}</s> ${fmt$(invoice.price)} <span class="badge badge-success">-${invoice.discountPercentage}%</span>`
    : fmt$(invoice.price);
}

// ─── Overview Tab ─────────────────────────────────────────────────
function renderOverview() {
  if (!stats) return;

  document.getElementById('ov-total-inv').textContent = stats.total.invoices;
  document.getElementById('ov-total-amt').textContent = fmt$(stats.total.amount);
  document.getElementById('ov-today-inv').textContent = stats.today.invoices;
  document.getElementById('ov-today-amt').textContent = fmt$(stats.today.amount);

  // Recent invoices (last 10)
  const tbody = document.getElementById('recent-body');
  const slice = allInvoices.slice(0, 10);
  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Nessuna fattura</p></div></td></tr>`;
  } else {
    tbody.innerHTML = slice.map(inv => `
      <tr>
        <td><span style="color:var(--text-3);font-size:.8rem;">${fmtD(inv.createdAt)}</span></td>
        <td><strong>${inv.employeeName}</strong></td>
        <td>${inv.clientName}</td>
        <td>${prodBadge(inv.productType)}</td>
        <td>${qtyPill(inv.productType, inv.quantity)}</td>
        <td class="price-cell">${displayPrice(inv)}</td>
      </tr>`).join('');
  }

  renderCharts();
}

function renderCharts() {
  // Chart.js defaults
  Chart.defaults.color = '#5d8099';
  Chart.defaults.font.family = 'Outfit';

  const tooltipStyle = {
    backgroundColor: 'rgba(5,14,30,0.96)',
    borderColor: 'rgba(0,180,216,0.3)',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8
  };

  // Employee bar chart
  const empCtx = document.getElementById('chart-employees')?.getContext('2d');
  if (empCtx) {
    if (empChart) empChart.destroy();
    const data = stats.employees.filter(e => e.totalInvoices > 0);
    empChart = new Chart(empCtx, {
      type: 'bar',
      data: {
        labels: data.map(e => e.username),
        datasets: [{
          label: 'Fatture',
          data:  data.map(e => e.totalInvoices),
          backgroundColor: 'rgba(0,180,216,0.55)',
          borderColor: '#00b4d8',
          borderWidth: 1,
          borderRadius: 7,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${c.raw} fatture` } }
        },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5d8099' } },
          y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5d8099', stepSize: 1 }, beginAtZero: true }
        }
      }
    });
  }

  // Product doughnut chart
  const prodCtx = document.getElementById('chart-products')?.getContext('2d');
  if (prodCtx) {
    if (prodChart) prodChart.destroy();
    prodChart = new Chart(prodCtx, {
      type: 'doughnut',
      data: {
        labels: stats.products.map(p => p.name),
        datasets: [{
          data: stats.products.map(p => p.count),
          backgroundColor: ['rgba(0,180,216,0.65)', 'rgba(46,213,115,0.65)', 'rgba(255,165,2,0.65)'],
          borderColor:     ['#00b4d8', '#2ed573', '#ffa502'],
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        cutout: '62%',
        plugins: {
          legend: { position:'bottom', labels: { color:'#a8c4dc', padding:16, boxWidth:14, font:{size:12} } },
          tooltip: { ...tooltipStyle, callbacks: { label: c => ` ${c.label}: ${c.raw} fatture` } }
        }
      }
    });
  }
}

// ─── All Invoices Tab ─────────────────────────────────────────────
function renderAllInvoices(list) {
  const tbody  = document.getElementById('all-inv-body');
  const footer = document.getElementById('inv-footer');

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Nessuna fattura trovata</p></div></td></tr>`;
    footer.textContent = '';
    return;
  }

  const total = list.reduce((s,i) => s + i.price, 0);
  footer.textContent = `Risultati: ${list.length} fatture  ·  Totale: ${fmt$(total)}`;

  tbody.innerHTML = list.map(inv => `
    <tr>
      <td><span style="color:var(--text-3);font-size:.8rem;">${fmtDT(inv.createdAt)}</span></td>
      <td><strong>${inv.employeeName}</strong></td>
      <td>${inv.clientName}</td>
      <td>${prodBadge(inv.productType)}</td>
      <td>${qtyPill(inv.productType, inv.quantity)}</td>
      <td class="price-cell">${displayPrice(inv)}${inv.activityName ? `<div class="text-muted">${inv.activityName}</div>` : ''}</td>
      <td class="truncate" style="max-width:120px;" title="${inv.notes||''}">${inv.notes || '<span style="opacity:.4">–</span>'}</td>
      <td>
        <button class="btn btn-danger btn-sm btn-icon" onclick="openDeleteInvoice('${inv.id}')" title="Elimina fattura">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function renderActivities() {
  const tbody = document.getElementById('activities-body');
  if (!allActivities.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-building"></i><p>Nessuna attività convenzionata</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = allActivities.filter(activity => activity.active !== false).map(activity => `
    <tr>
      <td><strong>${activity.name}</strong></td>
      <td><span class="badge badge-success">-${activity.discountPercentage}%</span></td>
      <td><span class="text-muted">${fmtDT(activity.createdAt)}</span></td>
      <td><div style="display:flex;gap:.4rem;align-items:center;">
        <button class="btn btn-ghost btn-sm btn-icon" onclick="openActivityModal('${activity.id}')" title="Modifica attività"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-danger btn-sm btn-icon" onclick="deleteActivity('${activity.id}')" title="Disattiva attività"><i class="fa-solid fa-trash"></i></button>
      </div></td>
    </tr>`).join('');
}

function openActivityModal(id = null) {
  activityTargetId = id;
  const activity = allActivities.find(item => item.id === id);
  document.getElementById('activity-modal-title').textContent = activity ? 'Modifica attività' : 'Nuova attività';
  document.getElementById('activity-name').value = activity?.name || '';
  document.getElementById('activity-discount').value = activity?.discountPercentage ?? '';
  document.getElementById('modal-activity').classList.remove('hidden');
  document.getElementById('activity-name').focus();
}

function closeActivityModal() {
  document.getElementById('modal-activity').classList.add('hidden');
  activityTargetId = null;
}

document.getElementById('btn-add-activity').addEventListener('click', () => openActivityModal());
['activity-modal-close', 'activity-modal-cancel'].forEach(id => document.getElementById(id).addEventListener('click', closeActivityModal));
document.getElementById('modal-activity').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeActivityModal();
});
document.getElementById('activity-modal-save').addEventListener('click', async () => {
  const name = document.getElementById('activity-name').value.trim();
  const discountPercentage = Number(document.getElementById('activity-discount').value);
  if (!name || !Number.isFinite(discountPercentage) || discountPercentage < 0 || discountPercentage > 100) {
    toast('Inserisci un nome e una percentuale tra 0 e 100', 'error');
    return;
  }
  try {
    const res = await fetch(`/api/admin/activities${activityTargetId ? `/${activityTargetId}` : ''}`, {
      method: activityTargetId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, discountPercentage })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadActivities();
    renderActivities();
    closeActivityModal();
    toast(activityTargetId ? 'Attività aggiornata' : 'Attività creata', 'success');
  } catch (err) {
    toast(err.message || 'Errore nel salvataggio dell’attività', 'error');
  }
});

async function deleteActivity(id) {
  if (!window.confirm('Disattivare questa attività? Le fatture già registrate resteranno invariate.')) return;
  try {
    const res = await fetch(`/api/admin/activities/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadActivities();
    renderActivities();
    toast('Attività disattivata', 'success');
  } catch (err) {
    toast(err.message || 'Errore nella disattivazione', 'error');
  }
}

async function applyFilters() {
  const params = new URLSearchParams();
  const emp  = document.getElementById('f-employee').value;
  const prod = document.getElementById('f-product').value;
  const from = document.getElementById('f-from').value;
  const to   = document.getElementById('f-to').value;

  if (emp)  params.set('employeeId',  emp);
  if (prod) params.set('productType', prod);
  if (from) params.set('dateFrom',    from);
  if (to)   params.set('dateTo',      to);

  const res  = await fetch(`/api/invoices?${params}`);
  const data = await res.json();
  renderAllInvoices(data);
}

function populateEmployeeFilter() {
  const sel = document.getElementById('f-employee');
  const emps = allUsers.filter(u => u.role === 'employee');
  sel.innerHTML = '<option value="">Tutti i dipendenti</option>' +
    emps.map(e => `<option value="${e.id}">${e.username}</option>`).join('');
}

// ─── Employee Stats Tab ───────────────────────────────────────────
function renderEmployeeStats() {
  if (!stats) return;
  const tbody = document.getElementById('emp-body');
  const sorted = [...stats.employees].sort((a,b) => b.totalInvoices - a.totalInvoices);

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><i class="fa-solid fa-users"></i><p>Nessun dipendente registrato</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((emp, idx) => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.7rem;">
          <div class="avatar" style="width:30px;height:30px;font-size:.75rem;flex-shrink:0;">${emp.username[0].toUpperCase()}</div>
          <strong>${emp.username}</strong>
          ${idx === 0 && emp.totalInvoices > 0 ? '<span class="badge badge-success" style="font-size:.65rem;">🏆 Top</span>' : ''}
        </div>
      </td>
      <td><strong>${emp.totalInvoices}</strong></td>
      <td class="price-cell">${fmt$(emp.totalAmount)}</td>
      <td>
        <label style="display:flex;align-items:center;gap:.35rem;max-width:110px;">
          <input class="form-control commission-input" type="number" min="0" max="100" step="0.01"
            value="${emp.commissionPercentage ?? 0}" onchange="updateCommission('${emp.id}', this.value)" aria-label="Percentuale guadagno di ${emp.username}">
          <span>%</span>
        </label>
      </td>
      <td><strong>${emp.payableCoupons ?? 0}</strong> <span class="text-muted" style="font-size:.8rem;">(${emp.totalCoupons ?? 0} tot)</span></td>
      <td class="price-cell text-success">${fmt$(emp.amountDue)}</td>
      <td>${emp.todayInvoices}</td>
      <td style="color:var(--accent);font-weight:700;">${fmt$(emp.todayAmount)}</td>
      <td><span style="color:var(--text-3);font-size:.8rem;">${emp.lastActivity ? fmtDT(emp.lastActivity) : 'Mai'}</span></td>
      <td>
        <button class="btn btn-warning btn-sm" onclick="resetSalary('${emp.id}', '${emp.username.replace(/'/g, "\\'")}')" title="Azzera il saldo da pagare">
          <i class="fa-solid fa-money-bill-transfer"></i> Segna pagato
        </button>
      </td>
    </tr>`).join('');
}

async function updateCommission(id, value) {
  const commissionPercentage = Number(value);
  if (!Number.isFinite(commissionPercentage) || commissionPercentage < 0 || commissionPercentage > 100) {
    toast('La percentuale deve essere compresa tra 0 e 100', 'error');
    renderEmployeeStats();
    return;
  }

  try {
    const res = await fetch(`/api/users/${id}/commission`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commissionPercentage })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const user = allUsers.find(u => u.id === id);
    if (user) user.commissionPercentage = data.commissionPercentage;
    const employee = stats?.employees.find(emp => emp.id === id);
    if (employee) {
      employee.commissionPercentage = data.commissionPercentage;
      employee.amountDue = Math.round(employee.payableAmount * data.commissionPercentage) / 100;
    }
    renderEmployeeStats();
    toast('Percentuale aggiornata', 'success');
  } catch (err) {
    toast(err.message || 'Errore nel salvataggio della percentuale', 'error');
    renderEmployeeStats();
  }
}

async function resetSalary(id, name) {
  salaryTarget = { id, name };
  document.getElementById('salary-target-name').textContent = name;
  document.getElementById('modal-confirm-salary').classList.remove('hidden');
}

['modal-salary-close','modal-salary-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeSalaryModal);
});
document.getElementById('modal-confirm-salary').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeSalaryModal();
});
function closeSalaryModal() {
  document.getElementById('modal-confirm-salary').classList.add('hidden');
  salaryTarget = null;
}

document.getElementById('modal-salary-confirm').addEventListener('click', async () => {
  if (!salaryTarget) return;
  const { id, name } = salaryTarget;
  const confirmButton = document.getElementById('modal-salary-confirm');
  confirmButton.disabled = true;

  try {
    const res = await fetch(`/api/users/${id}/salary-reset`, { method: 'PUT' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await loadStats();
    renderEmployeeStats();
    toast(`Saldo di ${name} azzerato`, 'success');
  } catch (err) {
    toast(err.message || 'Errore nel reset dello stipendio', 'error');
  } finally {
    confirmButton.disabled = false;
    closeSalaryModal();
  }
});

// ─── Users Tab ────────────────────────────────────────────────────
function renderUsers() {
  const tbody = document.getElementById('users-body');
  if (!allUsers.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-users"></i><p>Nessun utente</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = allUsers.map(u => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:.7rem;">
          <div class="avatar ${u.role==='admin'?'admin':''}" style="width:30px;height:30px;font-size:.75rem;flex-shrink:0;">${u.username[0].toUpperCase()}</div>
          <strong>${u.username}</strong>
          ${u.id === currentUser.id ? '<span class="badge" style="font-size:.62rem;background:rgba(255,255,255,0.07);color:var(--text-3);border-color:var(--border);">Tu</span>' : ''}
        </div>
      </td>
      <td>${roleBadge(u.role)}</td>
      <td><span style="color:var(--text-3);font-size:.82rem;">${fmtDT(u.createdAt)}</span></td>
      <td>
        <div style="display:flex;gap:.4rem;align-items:center;">
          <button class="btn btn-ghost btn-sm" onclick="openResetPw('${u.id}','${u.username}')">
            <i class="fa-solid fa-key"></i> Reset PW
          </button>
          ${u.id !== currentUser.id ? `
            <button class="btn btn-danger btn-sm btn-icon" onclick="openDeleteUser('${u.id}','${u.username}')" title="Elimina utente">
              <i class="fa-solid fa-trash"></i>
            </button>` : ''}
        </div>
      </td>
    </tr>`).join('');
}

// ─── Add User Modal ───────────────────────────────────────────────
document.getElementById('btn-add-user').addEventListener('click', () => {
  document.getElementById('modal-add-user').classList.remove('hidden');
  document.getElementById('new-username').focus();
});
['modal-add-close','modal-add-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeAddModal);
});
document.getElementById('modal-add-user').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeAddModal();
});
function closeAddModal() {
  document.getElementById('modal-add-user').classList.add('hidden');
  document.getElementById('new-username').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('new-role').value = 'employee';
}

document.getElementById('modal-add-confirm').addEventListener('click', async () => {
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value;
  const role     = document.getElementById('new-role').value;

  if (!username || !password) { toast('Compila tutti i campi', 'error'); return; }

  try {
    const res  = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(`Utente "${username}" creato`, 'success');
    closeAddModal();
    await Promise.all([loadUsers(), loadStats()]);
    renderUsers();
    renderEmployeeStats();
    populateEmployeeFilter();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ─── Reset Password Modal ─────────────────────────────────────────
function openResetPw(id, name) {
  resetTargetId = id;
  document.getElementById('reset-target-name').textContent = name;
  document.getElementById('modal-reset-pw').classList.remove('hidden');
  document.getElementById('reset-pw-input').focus();
}
['modal-reset-close','modal-reset-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeResetModal);
});
document.getElementById('modal-reset-pw').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeResetModal();
});
function closeResetModal() {
  document.getElementById('modal-reset-pw').classList.add('hidden');
  document.getElementById('reset-pw-input').value = '';
  resetTargetId = null;
}

document.getElementById('modal-reset-confirm').addEventListener('click', async () => {
  const pw = document.getElementById('reset-pw-input').value;
  if (!pw || pw.length < 4) { toast('Password troppo corta (min 4 caratteri)', 'error'); return; }

  try {
    const res = await fetch(`/api/users/${resetTargetId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    if (!res.ok) throw new Error('Errore nel reset');
    toast('Password aggiornata con successo', 'success');
    closeResetModal();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ─── Delete Confirm Modal ─────────────────────────────────────────
function openDeleteUser(id, name) {
  deleteTarget = { id, name, type: 'user' };
  document.getElementById('delete-target-name').textContent = `l'utente "${name}"`;
  document.getElementById('modal-confirm-delete').classList.remove('hidden');
}
function openDeleteInvoice(id) {
  deleteTarget = { id, name: 'questa fattura', type: 'invoice' };
  document.getElementById('delete-target-name').textContent = 'questa fattura';
  document.getElementById('modal-confirm-delete').classList.remove('hidden');
}
['modal-del-close','modal-del-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeDeleteModal);
});
document.getElementById('modal-confirm-delete').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeDeleteModal();
});
function closeDeleteModal() {
  document.getElementById('modal-confirm-delete').classList.add('hidden');
  deleteTarget = null;
}

document.getElementById('modal-del-confirm').addEventListener('click', async () => {
  if (!deleteTarget) return;
  try {
    let res;
    if (deleteTarget.type === 'user') {
      res = await fetch(`/api/users/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast(`Utente eliminato`, 'success');
      await Promise.all([loadUsers(), loadStats()]);
      renderUsers();
      renderEmployeeStats();
      populateEmployeeFilter();
    } else if (deleteTarget.type === 'product') {
      res = await fetch(`/api/admin/products/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
      toast('Prodotto eliminato', 'success');
      await loadProducts();
      renderProducts();
      populateProductFilter();
    } else {
      res = await fetch(`/api/invoices/${deleteTarget.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Errore eliminazione');
      toast('Fattura eliminata', 'success');
      await Promise.all([loadInvoices(), loadStats()]);
      renderAllInvoices(allInvoices);
      renderOverview();
    }
    closeDeleteModal();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ─── Tabs ─────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));

  if (name === 'invoices') {
    renderAllInvoices(allInvoices);
    populateEmployeeFilter();
  } else if (name === 'employees') {
    renderEmployeeStats();
  } else if (name === 'users') {
    renderUsers();
  } else if (name === 'activities') {
    renderActivities();
  } else if (name === 'products') {
    renderProducts();
  } else if (name === 'payments') {
    renderPayments();
  } else if (name === 'overview') {
    setTimeout(renderCharts, 80);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

setInterval(async () => {
  if (!currentUser) return;
  await Promise.all([loadStats(), loadInvoices(), loadUsers(), loadActivities(), loadProducts(), loadPayments()]);
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'employees') renderEmployeeStats();
  if (activeTab === 'overview') renderOverview();
  if (activeTab === 'activities') renderActivities();
  if (activeTab === 'products') renderProducts();
  if (activeTab === 'payments') renderPayments();
}, 15000);

// ─── Filters ──────────────────────────────────────────────────────
document.getElementById('btn-filter').addEventListener('click', applyFilters);
document.getElementById('btn-reset-filter').addEventListener('click', () => {
  ['f-employee','f-product','f-from','f-to'].forEach(id => {
    const el = document.getElementById(id);
    el.value = '';
  });
  renderAllInvoices(allInvoices);
});

// ─── Logout ───────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  sessionStorage.setItem('preventAutoLogin', 'true');
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ─── Products CRUD & Render ───────────────────────────────────────
function renderProducts() {
  const tbody = document.getElementById('products-body');
  if (!tbody) return;
  const list = Object.values(allProducts);
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-box"></i><p>Nessun prodotto a catalogo</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(prod => {
    let pricesStr = '–';
    if (prod.prices && typeof prod.prices === 'object') {
      pricesStr = Object.entries(prod.prices).map(([q, p]) => `${q}:${fmt$(p)}`).join(', ');
    }
    return `
      <tr>
        <td><strong>${prod.id}</strong></td>
        <td>${prod.name}</td>
        <td><span class="badge" style="background:rgba(255,255,255,0.06);color:var(--text-1);border:1px solid var(--border);">${prod.format}</span></td>
        <td style="font-size:0.85rem;color:var(--text-2);max-width:300px;word-break:break-all;">${pricesStr}</td>
        <td>
          <div style="display:flex;gap:.4rem;align-items:center;">
            <button class="btn btn-ghost btn-sm btn-icon" onclick="openProductModal('${prod.id}')" title="Modifica prodotto"><i class="fa-solid fa-pen"></i></button>
            <button class="btn btn-danger btn-sm btn-icon" onclick="openDeleteProduct('${prod.id}', '${prod.name.replace(/'/g, "\\'")}')" title="Elimina prodotto"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function openProductModal(id = null) {
  productTargetId = id;
  const prod = allProducts[id];
  document.getElementById('product-modal-title').textContent = prod ? 'Modifica prodotto' : 'Nuovo prodotto';
  document.getElementById('prod-id').value = prod?.id || '';
  document.getElementById('prod-id').disabled = prod ? true : false;
  document.getElementById('prod-name').value = prod?.name || '';
  document.getElementById('prod-format').value = prod?.format || 'N';
  
  let pricesText = '';
  if (prod && prod.prices) {
    pricesText = Object.entries(prod.prices).map(([q, p]) => `${q}:${p}`).join(', ');
  }
  document.getElementById('prod-prices').value = pricesText;
  
  togglePricesGroup(prod?.format || 'N');
  document.getElementById('modal-product').classList.remove('hidden');
  document.getElementById('prod-id').focus();
}

function closeProductModal() {
  document.getElementById('modal-product').classList.add('hidden');
  productTargetId = null;
}

function togglePricesGroup(format) {
  const group = document.getElementById('prod-prices-group');
  if (format === 'custom' || format === 'custom_qty') {
    group.style.display = 'none';
  } else {
    group.style.display = 'block';
  }
}

document.getElementById('prod-format').addEventListener('change', (e) => {
  togglePricesGroup(e.target.value);
});

document.getElementById('btn-add-product').addEventListener('click', () => openProductModal());
['product-modal-close', 'product-modal-cancel'].forEach(id => {
  document.getElementById(id).addEventListener('click', closeProductModal);
});
document.getElementById('modal-product').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeProductModal();
});

document.getElementById('product-modal-save').addEventListener('click', async () => {
  const id = document.getElementById('prod-id').value.trim().toUpperCase();
  const name = document.getElementById('prod-name').value.trim();
  const format = document.getElementById('prod-format').value;
  const pricesRaw = document.getElementById('prod-prices').value.trim();

  if (!id || !name || !format) {
    toast('Compila tutti i campi obbligatori', 'error');
    return;
  }

  let prices = null;
  if (format !== 'custom' && format !== 'custom_qty') {
    prices = {};
    if (!pricesRaw) {
      toast('Inserisci i prezzi per le quantità', 'error');
      return;
    }
    const pairs = pricesRaw.split(',');
    for (const pair of pairs) {
      const parts = pair.split(':');
      if (parts.length !== 2) {
        toast('Formato prezzi non valido. Usa qty:prezzo, qty:prezzo', 'error');
        return;
      }
      const qty = parseInt(parts[0].trim(), 10);
      const price = parseFloat(parts[1].trim());
      if (isNaN(qty) || isNaN(price) || qty <= 0 || price < 0) {
        toast('Valori quantità o prezzo non validi', 'error');
        return;
      }
      prices[qty] = price;
    }
  }

  const body = { id, name, format, prices };
  const method = productTargetId ? 'PUT' : 'POST';
  const url = productTargetId ? `/api/admin/products/${productTargetId}` : '/api/admin/products';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    toast(productTargetId ? 'Prodotto modificato' : 'Prodotto aggiunto', 'success');
    closeProductModal();
    await loadProducts();
    renderProducts();
    populateProductFilter();
  } catch (err) {
    toast(err.message, 'error');
  }
});

function openDeleteProduct(id, name) {
  deleteTarget = { id, name, type: 'product' };
  document.getElementById('delete-target-name').textContent = `il prodotto "${name}" (ID: ${id})`;
  document.getElementById('modal-confirm-delete').classList.remove('hidden');
}

window.openProductModal = openProductModal;
window.openDeleteProduct = openDeleteProduct;

// ─── Payments Render ──────────────────────────────────────────────
function renderPayments() {
  const tbody = document.getElementById('payments-body');
  if (!tbody) return;
  if (!allPayments.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-receipt"></i><p>Nessun pagamento registrato</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = allPayments.map(p => `
    <tr>
      <td><span style="color:var(--text-3);font-size:.82rem;">${fmtDT(p.paymentDate)}</span></td>
      <td><strong>${p.employeeName}</strong></td>
      <td class="price-cell text-success" style="font-weight:700;">${fmt$(p.amountPaid)}</td>
      <td class="price-cell">${fmt$(p.payableAmount)}</td>
      <td><strong>${p.payableCoupons}</strong></td>
      <td>${p.commissionPercentage}%</td>
      <td><span style="color:var(--text-2);font-size:0.8rem;">Da: ${fmtDT(p.periodFrom)}<br>A: ${fmtDT(p.periodTo)}</span></td>
    </tr>
  `).join('');
}

// ─── Start ────────────────────────────────────────────────────────
init();

'use strict';

// ─── State ───────────────────────────────────────────────────────
let currentUser  = null;
let allInvoices  = [];
let allUsers     = [];
let stats        = null;
let resetTargetId   = null;
let deleteTarget    = null; // { id, name, type: 'user'|'invoice' }
let empChart     = null;
let prodChart    = null;

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

const QTY_FMT = { A: (n)=>`${n}×${n}`, B: (n)=>`${n}`, C: (n)=>`${n}×${n}×${n}` };
const PROD_NAMES = {
  A: 'Combo cibo',
  B: 'Antistress singolo',
  C: 'Combo cibo antistress',
  D: 'Personalizzata'
};

function qtyPill(type, qty)  { return `<span class="qty-pill">${(QTY_FMT[type]??((n)=>n))(qty)}</span>`; }
function prodBadge(type)     { return `<span class="badge badge-${type}">${PROD_NAMES[type]||type}</span>`; }
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
  await Promise.all([loadStats(), loadInvoices(), loadUsers()]);
  renderOverview();
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'employees') renderEmployeeStats();
  if (activeTab === 'users') renderUsers();
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
        <td class="price-cell">${fmt$(inv.price)}</td>
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
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-inbox"></i><p>Nessuna fattura trovata</p></div></td></tr>`;
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
      <td class="price-cell">${fmt$(inv.price)}</td>
      <td class="truncate" style="max-width:120px;" title="${inv.notes||''}">${inv.notes || '<span style="opacity:.4">–</span>'}</td>
      <td>
        <button class="btn btn-danger btn-sm btn-icon" onclick="openDeleteInvoice('${inv.id}')" title="Elimina fattura">
          <i class="fa-solid fa-trash"></i>
        </button>
      </td>
    </tr>`).join('');
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
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-users"></i><p>Nessun dipendente registrato</p></div></td></tr>`;
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
      <td class="price-cell text-success">${fmt$(emp.amountDue)}</td>
      <td>${emp.todayInvoices}</td>
      <td style="color:var(--accent);font-weight:700;">${fmt$(emp.todayAmount)}</td>
      <td><span style="color:var(--text-3);font-size:.8rem;">${emp.lastActivity ? fmtDT(emp.lastActivity) : 'Mai'}</span></td>
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
      employee.amountDue = Math.round(employee.totalAmount * data.commissionPercentage) / 100;
    }
    renderEmployeeStats();
    toast('Percentuale aggiornata', 'success');
  } catch (err) {
    toast(err.message || 'Errore nel salvataggio della percentuale', 'error');
    renderEmployeeStats();
  }
}

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
  } else if (name === 'overview') {
    setTimeout(renderCharts, 80);
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

setInterval(async () => {
  if (!currentUser) return;
  await Promise.all([loadStats(), loadInvoices(), loadUsers()]);
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'employees') renderEmployeeStats();
  if (activeTab === 'overview') renderOverview();
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
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/';
});

// ─── Start ────────────────────────────────────────────────────────
init();

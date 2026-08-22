'use strict';

// ─── Redirect if already logged in ───────────────────────────────
fetch('/api/auth/me')
  .then(r => r.ok ? r.json() : null)
  .then(user => {
    if (user?.role === 'admin')    window.location.href = '/admin.html';
    else if (user?.role === 'employee') window.location.href = '/employee.html';
  })
  .catch(() => {});

// ─── Toggle password visibility ───────────────────────────────────
const pwToggle = document.getElementById('pw-toggle');
const pwInput  = document.getElementById('password');
const pwIcon   = document.getElementById('pw-icon');

pwToggle.addEventListener('click', () => {
  const show = pwInput.type === 'password';
  pwInput.type = show ? 'text' : 'password';
  pwIcon.className = show ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
});

// ─── Login form ───────────────────────────────────────────────────
const form        = document.getElementById('login-form');
const loginBtn    = document.getElementById('login-btn');
const btnText     = document.getElementById('btn-text');
const btnLoading  = document.getElementById('btn-loading');
const errorBox    = document.getElementById('login-error');
const errorMsg    = document.getElementById('login-error-msg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = pwInput.value;

  errorBox.classList.add('hidden');
  btnText.classList.add('hidden');
  btnLoading.classList.remove('hidden');
  loginBtn.disabled = true;

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Credenziali non valide');

    window.location.href = data.role === 'admin' ? '/admin.html' : '/employee.html';
  } catch (err) {
    errorMsg.textContent = err.message;
    errorBox.classList.remove('hidden');
    btnText.classList.remove('hidden');
    btnLoading.classList.add('hidden');
    loginBtn.disabled = false;
  }
});

// ─── Particle Background ──────────────────────────────────────────
const canvas = document.getElementById('particles-canvas');
const ctx    = canvas.getContext('2d');
let particles = [];
const N = 55;

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

function mkParticle() {
  return {
    x:  Math.random() * canvas.width,
    y:  Math.random() * canvas.height,
    vx: (Math.random() - 0.5) * 0.38,
    vy: (Math.random() - 0.5) * 0.38,
    r:  Math.random() * 1.8 + 0.4,
    op: Math.random() * 0.5 + 0.1,
    c:  Math.random() > 0.55 ? '0,180,216' : '72,202,228'
  };
}

function init() {
  resize();
  particles = Array.from({ length: N }, mkParticle);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ambient glow
  const g = ctx.createRadialGradient(canvas.width*.7, canvas.height*.25, 0, canvas.width*.7, canvas.height*.25, canvas.width*.55);
  g.addColorStop(0, 'rgba(0,80,160,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Connections
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx   = particles[i].x - particles[j].x;
      const dy   = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 110) {
        ctx.strokeStyle = `rgba(0,180,216,${(1 - dist/110)*0.14})`;
        ctx.lineWidth   = 0.6;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.stroke();
      }
    }
  }

  // Dots
  for (const p of particles) {
    p.x += p.vx; p.y += p.vy;
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width)  p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.c},${p.op})`;
    ctx.fill();
  }

  requestAnimationFrame(draw);
}

window.addEventListener('resize', init);
init();
draw();

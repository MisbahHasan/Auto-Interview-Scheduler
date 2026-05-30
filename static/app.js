/* ── STATE ────────────────────────────────────────────────────── */
const state = {
    page: 1,
    perPage: 10,
    search: '',
    status: '',
    debounceTimer: null,
  };
  
  /* ── HELPERS ──────────────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
    return r.json();
  };
  
  function statusBadge(s) {
    if (!s) return '<span class="badge badge-default">—</span>';
    const map = { scheduled: 'badge-scheduled', completed: 'badge-completed', cancelled: 'badge-cancelled', pending: 'badge-pending' };
    const cls = map[s.toLowerCase()] || 'badge-default';
    return `<span class="badge ${cls}">${s}</span>`;
  }
  
  function initials(name) {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  
  function fmtDate(s) {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  
  function toast(msg, isErr = false) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }
  
  /* ── NAVIGATION ───────────────────────────────────────────────── */
  const titles = {
    dashboard: ['Dashboard', 'Overview of all interview activity'],
    interviews: ['Interviews', 'Search, filter and manage all sessions'],
    schedule: ['Schedule', 'Dispatch new interviews via AI agent'],
  };
  
  function switchView(view) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const el = $(`view-${view}`);
    if (el) el.classList.add('active');
    document.querySelectorAll(`[data-view="${view}"]`).forEach(n => n.classList.add('active'));
    const [title, sub] = titles[view] || ['', ''];
    $('pageTitle').textContent = title;
    $('pageSub').textContent = sub;
    if (view === 'dashboard') loadDashboard();
    if (view === 'interviews') loadTable();
    if (view === 'schedule') updatePromptPreview();
  }
  
  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-view]');
    if (nav) { e.preventDefault(); switchView(nav.dataset.view); }
  });
  
  $('openScheduleBtn').addEventListener('click', () => switchView('schedule'));
  
  /* ── TOPBAR DATE ──────────────────────────────────────────────── */
  $('todayDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  
  /* ── DASHBOARD ────────────────────────────────────────────────── */
  const DONUT_COLORS = ['#00e5c3', '#ff6b35', '#7c6fff', '#f5c542', '#4a9eff', '#ff4f6a'];
  
  async function loadDashboard() {
    const data = await api('/api/stats');
    const recent = await api('/api/interviews?per_page=6&page=1');
  
    // Stat cards
    const statuses = data.status_summary || {};
    const completed = statuses['completed'] || statuses['Completed'] || 0;
    const cancelled = statuses['cancelled'] || statuses['Cancelled'] || 0;
    const cards = [
      { label: 'Total Interviews', value: data.total, sub: 'all time', cls: 'c0' },
      { label: 'Today', value: data.today, sub: 'scheduled today', cls: 'c1' },
      { label: 'Completed', value: completed, sub: 'finished sessions', cls: 'c2' },
      { label: 'Cancelled', value: cancelled, sub: 'dropped sessions', cls: 'c3' },
    ];
    $('statGrid').innerHTML = cards.map(c => `
      <div class="stat-card ${c.cls}">
        <div class="stat-label">${c.label}</div>
        <div class="stat-value">${c.value}</div>
        <div class="stat-sub">${c.sub}</div>
      </div>`).join('');
  
    // Donut
    renderDonut(statuses);
  
    // Recent
    const items = recent.interviews || [];
    $('recentList').innerHTML = items.length
      ? items.map(iv => `
        <div class="recent-item" onclick="openDetail(${iv.id})">
          <div class="avatar">${initials(iv.candidate)}</div>
          <div class="recent-info">
            <div class="recent-name">${iv.candidate || '—'}</div>
            <div class="recent-meta">${fmtDate(iv.scheduled_at)}</div>
          </div>
          ${statusBadge(iv.status)}
        </div>`).join('')
      : '<div class="empty">No interviews yet</div>';
  }
  
  function renderDonut(statuses) {
    const entries = Object.entries(statuses);
    if (!entries.length) { $('donutWrap').innerHTML = '<div class="empty">No data</div>'; return; }
    const total = entries.reduce((s, [, v]) => s + v, 0);
    const size = 130, cx = size / 2, cy = size / 2, r = 46, stroke = 22;
    const circ = 2 * Math.PI * r;
  
    let offset = 0;
    const segments = entries.map(([label, count], i) => {
      const pct = count / total;
      const dash = pct * circ;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="${stroke}" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" style="transform:rotate(-90deg);transform-origin:${cx}px ${cy}px" />`;
      offset += dash;
      return { seg, label, count, color: DONUT_COLORS[i % DONUT_COLORS.length] };
    });
  
    $('donutWrap').innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1a1e28" stroke-width="${stroke}" />
      ${segments.map(s => s.seg).join('')}
      <text x="${cx}" y="${cy + 1}" text-anchor="middle" dominant-baseline="middle" fill="#e8ecf0" font-family="Syne,sans-serif" font-weight="800" font-size="22">${total}</text>
      <text x="${cx}" y="${cy + 17}" text-anchor="middle" dominant-baseline="middle" fill="#7a8395" font-family="DM Mono,monospace" font-size="8">total</text>
    </svg>`;
  
    $('donutLegend').innerHTML = segments.map(s => `
      <div class="legend-item">
        <span class="legend-dot" style="background:${s.color}"></span>
        <span>${s.label}</span>
        <span class="legend-count">${s.count}</span>
      </div>`).join('');
  }
  
  /* ── INTERVIEWS TABLE ─────────────────────────────────────────── */
  async function loadTable() {
    // Populate status filter
    const statuses = await api('/api/statuses');
    const sel = $('statusFilter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All statuses</option>' +
      statuses.map(s => `<option value="${s}" ${s === cur ? 'selected' : ''}>${s}</option>`).join('');
  
    const qs = new URLSearchParams({ page: state.page, per_page: state.perPage, search: state.search, status: state.status });
    const data = await api(`/api/interviews?${qs}`);
    const rows = data.interviews || [];
  
    $('tableBody').innerHTML = rows.length
      ? rows.map(iv => `
        <tr onclick="openDetail(${iv.id})">
          <td class="mono">${iv.id}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="avatar" style="width:26px;height:26px;font-size:10px">${initials(iv.candidate)}</div>
              ${iv.candidate || '—'}
            </div>
          </td>
          <td>${iv.interviewer || '—'}</td>
          <td class="mono">${fmtDate(iv.scheduled_at)}</td>
          <td>${statusBadge(iv.status)}</td>
          <td class="meet-link">${iv.meet_link ? `<a href="${iv.meet_link}" target="_blank" onclick="event.stopPropagation()">Open ↗</a>` : '—'}</td>
          <td onclick="event.stopPropagation()">
            <button class="btn-ghost" onclick="openDetail(${iv.id})">View</button>
          </td>
        </tr>`).join('')
      : `<tr><td colspan="7"><div class="empty">No interviews found</div></td></tr>`;
  
    // Pagination
    const totalPages = Math.ceil(data.total / state.perPage);
    let pag = '';
    for (let i = 1; i <= totalPages; i++) {
      pag += `<button class="page-btn ${i === state.page ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`;
    }
    $('pagination').innerHTML = pag;
  }
  
  function goPage(n) { state.page = n; loadTable(); }
  
  $('searchInput').addEventListener('input', e => {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      state.search = e.target.value;
      state.page = 1;
      loadTable();
    }, 350);
  });
  
  $('statusFilter').addEventListener('change', e => {
    state.status = e.target.value;
    state.page = 1;
    loadTable();
  });
  
  /* ── DETAIL MODAL ─────────────────────────────────────────────── */
  async function openDetail(id) {
    const iv = await api(`/api/interviews/${id}`);
    renderModal(iv);
    $('modalOverlay').classList.add('open');
  }
  
  function renderModal(iv) {
    let rawHtml = '';
    if (iv.raw_details && typeof iv.raw_details === 'object') {
      rawHtml = `<div class="raw-block">${Object.entries(iv.raw_details).map(([k, v]) => `<div><b>${k}:</b> ${v}</div>`).join('')}</div>`;
    } else if (iv.raw_details) {
      rawHtml = `<div class="raw-block">${iv.raw_details}</div>`;
    }
  
    $('modalContent').innerHTML = `
      <h2>${iv.candidate || 'Interview #' + iv.id}</h2>
      <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value mono">#${iv.id}</span></div>
      <div class="detail-row">
        <span class="detail-label">Status</span>
        <span class="detail-value">
          <select id="editStatus" class="edit-input" style="width:auto" onchange="updateStatus(${iv.id},this.value)">
            ${['scheduled','completed','cancelled','pending'].map(s => `<option value="${s}" ${iv.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </span>
      </div>
      <div class="detail-row"><span class="detail-label">Candidate</span><span class="detail-value">${iv.candidate || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Interviewer</span><span class="detail-value">${iv.interviewer || '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Scheduled</span><span class="detail-value">${fmtDate(iv.scheduled_at)}</span></div>
      <div class="detail-row"><span class="detail-label">Meet Link</span><span class="detail-value">${iv.meet_link ? `<a href="${iv.meet_link}" target="_blank" style="color:var(--accent)">${iv.meet_link}</a>` : '—'}</span></div>
      <div class="detail-row"><span class="detail-label">Created</span><span class="detail-value">${fmtDate(iv.created_at)}</span></div>
      ${rawHtml ? `<div class="detail-row"><span class="detail-label">Raw Details</span><span class="detail-value" style="flex:1">${rawHtml}</span></div>` : ''}
      <div class="modal-actions">
        <button class="btn-danger" onclick="deleteInterview(${iv.id})">Delete</button>
        <button class="btn-ghost" onclick="closeModal()">Close</button>
      </div>
    `;
    // store current interview in modal for updates
    $('modalContent').dataset.id = iv.id;
  }
  
  async function updateStatus(id, status) {
    await api(`/api/interviews/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    toast('Status updated');
    loadDashboard();
    loadTable();
  }
  
  async function deleteInterview(id) {
    if (!confirm(`Delete interview #${id}? This cannot be undone.`)) return;
    await api(`/api/interviews/${id}`, { method: 'DELETE' });
    closeModal();
    toast('Interview deleted');
    loadDashboard();
    loadTable();
  }
  
  function closeModal() { $('modalOverlay').classList.remove('open'); }
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', e => { if (e.target === $('modalOverlay')) closeModal(); });
  
  /* ── SCHEDULE FORM ────────────────────────────────────────────── */
  function updatePromptPreview() {
    const c = $('fCandidate')?.value?.trim();
    const i = $('fInterviewer')?.value?.trim();
    const d = $('fDatetime')?.value;
    const n = $('fNotes')?.value?.trim();
    if (!c && !i && !d) {
      $('promptPreview').textContent = 'Fill in the form to preview the prompt that will be sent to your AI agent.';
      return;
    }
    let prompt = `Schedule an interview`;
    if (c) prompt += ` for ${c}`;
    if (i) prompt += ` with ${i}`;
    if (d) {
      const dt = new Date(d);
      prompt += ` on ${dt.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
    }
    prompt += '.';
    if (n) prompt += `\n\nNotes: ${n}`;
    $('promptPreview').textContent = prompt;
  }
  
  ['fCandidate', 'fInterviewer', 'fDatetime', 'fNotes'].forEach(id => {
    document.addEventListener('input', e => { if (e.target.id === id) updatePromptPreview(); });
  });
  
  $('scheduleBtn').addEventListener('click', async () => {
    const candidate = $('fCandidate').value.trim();
    const interviewer = $('fInterviewer').value.trim();
    const datetime = $('fDatetime').value;
    const notes = $('fNotes').value.trim();
  
    if (!candidate || !interviewer || !datetime) {
      $('scheduleResult').textContent = '⚠ Please fill in all required fields.';
      $('scheduleResult').className = 'err';
      return;
    }
  
    $('scheduleBtn').disabled = true;
    $('scheduleBtn').textContent = 'Dispatching…';
    $('scheduleResult').textContent = '';
  
    try {
      const res = await api('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ candidate, interviewer, datetime, notes }),
      });
      if (res.queued) {
        $('scheduleResult').textContent = '✔ ' + res.message;
        $('scheduleResult').className = 'ok';
        toast('Agent task dispatched!');
        $('fCandidate').value = '';
        $('fInterviewer').value = '';
        $('fDatetime').value = '';
        $('fNotes').value = '';
        updatePromptPreview();
      } else {
        throw new Error(res.error || 'Unknown error');
      }
    } catch (err) {
      $('scheduleResult').textContent = '✘ ' + err.message;
      $('scheduleResult').className = 'err';
    } finally {
      $('scheduleBtn').disabled = false;
      $('scheduleBtn').innerHTML = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> Dispatch to AI Agent`;
    }
  });
  
  /* ── INIT ─────────────────────────────────────────────────────── */
  switchView('dashboard');
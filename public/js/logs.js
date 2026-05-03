/**
 * Logs page — alert history with filtering and acknowledge
 * Uses Supabase JS SDK directly (no Cloud Functions needed for acknowledge)
 */

import { supabase } from './supabase-config.js';

// ── State ──────────────────────────────────────────────────────────────────────
let allAlerts = [];
const MAX_FETCH = 500;

const CATEGORY_ICON = {
  temperature: '🌡️',
  smoke:       '💨',
  overload:    '⚖️',
  stuck:       '🛗',
};

// ── Clock ──────────────────────────────────────────────────────────────────────
function tickClock() {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString();
}
tickClock();
setInterval(tickClock, 1000);

// ── Load from Supabase ─────────────────────────────────────────────────────────
async function loadAlerts() {
  setLoading();
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(MAX_FETCH);

  if (error) {
    console.error('Failed to load alerts:', error);
    document.getElementById('table-container').innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">⚠️</span>
        Failed to load alerts. Check your Supabase config and RLS policies.
        <br><small>${error.message}</small>
      </div>`;
    return;
  }

  allAlerts = data || [];
  applyFilters();
}

// Expose to global scope for onclick handlers in the HTML
window.loadAlerts = loadAlerts;

// ── Client-side filter ─────────────────────────────────────────────────────────
window.applyFilters = function () {
  const typeF = document.getElementById('filter-type').value;
  const catF  = document.getElementById('filter-category').value;
  const ackF  = document.getElementById('filter-ack').value;

  const filtered = allAlerts.filter(a => {
    if (typeF !== 'all' && a.type     !== typeF)              return false;
    if (catF  !== 'all' && a.category !== catF)               return false;
    if (ackF  !== 'all' && String(a.acknowledged) !== ackF)   return false;
    return true;
  });

  renderTable(filtered);
  updateStats(allAlerts);
};

// ── Acknowledge — direct Supabase update (no Cloud Function needed) ───────────
window.acknowledgeAlert = async function (alertId, btn) {
  btn.disabled    = true;
  btn.textContent = 'Acknowledging...';
  try {
    const { error } = await supabase
      .from('alerts')
      .update({ acknowledged: true })
      .eq('id', alertId);

    if (error) throw error;

    const alert = allAlerts.find(a => a.id === alertId);
    if (alert) alert.acknowledged = true;
    applyFilters();
  } catch (err) {
    console.error('Acknowledge failed:', err);
    btn.disabled    = false;
    btn.textContent = 'Acknowledge';
    window.alert('Failed to acknowledge: ' + err.message);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString();
}

function setLoading() {
  document.getElementById('table-container').innerHTML = `
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading alerts from Supabase...</p>
    </div>`;
}

// ── Render table ───────────────────────────────────────────────────────────────
function renderTable(alerts) {
  const countEl = document.getElementById('result-count');
  countEl.textContent = `${alerts.length} result${alerts.length !== 1 ? 's' : ''}`;

  if (alerts.length === 0) {
    document.getElementById('table-container').innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">✅</span>
        No alerts match the current filters.
      </div>`;
    return;
  }

  const rows = alerts.map(a => {
    const icon  = CATEGORY_ICON[a.category] || '⚠️';
    const time  = formatDate(a.created_at);
    const sv    = a.sensor_values || {};
    const isAck = a.acknowledged;

    const snapParts = [
      sv.temperature != null && `<span class="snap-item">🌡️ <strong>${Number(sv.temperature).toFixed(1)} °C</strong></span>`,
      sv.smoke_level != null && `<span class="snap-item">💨 <strong>${Number(sv.smoke_level).toFixed(0)}</strong></span>`,
      sv.weight      != null && `<span class="snap-item">⚖️ <strong>${Number(sv.weight).toFixed(1)} kg</strong></span>`,
      sv.distance    != null && `<span class="snap-item">📏 <strong>${Number(sv.distance).toFixed(1)} cm</strong></span>`,
    ].filter(Boolean).join('');

    const ackCell = isAck
      ? '<span style="color:#22c55e;font-weight:600;font-size:12px;">✓ Done</span>'
      : `<button class="btn-ack" onclick="acknowledgeAlert('${a.id}', this)">Acknowledge</button>`;

    return `
      <tr class="${isAck ? 'row-ack' : ''}">
        <td style="white-space:nowrap;font-size:12px;color:var(--muted);">${time}</td>
        <td><span class="badge badge-${a.type}">${(a.type || '').toUpperCase()}</span></td>
        <td>
          <span style="display:flex;align-items:center;gap:6px;">
            ${icon} <span style="text-transform:capitalize;">${a.category || '--'}</span>
          </span>
        </td>
        <td style="max-width:300px;font-size:13px;">${a.message || '--'}</td>
        <td><div class="sensor-snapshot">${snapParts || '--'}</div></td>
        <td>${ackCell}</td>
      </tr>`;
  });

  document.getElementById('table-container').innerHTML = `
    <div class="table-container">
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Category</th>
            <th>Message</th>
            <th>Sensor Values</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

// ── Update stats ───────────────────────────────────────────────────────────────
function updateStats(alerts) {
  const c = { warning: 0, danger: 0, critical: 0, unack: 0 };
  alerts.forEach(a => {
    if (a.type === 'warning')  c.warning++;
    if (a.type === 'danger')   c.danger++;
    if (a.type === 'critical') c.critical++;
    if (!a.acknowledged)       c.unack++;
  });
  document.getElementById('stat-total').textContent    = alerts.length;
  document.getElementById('stat-warning').textContent  = c.warning;
  document.getElementById('stat-danger').textContent   = c.danger;
  document.getElementById('stat-critical').textContent = c.critical;
  document.getElementById('stat-unack').textContent    = c.unack;
}

// ── Realtime: update stats when a new alert arrives ───────────────────────────
supabase
  .channel('logs-alerts-channel')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, () => {
    loadAlerts();
  })
  .subscribe();

// ── Boot ───────────────────────────────────────────────────────────────────────
loadAlerts();

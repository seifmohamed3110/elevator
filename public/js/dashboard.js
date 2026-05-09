/**
 * Dashboard — real-time sensor monitoring via Supabase
 * sensor_readings table → sensor cards, chart, elevator visual
 * alerts table          → recent alerts panel
 */

import { supabase } from './supabase-config.js';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_CHART_POINTS = 50;

const STATUS_CONFIG = {
  normal:   { icon: '✅', title: 'SYSTEM NORMAL',   desc: 'All sensors reading within safe thresholds',           cls: 'status-normal',   badgeCls: 'badge-normal'   },
  warning:  { icon: '⚠️',  title: 'WARNING',          desc: 'Elevated sensor reading detected — monitor closely',   cls: 'status-warning',  badgeCls: 'badge-warning'  },
  danger:   { icon: '🔥', title: 'DANGER',           desc: 'Hazardous condition detected — take immediate action',  cls: 'status-danger',   badgeCls: 'badge-danger'   },
  critical: { icon: '🚨', title: 'CRITICAL ALERT',   desc: 'Emergency! Immediate response required',               cls: 'status-critical', badgeCls: 'badge-critical' },
};

const CATEGORY_ICON = {
  temperature: '🌡️',
  smoke:       '💨',
  overload:    '⚖️',
  stuck:       '🛗',
};

// Elevator car bottom positions (px) for each floor (shaft height ~260px, car 70px)
const FLOOR_BOTTOM_PX = { 0: 8, 1: 101, 2: 194 };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const el = {
  clock:         document.getElementById('clock'),
  headerBadge:   document.getElementById('header-status-badge'),
  tempValue:     document.getElementById('temp-value'),
  tempSub:       document.getElementById('temp-sub'),
  smokeValue:    document.getElementById('smoke-value'),
  smokeSub:      document.getElementById('smoke-sub'),
  weightValue:   document.getElementById('weight-value'),
  weightSub:     document.getElementById('weight-sub'),
  distValue:     document.getElementById('distance-value'),
  floorDisplay:  document.getElementById('floor-display'),
  statusBanner:  document.getElementById('status-banner'),
  statusIcon:    document.getElementById('status-icon'),
  statusTitle:   document.getElementById('status-title'),
  statusDesc:    document.getElementById('status-desc'),
  lastUpdated:   document.getElementById('last-updated'),
  elevCar:       document.getElementById('elevator-car'),
  elevStatusSub: document.getElementById('elev-status-sub'),
  floorLabel:    document.getElementById('floor-label'),
  movingStatus:  document.getElementById('moving-status'),
  elevDist:      document.getElementById('elev-dist'),
  recentAlerts:  document.getElementById('recent-alerts'),
  connBanner:    document.getElementById('conn-banner'),
};

// ── Chart ─────────────────────────────────────────────────────────────────────
let chart = null;

function initChart() {
  const ctx = document.getElementById('sensor-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Temperature (°C)',
          data: [],
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239,68,68,0.08)',
          fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
          yAxisID: 'y',
        },
        {
          label: 'Smoke Level',
          data: [],
          borderColor: '#f97316',
          backgroundColor: 'rgba(249,115,22,0.08)',
          fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'top', labels: { font: { size: 12 }, usePointStyle: true } } },
      scales: {
        x:  { grid: { color: '#f1f5f9' }, ticks: { color: '#64748b', maxTicksLimit: 8, font: { size: 11 } } },
        y:  { type: 'linear', position: 'left',  grid: { color: '#f1f5f9' }, ticks: { color: '#ef4444', font: { size: 11 }, callback: v => v + '°C' } },
        y1: { type: 'linear', position: 'right', grid: { drawOnChartArea: false }, ticks: { color: '#f97316', font: { size: 11 } } },
      },
    },
  });
}

function pushChartPoint(row) {
  if (!chart) return;
  const label = new Date(row.created_at).toLocaleTimeString();
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(row.temperature ?? null);
  chart.data.datasets[1].data.push(row.smoke_level ?? null);
  if (chart.data.labels.length > MAX_CHART_POINTS) {
    chart.data.labels.shift();
    chart.data.datasets.forEach(ds => ds.data.shift());
  }
  chart.update('none');
}

// ── Sensor card helpers ───────────────────────────────────────────────────────
const tempClass   = t => t == null ? 'card-normal' : t > 32 ? 'card-danger'   : t > 28  ? 'card-warning'  : 'card-normal';
const smokeClass  = s => s == null ? 'card-normal' : s > 400 ? 'card-critical' : s > 300  ? 'card-danger'   : 'card-normal';
const weightClass = w => w == null ? 'card-normal' : w > 150 ? 'card-critical' : w > 130  ? 'card-warning'  : 'card-normal';

function setCardClass(id, cls) {
  const card = document.getElementById(id);
  if (card) card.className = `sensor-card ${cls}`;
}

function floorName(floor) {
  if (floor == null || floor === -1) return 'Between Floors ⚠️';
  return floor === 0 ? 'Ground Floor' : `Floor ${floor}`;
}

// ── Update sensor cards ───────────────────────────────────────────────────────
function updateSensorCards(row) {
  const { temperature: t, smoke_level: s, weight: w, distance: d, floor } = row;

  el.tempValue.textContent   = t != null ? t.toFixed(1)  : '--';
  el.smokeValue.textContent  = s != null ? (s > 0 ? 'DETECTED' : 'CLEAR') : '--';
  el.weightValue.textContent = w != null ? w.toFixed(1)  : '--';
  el.distValue.textContent   = d != null ? d.toFixed(1)  : '--';

  if (t != null) el.tempSub.textContent   = t > 32 ? '⚠️ Critically high' : t > 28 ? '⚠️ Elevated' : 'Safe range';
  if (s != null) el.smokeSub.textContent  = s > 0 ? '⚠️ Gas detected' : 'No gas';
  if (w != null) el.weightSub.textContent = w > 150 ? '⚠️ Overloaded!'   : `${Math.round((w / 150) * 100)}% capacity`;
  el.floorDisplay.textContent = `Floor: ${floorName(floor)}`;

  setCardClass('temp-card',     tempClass(t));
  setCardClass('smoke-card',    smokeClass(s));
  setCardClass('weight-card',   weightClass(w));
  setCardClass('distance-card', 'card-normal');

  el.lastUpdated.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
}

// ── Status banner ──────────────────────────────────────────────────────────────
function updateStatusBanner(status) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.normal;
  el.statusBanner.className      = `status-banner ${cfg.cls}`;
  el.statusIcon.textContent      = cfg.icon;
  el.statusTitle.textContent     = cfg.title;
  el.statusDesc.textContent      = cfg.desc;
  el.headerBadge.textContent     = status.charAt(0).toUpperCase() + status.slice(1);
  el.headerBadge.className       = `status-badge ${cfg.badgeCls}`;
}

// ── Elevator visual ───────────────────────────────────────────────────────────
function updateElevatorVisual(row) {
  const { floor = -1, distance: dist, is_moving: moving, status = 'normal' } = row;

  let bottomPx = FLOOR_BOTTOM_PX[floor];
  if (bottomPx === undefined) {
    const maxDist = 230;
    const safeD   = Math.max(0, Math.min(maxDist, dist || 0));
    const shaftH  = el.elevCar.parentElement.offsetHeight || 260;
    bottomPx = Math.round((safeD / maxDist) * (shaftH - 86)) + 8;
  }
  el.elevCar.style.bottom = `${bottomPx}px`;
  el.elevCar.className    = `elevator-car car-${status === 'critical' ? 'critical' : status === 'danger' ? 'danger' : status === 'warning' ? 'warning' : 'normal'}`;

  el.floorLabel.textContent    = floorName(floor);
  el.movingStatus.textContent  = moving ? '🔼 Moving' : '⏸ Stationary';
  el.elevDist.textContent      = dist  != null ? `${dist.toFixed(1)} cm` : '-- cm';
  el.elevStatusSub.textContent = moving ? 'In Motion' : floor === -1 ? 'Between Floors' : 'At Floor';
}

// ── Recent alerts ─────────────────────────────────────────────────────────────
function renderAlertItem(alert) {
  const icon = CATEGORY_ICON[alert.category] || '⚠️';
  const time = new Date(alert.created_at).toLocaleString();
  const ack  = alert.acknowledged ? '<span class="alert-ack-tag">✓ Acknowledged</span>' : '';
  return `
    <div class="alert-item alert-item-${alert.type}">
      <div class="alert-item-icon">${icon}</div>
      <div class="alert-item-body">
        <div class="alert-item-header">
          <span class="badge badge-${alert.type}">${alert.type.toUpperCase()}</span>
          <span class="alert-category">${alert.category || ''}</span>
        </div>
        <div class="alert-item-message">${alert.message || ''}</div>
        <div class="alert-item-time">${time}</div>
      </div>
      ${ack}
    </div>`;
}

function renderRecentAlerts(rows) {
  if (!rows || rows.length === 0) {
    el.recentAlerts.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-icon">✅</span>
        No alerts recorded yet — the elevator is operating normally.
      </div>`;
    return;
  }
  el.recentAlerts.innerHTML = `<div class="alerts-list">${rows.map(renderAlertItem).join('')}</div>`;
}

// ── Connection banner ──────────────────────────────────────────────────────────
let connTimer = null;
function showConnected() {
  el.connBanner.textContent = '✅ Connected to Supabase — receiving live data';
  el.connBanner.className   = 'connection-banner conn-connected';
  clearTimeout(connTimer);
  connTimer = setTimeout(() => { el.connBanner.className = 'connection-banner conn-hidden'; }, 2500);
}
function showDisconnected() {
  el.connBanner.textContent = '⚡ Connecting to Supabase...';
  el.connBanner.className   = 'connection-banner conn-disconnected';
}

// ── Clock ──────────────────────────────────────────────────────────────────────
function tickClock() { el.clock.textContent = new Date().toLocaleTimeString(); }

// ── Seed chart from recent history ────────────────────────────────────────────
async function seedChart() {
  const { data, error } = await supabase
    .from('sensor_readings')
    .select('temperature, smoke_level, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_CHART_POINTS);

  if (error || !data) { console.warn('Chart seed error:', error); return; }

  const rows = [...data].reverse();
  rows.forEach(row => {
    chart.data.labels.push(new Date(row.created_at).toLocaleTimeString());
    chart.data.datasets[0].data.push(row.temperature ?? null);
    chart.data.datasets[1].data.push(row.smoke_level ?? null);
  });
  chart.update();
}

// ── Load initial recent alerts from Supabase ──────────────────────────────────
async function loadInitialAlerts() {
  const { data } = await supabase
    .from('alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);
  renderRecentAlerts(data || []);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  tickClock();
  setInterval(tickClock, 1000);
  initChart();
  showDisconnected();

  await Promise.all([seedChart(), loadInitialAlerts()]);

  // ── Realtime: new sensor readings ─────────────────────────────────────────
  supabase
    .channel('sensor-readings-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'sensor_readings' },
      (payload) => {
        showConnected();
        const row = payload.new;
        updateSensorCards(row);
        updateElevatorVisual(row);
        updateStatusBanner(row.status || 'normal');
        pushChartPoint(row);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') showConnected();
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR') showDisconnected();
    });

  // ── Realtime: new alerts ──────────────────────────────────────────────────
  supabase
    .channel('alerts-channel')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'alerts' },
      () => loadInitialAlerts()  // reload the 5 most recent
    )
    .subscribe();
}

init().catch(console.error);

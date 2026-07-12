// === GPS PAGE JS ===

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────
  const TILE_URL   = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
  const TILE_ATTR  = '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
  const REFRESH_INTERVAL = 30;          // seconds
  const TEAL       = '#00d4ff';
  const TEAL_DIM   = 'rgba(0, 212, 255, 0.35)';
  const PATH_COLOR = '#00d4ff';

  // ─── State ────────────────────────────────────────────────────────────
  let gpsMap         = null;
  let gpsLayers      = { circles: [], polyline: null, marker: null };
  let gpsRawData     = [];
  let gpsFilter      = 'today';
  let gpsAutoTimer   = null;
  let gpsCountdown   = REFRESH_INTERVAL;
  let gpsCountdownId = null;
  let gpsIsLoading   = false;

  // ─── DOM refs (resolved lazily on first use) ──────────────────────────
  function el(id) { return document.getElementById(id); }

  // ─── Init ─────────────────────────────────────────────────────────────
  function initGpsPage() {
    if (gpsMap) return;   // already initialised

    // Build map
    gpsMap = L.map('gps-map', {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
    }).setView([41.9, 12.5], 6);

    L.tileLayer(TILE_URL, {
      attribution: TILE_ATTR,
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(gpsMap);

    // Bind UI events
    document.querySelectorAll('.gps-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.gps-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gpsFilter = btn.dataset.filter;
        renderGpsData(filterLocations(gpsRawData, gpsFilter));
      });
    });

    el('gps-btn-refresh').addEventListener('click', loadGpsData);
    el('gps-btn-center').addEventListener('click', centerMap);

    // First load
    loadGpsData();
  }

  // ─── Data Loading ─────────────────────────────────────────────────────
  async function loadGpsData() {
    const deviceId = (typeof currentDevice !== 'undefined' && currentDevice)
      ? currentDevice
      : null;

    if (!deviceId) {
      showEmpty('Seleziona un dispositivo per visualizzare la mappa GPS');
      hideLoading();
      return;
    }

    const token  = (typeof TOKEN    !== 'undefined') ? TOKEN    : '';
    const apiUrl = (typeof API_URL  !== 'undefined') ? API_URL  : '';
    const url    = `${apiUrl}/api/locations/${encodeURIComponent(deviceId)}`;

    setLoading(true);
    stopAutoRefresh();
    spinRefreshIcon(true);

    try {
      const resp = await fetch(url, {
        headers: {
          'x-token': token,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();

      // Normalise: accept [{lat,lng,ts,accuracy}] or [{latitude,longitude,...}]
      gpsRawData = normaliseLocations(Array.isArray(data) ? data : (data.locations || []));

      if (gpsRawData.length === 0) {
        showEmpty('Nessun dato GPS per questo dispositivo');
        updateStats([], false);
        return;
      }

      hideEmpty();
      const filtered = filterLocations(gpsRawData, gpsFilter);
      renderGpsData(filtered);
      updateStats(filtered, true);
      updateStatusBadge(true);
      startAutoRefresh();

    } catch (err) {
      console.error('[GPS] Fetch error:', err);
      showEmpty(`Errore nel caricamento: ${err.message}`);
      updateStatusBadge(false);
    } finally {
      setLoading(false);
      spinRefreshIcon(false);
    }
  }

  // ─── Normalise API response ────────────────────────────────────────────
  function normaliseLocations(arr) {
    return arr
      .map(p => ({
        lat:      parseFloat(p.lat      ?? p.latitude  ?? 0),
        lng:      parseFloat(p.lng      ?? p.longitude ?? 0),
        ts:       p.ts ?? p.timestamp ?? p.createdAt ?? null,
        accuracy: p.accuracy ?? p.acc ?? null,
      }))
      .filter(p => p.lat !== 0 || p.lng !== 0)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts));  // oldest first
  }

  // ─── Filter ───────────────────────────────────────────────────────────
  function filterLocations(data, filter) {
    if (filter === 'all') return data;

    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const cutoff = filter === 'today'
      ? today
      : new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);  // 7 days incl. today

    return data.filter(p => {
      if (!p.ts) return false;
      const d = new Date(p.ts);
      return d >= cutoff;
    });
  }

  // ─── Render on map ────────────────────────────────────────────────────
  function renderGpsData(locations) {
    clearMapLayers();

    if (!locations || locations.length === 0) {
      showEmpty('Nessun punto GPS nel periodo selezionato');
      return;
    }

    hideEmpty();

    const latLngs = locations.map(p => [p.lat, p.lng]);

    // 1. Route polyline
    gpsLayers.polyline = L.polyline(latLngs, {
      color:  PATH_COLOR,
      weight: 2.5,
      opacity: 0.55,
      dashArray: '6,4',
    }).addTo(gpsMap);

    // 2. Teal circles for each point
    locations.forEach((p, i) => {
      const isLast = (i === locations.length - 1);
      const circle = L.circleMarker([p.lat, p.lng], {
        radius:      isLast ? 0 : 5,    // last pos gets marker instead
        fillColor:   TEAL,
        fillOpacity: 0.55,
        color:       TEAL,
        weight:      1.2,
        opacity:     0.8,
      });

      if (!isLast) {
        circle.bindPopup(buildPopupHtml(p), { maxWidth: 220 });
        circle.addTo(gpsMap);
        gpsLayers.circles.push(circle);
      }
    });

    // 3. Last position marker with pulsing ring
    const last = locations[locations.length - 1];
    const markerIcon = buildLastMarkerIcon();

    gpsLayers.marker = L.marker([last.lat, last.lng], { icon: markerIcon })
      .bindPopup(buildPopupHtml(last, true), { maxWidth: 240 })
      .addTo(gpsMap);

    gpsLayers.marker.openPopup();
  }

  // ─── Build popup HTML ─────────────────────────────────────────────────
  function buildPopupHtml(p, isLast = false) {
    const dateStr = p.ts ? formatDateTime(new Date(p.ts)) : '—';
    const accStr  = p.accuracy != null ? `${Math.round(p.accuracy)} m` : '—';
    const coordStr = `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

    return `
      <div>
        <div class="gps-popup-title">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${TEAL}" stroke-width="2.5">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
          ${isLast ? 'Ultima posizione' : 'Posizione'}
        </div>
        <div class="gps-popup-row">
          <span>Data</span>
          <span>${dateStr}</span>
        </div>
        <div class="gps-popup-row">
          <span>Accuratezza</span>
          <span>${accStr}</span>
        </div>
        <div class="gps-popup-coords">${coordStr}</div>
      </div>`;
  }

  // ─── Last position custom marker icon ────────────────────────────────
  function buildLastMarkerIcon() {
    const html = `
      <div style="position:relative;width:22px;height:22px;">
        <div style="
          position:absolute;inset:-6px;
          border:2px solid rgba(0,212,255,0.4);
          border-radius:50%;
          animation:gpsRipple 1.8s ease-out infinite;
        "></div>
        <div style="
          position:absolute;inset:0;
          background:#00d4ff;
          border-radius:50%;
          border:2.5px solid #0a0e1a;
          box-shadow:0 0 10px rgba(0,212,255,0.8);
        "></div>
      </div>`;

    // Inject keyframe if not already present
    if (!document.getElementById('gps-ripple-style')) {
      const s = document.createElement('style');
      s.id = 'gps-ripple-style';
      s.textContent = `@keyframes gpsRipple {
        0%   { transform:scale(1);   opacity:0.8; }
        100% { transform:scale(2.4); opacity:0; }
      }`;
      document.head.appendChild(s);
    }

    return L.divIcon({
      html,
      className: '',
      iconSize:  [22, 22],
      iconAnchor:[11, 11],
      popupAnchor:[0, -14],
    });
  }

  // ─── Clear layers ─────────────────────────────────────────────────────
  function clearMapLayers() {
    if (!gpsMap) return;
    gpsLayers.circles.forEach(c => gpsMap.removeLayer(c));
    gpsLayers.circles = [];
    if (gpsLayers.polyline) { gpsMap.removeLayer(gpsLayers.polyline); gpsLayers.polyline = null; }
    if (gpsLayers.marker)   { gpsMap.removeLayer(gpsLayers.marker);   gpsLayers.marker   = null; }
  }

  // ─── Center map ───────────────────────────────────────────────────────
  function centerMap() {
    if (!gpsMap) return;
    const filtered = filterLocations(gpsRawData, gpsFilter);
    if (filtered.length === 0) return;

    if (gpsLayers.polyline) {
      gpsMap.fitBounds(gpsLayers.polyline.getBounds(), { padding: [40, 40] });
    } else if (gpsLayers.marker) {
      const pos = gpsLayers.marker.getLatLng();
      gpsMap.setView(pos, 15);
    }
  }

  // ─── Stats Bar ────────────────────────────────────────────────────────
  function updateStats(locations, online) {
    el('gps-stat-points').textContent = locations.length || '—';

    if (locations.length > 0) {
      const last = locations[locations.length - 1];
      el('gps-stat-last').textContent     = last.ts ? formatDateTime(new Date(last.ts)) : '—';
      el('gps-stat-accuracy').textContent = last.accuracy != null ? `${Math.round(last.accuracy)} m` : '—';
    } else {
      el('gps-stat-last').textContent     = '—';
      el('gps-stat-accuracy').textContent = '—';
    }

    el('gps-stat-refresh').textContent = online ? '30 s' : 'Offline';
  }

  // ─── Status Badge ─────────────────────────────────────────────────────
  function updateStatusBadge(online) {
    const badge = el('gps-status-badge');
    badge.textContent = online ? 'Online' : 'Offline';
    badge.className   = `gps-status-badge ${online ? 'online' : 'offline'}`;
  }

  // ─── Auto Refresh ─────────────────────────────────────────────────────
  function startAutoRefresh() {
    stopAutoRefresh();

    const wrap = el('gps-refresh-bar-wrap');
    wrap.style.display = 'block';
    gpsCountdown = REFRESH_INTERVAL;
    updateCountdownUI();

    gpsCountdownId = setInterval(() => {
      gpsCountdown--;
      updateCountdownUI();
      if (gpsCountdown <= 0) {
        loadGpsData();
      }
    }, 1000);
  }

  function stopAutoRefresh() {
    if (gpsCountdownId) {
      clearInterval(gpsCountdownId);
      gpsCountdownId = null;
    }
    const wrap = el('gps-refresh-bar-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  function updateCountdownUI() {
    const cd  = el('gps-countdown');
    const bar = el('gps-refresh-progress');
    if (!cd || !bar) return;

    cd.textContent = Math.max(0, gpsCountdown);
    const pct = ((REFRESH_INTERVAL - gpsCountdown) / REFRESH_INTERVAL) * 100;
    bar.style.width = `${pct}%`;
  }

  // ─── Loading helpers ──────────────────────────────────────────────────
  function setLoading(state) {
    gpsIsLoading = state;
    const overlay = el('gps-loading');
    if (overlay) overlay.style.display = state ? 'flex' : 'none';
    const btn = el('gps-btn-refresh');
    if (btn) btn.disabled = state;
  }

  function hideLoading() { setLoading(false); }

  function showEmpty(msg) {
    const overlay = el('gps-empty');
    const msgEl   = el('gps-empty-msg');
    if (overlay) overlay.style.display = 'flex';
    if (msgEl && msg) msgEl.textContent = msg;
  }

  function hideEmpty() {
    const overlay = el('gps-empty');
    if (overlay) overlay.style.display = 'none';
  }

  function spinRefreshIcon(spin) {
    const icon = el('gps-refresh-icon');
    if (!icon) return;
    icon.classList.toggle('gps-refresh-icon-spinning', spin);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  function formatDateTime(d) {
    if (!(d instanceof Date) || isNaN(d)) return '—';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} `
         + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // ─── Page lifecycle hooks ─────────────────────────────────────────────
  // Call initGpsPage() when this page tab is activated.
  // Call destroyGpsPage() when navigating away to free resources.

  function destroyGpsPage() {
    stopAutoRefresh();
    if (gpsMap) {
      gpsMap.remove();
      gpsMap = null;
    }
    gpsRawData = [];
    clearMapLayers();
  }

  // ─── Public API ───────────────────────────────────────────────────────
  window.GpsPage = {
    init:    initGpsPage,
    destroy: destroyGpsPage,
    reload:  loadGpsData,
    center:  centerMap,
  };

  // Auto-init if the GPS section is already visible on load
  document.addEventListener('DOMContentLoaded', () => {
    const section = el('gps-page');
    if (section && getComputedStyle(section).display !== 'none') {
      initGpsPage();
    }
  });

})();

// === END GPS PAGE JS ===

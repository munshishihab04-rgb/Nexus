// === SMS PAGE JS ===

(function () {
  'use strict';

  // ── Stato interno ──────────────────────────────────────────────
  const _smsState = {
    tab: 'sms',            // 'sms' | 'calls' | 'contacts'
    smsRaw: [],            // dati grezzi API
    callsRaw: [],
    contactsRaw: [],
    smsFiltered: [],
    callsFiltered: [],
    contactsFiltered: [],
    smsCurPage: 1,
    callsCurPage: 1,
    contactsCurPage: 1,
    PAGE_SIZE: 50,
    expandedRow: null,     // id riga espansa corrente
  };

  // ── SVG helpers ───────────────────────────────────────────────
  const SVG = {
    phoneIn:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.14 6.14l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="17 1 21 5 17 9"/><line x1="21" y1="5" x2="9" y2="5"/></svg>',
    phoneOut:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.14 6.14l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/><polyline points="17 9 21 5 17 1"/><line x1="21" y1="5" x2="9" y2="5"/></svg>',
    phoneMissed:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="23" y1="1" x2="17" y2="7"/><line x1="17" y1="1" x2="23" y2="7"/><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.14 6.14l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    smsIn:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="8 10 12 14 16 10"/></svg>',
    smsOut:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="8 14 12 10 16 14"/></svg>',
    contact:
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>',
  };

  // ── Utility ───────────────────────────────────────────────────

  /**
   * Formatta timestamp in stringa localizzata italiana.
   * @param {number|string} ts - epoch ms o stringa ISO
   */
  function _fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts);
    if (isNaN(d)) return String(ts);
    return d.toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /**
   * Formatta durata (secondi) in mm:ss o hh:mm:ss
   */
  function _fmtDuration(sec) {
    if (!sec && sec !== 0) return '—';
    const s = Math.round(Number(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  }

  /** Tronca testo a N caratteri */
  function _trunc(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }

  /** Ritorna classe/SVG in base al tipo chiamata */
  function _callTypeInfo(type) {
    const t = (type || '').toLowerCase();
    if (t === 'in'     || t === 'incoming' || t === '1')
      return { cls: 'type-in',     svg: SVG.phoneIn,     label: 'Entrata' };
    if (t === 'out'    || t === 'outgoing'  || t === '2')
      return { cls: 'type-out',    svg: SVG.phoneOut,    label: 'Uscita' };
    if (t === 'missed' || t === '3')
      return { cls: 'type-missed', svg: SVG.phoneMissed, label: 'Persa' };
    return   { cls: 'type-out',    svg: SVG.phoneOut,    label: type || '—' };
  }

  /** Ritorna classe/SVG in base al tipo SMS */
  function _smsTypeInfo(type) {
    const t = (type || '').toLowerCase();
    if (t === 'out' || t === 'outgoing' || t === 'sent' || t === '2')
      return { cls: 'type-out', svg: SVG.smsOut, label: 'Inviato' };
    return   { cls: 'type-in',  svg: SVG.smsIn,  label: 'Ricevuto' };
  }

  /** Normalizza tipo per filtro */
  function _normalizeType(raw) {
    const t = (raw || '').toLowerCase();
    if (t === 'in' || t === 'incoming' || t === '1' || t === 'received') return 'in';
    if (t === 'out' || t === 'outgoing' || t === '2' || t === 'sent')    return 'out';
    if (t === 'missed' || t === '3')                                      return 'missed';
    return 'out';
  }

  /** Estrae epoch ms da un record */
  function _toMs(ts) {
    if (!ts) return 0;
    const n = Number(ts);
    if (!isNaN(n)) return n < 1e12 ? n * 1000 : n;
    return new Date(ts).getTime() || 0;
  }

  /** Mostra/nasconde loader */
  function _setLoader(visible) {
    const el = document.getElementById('smsLoader');
    if (el) el.style.display = visible ? 'flex' : 'none';
  }

  /** Esegue fetch con x-token header */
  async function _apiFetch(path) {
    const url = (typeof API_URL !== 'undefined' ? API_URL : '') + path;
    const token = typeof TOKEN !== 'undefined' ? TOKEN : '';
    const res = await fetch(url, { headers: { 'x-token': token } });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    return res.json();
  }

  // ── Aggiorna badge contatori ──────────────────────────────────
  function _updateBadges(data, mode) {
    let total = 0, inCount = 0, outCount = 0, missedCount = 0;
    data.forEach(item => {
      total++;
      const t = _normalizeType(item.type || item.callType || item.msgType || '');
      if (t === 'in')     inCount++;
      else if (t === 'out')    outCount++;
      else if (t === 'missed') missedCount++;
      else outCount++;
    });
    document.getElementById('cnt-total').textContent  = total;
    document.getElementById('cnt-in').textContent     = inCount;
    document.getElementById('cnt-out').textContent    = outCount;
    document.getElementById('cnt-missed').textContent = missedCount;

    // Nascondi badge "persi" per SMS (non applicabile)
    const missedBadge = document.getElementById('badge-missed');
    if (missedBadge) missedBadge.style.display = mode === 'sms' ? 'none' : '';
  }

  // ── Filtro attivo ─────────────────────────────────────────────
  function _getFilters() {
    return {
      search:   (document.getElementById('smsSearchInput')?.value || '').trim().toLowerCase(),
      type:     document.getElementById('smsTypeFilter')?.value || 'all',
      dateFrom: document.getElementById('smsDateFrom')?.value || '',
      dateTo:   document.getElementById('smsDateTo')?.value || '',
    };
  }

  function _applyFilters(data) {
    const f = _getFilters();
    return data.filter(item => {
      // Search
      if (f.search) {
        const name   = (item.name   || item.contactName || '').toLowerCase();
        const number = (item.number || item.phone || item.address || '').toLowerCase();
        const body   = (item.body   || item.text  || item.message || '').toLowerCase();
        if (!name.includes(f.search) && !number.includes(f.search) && !body.includes(f.search))
          return false;
      }
      // Type
      if (f.type !== 'all') {
        const t = _normalizeType(item.type || item.callType || item.msgType || '');
        if (t !== f.type) return false;
      }
      // Date from
      if (f.dateFrom) {
        const ms = _toMs(item.date || item.timestamp || item.time || 0);
        if (ms && ms < new Date(f.dateFrom).getTime()) return false;
      }
      // Date to
      if (f.dateTo) {
        const ms = _toMs(item.date || item.timestamp || item.time || 0);
        const end = new Date(f.dateTo);
        end.setHours(23, 59, 59, 999);
        if (ms && ms > end.getTime()) return false;
      }
      return true;
    });
  }

  // ── Paginazione ───────────────────────────────────────────────
  function _renderPagination(containerId, total, currentPage, onPageClick) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const pages = Math.ceil(total / _smsState.PAGE_SIZE);
    if (pages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    // Prev
    html += `<button class="pg-btn" ${currentPage === 1 ? 'disabled' : ''} onclick="${onPageClick}(${currentPage - 1})">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
    </button>`;

    // Pages
    const delta = 2;
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || (i >= currentPage - delta && i <= currentPage + delta)) {
        html += `<button class="pg-btn${i === currentPage ? ' active' : ''}" onclick="${onPageClick}(${i})">${i}</button>`;
      } else if (i === currentPage - delta - 1 || i === currentPage + delta + 1) {
        html += `<span class="pg-info">…</span>`;
      }
    }

    // Next
    html += `<button class="pg-btn" ${currentPage === pages ? 'disabled' : ''} onclick="${onPageClick}(${currentPage + 1})">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </button>`;

    html += `<span class="pg-info">${(currentPage - 1) * _smsState.PAGE_SIZE + 1}–${Math.min(currentPage * _smsState.PAGE_SIZE, total)} di ${total}</span>`;
    container.innerHTML = html;
  }

  function _getPageSlice(arr, page) {
    const start = (page - 1) * _smsState.PAGE_SIZE;
    return arr.slice(start, start + _smsState.PAGE_SIZE);
  }

  // ── Collapse riga espansa ─────────────────────────────────────
  function _collapseExpanded() {
    if (_smsState.expandedRow !== null) {
      const dr = document.getElementById('detail-' + _smsState.expandedRow);
      if (dr) dr.remove();
      const mr = document.getElementById('row-' + _smsState.expandedRow);
      if (mr) mr.classList.remove('expanded');
      _smsState.expandedRow = null;
    }
  }

  // ── Toggle dettaglio riga ─────────────────────────────────────
  function _toggleDetail(rowId, buildDetailFn) {
    if (_smsState.expandedRow === rowId) {
      _collapseExpanded();
      return;
    }
    _collapseExpanded();
    _smsState.expandedRow = rowId;
    const row = document.getElementById('row-' + rowId);
    if (!row) return;
    row.classList.add('expanded');
    const detailTr = document.createElement('tr');
    detailTr.className = 'sms-detail-row';
    detailTr.id = 'detail-' + rowId;
    const td = document.createElement('td');
    td.colSpan = 4;
    td.innerHTML = buildDetailFn();
    detailTr.appendChild(td);
    row.insertAdjacentElement('afterend', detailTr);
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER SMS
  // ─────────────────────────────────────────────────────────────
  function _renderSmsTable(page) {
    _smsState.smsCurPage = page;
    const tbody = document.getElementById('smsTableBody');
    if (!tbody) return;
    const filtered = _smsState.smsFiltered;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr class="sms-empty-row"><td colspan="4">
        <div class="sms-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2a3550" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p>Nessun SMS corrisponde ai filtri</p>
        </div></td></tr>`;
      document.getElementById('smsPagination').innerHTML = '';
      return;
    }

    const slice = _getPageSlice(filtered, page);
    let rows = '';
    slice.forEach((item, idx) => {
      const rowId = 'sms-' + ((page - 1) * _smsState.PAGE_SIZE + idx);
      const typeInfo = _smsTypeInfo(item.type || item.msgType || '');
      const name   = item.name   || item.contactName || '';
      const number = item.number || item.phone || item.address || '';
      const body   = item.body   || item.text  || item.message || '';
      const dateTs = item.date   || item.timestamp || item.time || '';

      rows += `<tr class="sms-row" id="row-${rowId}" onclick="_smsToggleRow('${rowId}', ${JSON.stringify(item).replace(/'/g, "&#39;")})">
        <td class="cell-date">${_fmtDate(dateTs)}</td>
        <td class="cell-type">
          <span class="type-icon-wrap ${typeInfo.cls}" title="${typeInfo.label}">${typeInfo.svg}</span>
        </td>
        <td class="cell-contact">
          ${name ? `<span class="contact-name">${_escHtml(name)}</span>` : ''}
          <span class="contact-number">${_escHtml(number)}</span>
        </td>
        <td class="cell-preview"><span class="preview-text">${_escHtml(_trunc(body, 80))}</span></td>
      </tr>`;
    });

    tbody.innerHTML = rows;
    _renderPagination('smsPagination', filtered.length, page, '_smsGoPage');
  }

  // Callback paginazione SMS (globale)
  window._smsGoPage = function (page) {
    _collapseExpanded();
    _renderSmsTable(page);
  };

  // Toggle dettaglio SMS (globale)
  window._smsToggleRow = function (rowId, item) {
    _toggleDetail(rowId, () => {
      const typeInfo = _smsTypeInfo(item.type || item.msgType || '');
      const name   = item.name   || item.contactName || '';
      const number = item.number || item.phone || item.address || '';
      const body   = item.body   || item.text  || item.message || '';
      const dateTs = item.date   || item.timestamp || item.time || '';
      return `<div class="sms-detail-inner">
        <div class="detail-item">
          <span class="detail-label">Data</span>
          <span class="detail-value">${_fmtDate(dateTs)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Tipo</span>
          <span class="detail-value">${typeInfo.label}</span>
        </div>
        ${name ? `<div class="detail-item">
          <span class="detail-label">Contatto</span>
          <span class="detail-value">${_escHtml(name)}</span>
        </div>` : ''}
        <div class="detail-item">
          <span class="detail-label">Numero</span>
          <span class="detail-value">${_escHtml(number)}</span>
        </div>
        ${item.serviceCenter ? `<div class="detail-item">
          <span class="detail-label">Centro SMS</span>
          <span class="detail-value">${_escHtml(item.serviceCenter)}</span>
        </div>` : ''}
        ${item.read !== undefined ? `<div class="detail-item">
          <span class="detail-label">Letto</span>
          <span class="detail-value">${item.read ? 'Si' : 'No'}</span>
        </div>` : ''}
        <div class="detail-item full-width">
          <span class="detail-label">Testo completo</span>
          <span class="detail-value sms-body-full">${_escHtml(body || '—')}</span>
        </div>
      </div>`;
    });
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER CHIAMATE
  // ─────────────────────────────────────────────────────────────
  function _renderCallsTable(page) {
    _smsState.callsCurPage = page;
    const tbody = document.getElementById('callsTableBody');
    if (!tbody) return;
    const filtered = _smsState.callsFiltered;

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr class="sms-empty-row"><td colspan="4">
        <div class="sms-empty-state">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2a3550" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.62 3.38 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.14 6.14l.92-.92a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          <p>Nessuna chiamata corrisponde ai filtri</p>
        </div></td></tr>`;
      document.getElementById('callsPagination').innerHTML = '';
      return;
    }

    const slice = _getPageSlice(filtered, page);
    let rows = '';
    slice.forEach((item, idx) => {
      const rowId = 'call-' + ((page - 1) * _smsState.PAGE_SIZE + idx);
      const typeInfo = _callTypeInfo(item.type || item.callType || '');
      const name     = item.name || item.contactName || '';
      const number   = item.number || item.phone || item.address || '';
      const duration = item.duration || item.durationSec || 0;
      const dateTs   = item.date || item.timestamp || item.time || '';

      rows += `<tr class="sms-row" id="row-${rowId}" onclick="_callToggleRow('${rowId}', ${JSON.stringify(item).replace(/'/g, "&#39;")})">
        <td class="cell-date">${_fmtDate(dateTs)}</td>
        <td class="cell-type">
          <span class="type-icon-wrap ${typeInfo.cls}" title="${typeInfo.label}">${typeInfo.svg}</span>
        </td>
        <td class="cell-contact">
          ${name ? `<span class="contact-name">${_escHtml(name)}</span>` : ''}
          <span class="contact-number">${_escHtml(number)}</span>
        </td>
        <td class="cell-duration">${typeInfo.cls === 'type-missed' ? '<span style="color:#f87171;font-size:0.75rem;">Persa</span>' : _fmtDuration(duration)}</td>
      </tr>`;
    });

    tbody.innerHTML = rows;
    _renderPagination('callsPagination', filtered.length, page, '_callsGoPage');
  }

  window._callsGoPage = function (page) {
    _collapseExpanded();
    _renderCallsTable(page);
  };

  window._callToggleRow = function (rowId, item) {
    _toggleDetail(rowId, () => {
      const typeInfo = _callTypeInfo(item.type || item.callType || '');
      const name     = item.name || item.contactName || '';
      const number   = item.number || item.phone || item.address || '';
      const duration = item.duration || item.durationSec || 0;
      const dateTs   = item.date || item.timestamp || item.time || '';
      return `<div class="sms-detail-inner">
        <div class="detail-item">
          <span class="detail-label">Data</span>
          <span class="detail-value">${_fmtDate(dateTs)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Tipo</span>
          <span class="detail-value">${typeInfo.label}</span>
        </div>
        ${name ? `<div class="detail-item">
          <span class="detail-label">Contatto</span>
          <span class="detail-value">${_escHtml(name)}</span>
        </div>` : ''}
        <div class="detail-item">
          <span class="detail-label">Numero</span>
          <span class="detail-value">${_escHtml(number)}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">Durata</span>
          <span class="detail-value">${typeInfo.cls === 'type-missed' ? 'Chiamata persa' : _fmtDuration(duration)}</span>
        </div>
        ${item.sim !== undefined ? `<div class="detail-item">
          <span class="detail-label">SIM</span>
          <span class="detail-value">${_escHtml(String(item.sim))}</span>
        </div>` : ''}
        ${item.geocodedLocation ? `<div class="detail-item">
          <span class="detail-label">Posizione</span>
          <span class="detail-value">${_escHtml(item.geocodedLocation)}</span>
        </div>` : ''}
      </div>`;
    });
  };

  // ─────────────────────────────────────────────────────────────
  // RENDER CONTATTI
  // ─────────────────────────────────────────────────────────────
  function _renderContacts(page) {
    _smsState.contactsCurPage = page;
    const grid = document.getElementById('contactsGrid');
    if (!grid) return;
    const filtered = _smsState.contactsFiltered;

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="sms-empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#2a3550" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <p>Nessun contatto corrisponde ai filtri</p>
      </div>`;
      document.getElementById('contactsPagination').innerHTML = '';
      return;
    }

    const slice = _getPageSlice(filtered, page);
    let cards = '';
    slice.forEach(item => {
      const name   = item.name || item.displayName || '';
      const number = item.number || item.phone || item.phones?.[0]?.number || '';
      const initials = name
        ? name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
        : (number ? number.slice(-2) : '?');
      cards += `<div class="contact-card">
        <div class="contact-avatar">${_escHtml(initials)}</div>
        <div class="contact-info">
          <div class="contact-info-name">${_escHtml(name || '—')}</div>
          <div class="contact-info-number">${_escHtml(number)}</div>
        </div>
      </div>`;
    });
    grid.innerHTML = cards;
    _renderPagination('contactsPagination', filtered.length, page, '_contactsGoPage');
  }

  window._contactsGoPage = function (page) {
    _renderContacts(page);
  };

  // ─────────────────────────────────────────────────────────────
  // FILTRI — evento comune
  // ─────────────────────────────────────────────────────────────

  /** Callback globale: cambia filtri */
  window.onSmsFilterChange = function () {
    _collapseExpanded();
    const tab = _smsState.tab;

    if (tab === 'sms') {
      _smsState.smsFiltered = _applyFilters(_smsState.smsRaw);
      _renderSmsTable(1);
    } else if (tab === 'calls') {
      _smsState.callsFiltered = _applyFilters(_smsState.callsRaw);
      _renderCallsTable(1);
    } else if (tab === 'contacts') {
      const f = _getFilters();
      _smsState.contactsFiltered = _smsState.contactsRaw.filter(c => {
        if (!f.search) return true;
        const n = (c.name || c.displayName || '').toLowerCase();
        const p = (c.number || c.phone || c.phones?.[0]?.number || '').toLowerCase();
        return n.includes(f.search) || p.includes(f.search);
      });
      _renderContacts(1);
    }
  };

  /** Reset filtri */
  window.resetSmsFilters = function () {
    const si = document.getElementById('smsSearchInput');
    const tf = document.getElementById('smsTypeFilter');
    const df = document.getElementById('smsDateFrom');
    const dt = document.getElementById('smsDateTo');
    if (si) si.value = '';
    if (tf) tf.value = 'all';
    if (df) df.value = '';
    if (dt) dt.value = '';
    onSmsFilterChange();
  };

  // ─────────────────────────────────────────────────────────────
  // TAB SWITCHER
  // ─────────────────────────────────────────────────────────────

  /** Nasconde/mostra opzione "Persi" nel select in base al tab */
  function _syncTypeFilterOptions(tab) {
    const sel = document.getElementById('smsTypeFilter');
    if (!sel) return;
    const missedOpt = sel.querySelector('option[value="missed"]');
    if (missedOpt) missedOpt.style.display = (tab === 'calls') ? '' : 'none';
    if (tab !== 'calls' && sel.value === 'missed') {
      sel.value = 'all';
    }
  }

  window.switchSmsTab = function (tab) {
    _collapseExpanded();
    _smsState.tab = tab;

    // Aggiorna tab buttons
    document.querySelectorAll('.sms-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Aggiorna contenuti
    document.querySelectorAll('.sms-tab-content').forEach(el => {
      el.classList.toggle('active', el.id === 'tab-' + tab);
    });

    // Sincronizza filtri
    _syncTypeFilterOptions(tab);

    // Nascondi filtri per contatti (no tipo/data)
    const filters = document.getElementById('smsFilters');
    if (filters) {
      const typeFilter = document.getElementById('smsTypeFilter');
      const dateWrap   = filters.querySelector('.filter-date-wrap');
      if (tab === 'contacts') {
        if (typeFilter) typeFilter.style.display = 'none';
        if (dateWrap) dateWrap.style.display = 'none';
      } else {
        if (typeFilter) typeFilter.style.display = '';
        if (dateWrap) dateWrap.style.display = '';
      }
    }

    // Re-render tab attivo
    onSmsFilterChange();
  };

  // ─────────────────────────────────────────────────────────────
  // LOAD PUBBLICHE
  // ─────────────────────────────────────────────────────────────

  /**
   * Carica SMS per deviceId.
   * Esposta globalmente: loadSMSPage(deviceId)
   */
  window.loadSMSPage = async function (deviceId) {
    _setLoader(true);
    try {
      const data = await _apiFetch(`/api/sms/${encodeURIComponent(deviceId)}`);
      const list = Array.isArray(data) ? data : (data.data || data.messages || data.sms || []);
      _smsState.smsRaw = list;
      _smsState.smsFiltered = _applyFilters(list);
      _updateBadges(list, 'sms');
      // Assicura tab SMS attivo
      if (_smsState.tab !== 'sms') {
        window.switchSmsTab('sms');
      } else {
        _renderSmsTable(1);
      }
    } catch (err) {
      console.error('[Nexus SMS] Errore caricamento SMS:', err);
      _showErrorState('smsTableBody', 4, 'Errore caricamento SMS: ' + err.message);
    } finally {
      _setLoader(false);
    }
  };

  /**
   * Carica chiamate per deviceId.
   * Esposta globalmente: loadCallsPage(deviceId)
   */
  window.loadCallsPage = async function (deviceId) {
    _setLoader(true);
    try {
      const data = await _apiFetch(`/api/calllog/${encodeURIComponent(deviceId)}`);
      const list = Array.isArray(data) ? data : (data.data || data.calls || data.calllog || []);
      _smsState.callsRaw = list;
      _smsState.callsFiltered = _applyFilters(list);
      _updateBadges(list, 'calls');
      // Assicura tab Chiamate attivo
      if (_smsState.tab !== 'calls') {
        window.switchSmsTab('calls');
      } else {
        _renderCallsTable(1);
      }
    } catch (err) {
      console.error('[Nexus SMS] Errore caricamento chiamate:', err);
      _showErrorState('callsTableBody', 4, 'Errore caricamento chiamate: ' + err.message);
    } finally {
      _setLoader(false);
    }
  };

  /**
   * Carica contatti per deviceId.
   * Esposta globalmente: loadContactsPage(deviceId)
   */
  window.loadContactsPage = async function (deviceId) {
    _setLoader(true);
    try {
      const data = await _apiFetch(`/api/contacts/${encodeURIComponent(deviceId)}`);
      const list = Array.isArray(data) ? data : (data.data || data.contacts || []);
      _smsState.contactsRaw = list;
      _smsState.contactsFiltered = list;
      if (_smsState.tab !== 'contacts') {
        window.switchSmsTab('contacts');
      } else {
        _renderContacts(1);
      }
    } catch (err) {
      console.error('[Nexus SMS] Errore caricamento contatti:', err);
      const g = document.getElementById('contactsGrid');
      if (g) g.innerHTML = `<div class="sms-empty-state"><p style="color:#f87171;">Errore: ${_escHtml(err.message)}</p></div>`;
    } finally {
      _setLoader(false);
    }
  };

  /**
   * Carica tutti i dati per un device (SMS + Chiamate + Contatti).
   * Esposta globalmente: loadAllSmsData(deviceId)
   */
  window.loadAllSmsData = async function (deviceId) {
    _setLoader(true);
    try {
      const [smsData, callsData, contactsData] = await Promise.allSettled([
        _apiFetch(`/api/sms/${encodeURIComponent(deviceId)}`),
        _apiFetch(`/api/calllog/${encodeURIComponent(deviceId)}`),
        _apiFetch(`/api/contacts/${encodeURIComponent(deviceId)}`),
      ]);

      if (smsData.status === 'fulfilled') {
        const list = Array.isArray(smsData.value)
          ? smsData.value
          : (smsData.value.data || smsData.value.messages || smsData.value.sms || []);
        _smsState.smsRaw = list;
        _smsState.smsFiltered = _applyFilters(list);
      }
      if (callsData.status === 'fulfilled') {
        const list = Array.isArray(callsData.value)
          ? callsData.value
          : (callsData.value.data || callsData.value.calls || callsData.value.calllog || []);
        _smsState.callsRaw = list;
        _smsState.callsFiltered = _applyFilters(list);
      }
      if (contactsData.status === 'fulfilled') {
        const list = Array.isArray(contactsData.value)
          ? contactsData.value
          : (contactsData.value.data || contactsData.value.contacts || []);
        _smsState.contactsRaw = list;
        _smsState.contactsFiltered = list;
      }

      // Aggiorna badge in base al tab attivo
      const activeRaw = _smsState.tab === 'calls' ? _smsState.callsRaw : _smsState.smsRaw;
      _updateBadges(activeRaw, _smsState.tab);

      // Render tab attivo
      const t = _smsState.tab;
      if (t === 'sms')      _renderSmsTable(1);
      else if (t === 'calls')  _renderCallsTable(1);
      else if (t === 'contacts') _renderContacts(1);
    } catch (err) {
      console.error('[Nexus SMS] Errore loadAllSmsData:', err);
    } finally {
      _setLoader(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // HELPERS INTERNI
  // ─────────────────────────────────────────────────────────────

  function _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _showErrorState(tbodyId, colSpan, msg) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.innerHTML = `<tr class="sms-empty-row"><td colspan="${colSpan}">
      <div class="sms-empty-state">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p style="color:#f87171;">${_escHtml(msg)}</p>
      </div></td></tr>`;
  }

  // ─────────────────────────────────────────────────────────────
  // INIT — sincronizza stato iniziale
  // ─────────────────────────────────────────────────────────────
  (function _init() {
    _syncTypeFilterOptions('sms');
    // Se currentDevice è già definito al momento del caricamento, auto-load
    if (typeof currentDevice !== 'undefined' && currentDevice) {
      const section = document.getElementById('page-sms');
      if (section && section.style.display !== 'none') {
        loadAllSmsData(currentDevice);
      }
    }
  })();

})();

// === END SMS PAGE JS ===

// Dashboard data is loaded from data/dashboard_data.json at startup.
let DATA = null;


const state = {
  view: 'home',           // 'home' | 'region' | 'archive'
  currentRegion: null,    // string when on region view
  // permit roll filters (region-scoped)
  search: '', status: '', noteFilter: '', propertyCode: '',
  expandedPermitId: null,
  notes: {},
  pendingChanges: {},
  // archive
  archiveSearch: '', archiveRvp: '', archiveRegion: '',
  expandedArchiveId: null,
};

const STORAGE_PREFIX = 'compliance-watch:note:';

// ── PERSISTENCE ──
function loadAllNotes() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            state.notes[key.substring(STORAGE_PREFIX.length)] = JSON.parse(raw);
          }
        } catch (e) {}
      }
    }
  } catch (e) { console.error('Could not load notes:', e); }
}
function saveNote(permitId, payload) {
  try {
    const isEmpty = !payload.text.trim() && !payload.help_status;
    const key = STORAGE_PREFIX + permitId;
    if (!isEmpty) {
      localStorage.setItem(key, JSON.stringify(payload));
      state.notes[permitId] = payload;
    } else {
      localStorage.removeItem(key);
      delete state.notes[permitId];
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || 'Unknown error' }; }
}
function getCurrentSavedPayload(permitId) {
  return state.notes[permitId] || { text: '', help_status: null, updated_at: null };
}
function getEffectivePayload(permitId) {
  if (state.pendingChanges[permitId]) return state.pendingChanges[permitId];
  return getCurrentSavedPayload(permitId);
}
function hasPendingChanges(permitId) { return !!state.pendingChanges[permitId]; }
function markDirty(permitId, partial) {
  const saved = getCurrentSavedPayload(permitId);
  const current = state.pendingChanges[permitId] || {
    text: saved.text || '', help_status: saved.help_status || null,
  };
  const updated = { ...current, ...partial };
  if (updated.text === (saved.text || '') &&
      updated.help_status === (saved.help_status || null)) {
    delete state.pendingChanges[permitId];
    updateSaveButtonState(permitId, false);
  } else {
    state.pendingChanges[permitId] = updated;
    updateSaveButtonState(permitId, true);
  }
}
function updateSaveButtonState(permitId, dirty) {
  const btn = document.querySelector(`[data-save-for="${permitId}"]`);
  const info = document.querySelector(`[data-info-for="${permitId}"]`);
  if (!btn) return;
  btn.disabled = !dirty;
  btn.classList.remove('is-saved');
  btn.textContent = 'Save';
  if (info) {
    info.classList.toggle('is-dirty', dirty);
    info.textContent = dirty ? 'Unsaved changes' : (state.notes[permitId] ? 'All changes saved' : '');
  }
}

// ── COUNTS ──
function countNoteStatus(permits) {
  let noNote = 0;
  for (const p of permits) {
    const n = state.notes[p.permit_id];
    if (!n || !n.text || !n.text.trim()) noNote++;
  }
  return noNote;
}
function countHelpFor(permits) {
  let needs = 0, progress = 0;
  for (const p of permits) {
    const n = state.notes[p.permit_id];
    if (!n) continue;
    if (n.help_status === 'needs_help') needs++;
    else if (n.help_status === 'being_helped') progress++;
  }
  return { needs, progress };
}

// ── ROUTING ──
function regionSlug(name) { return encodeURIComponent(name); }
function regionFromSlug(slug) {
  try { return decodeURIComponent(slug); } catch { return null; }
}
function navigateTo(hash) {
  if (window.location.hash !== hash) {
    window.location.hash = hash;
  } else {
    handleRoute();
  }
}
function handleRoute() {
  const h = window.location.hash || '';
  if (h.startsWith('#region/')) {
    const region = regionFromSlug(h.substring('#region/'.length));
    const validRegion = DATA.region_summary.find(r => r.region === region);
    if (validRegion) {
      state.view = 'region';
      state.currentRegion = region;
      // reset region-scoped filters when entering a new region
      state.search = ''; state.status = ''; state.noteFilter = ''; state.propertyCode = '';
      state.expandedPermitId = null;
      renderViews();
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
  }
  if (h === '#archive') {
    state.view = 'archive';
    renderViews();
    window.scrollTo({ top: 0, behavior: 'instant' });
    return;
  }
  // default → home
  state.view = 'home';
  state.currentRegion = null;
  renderViews();
}
function renderViews() {
  document.getElementById('view-home').style.display = (state.view === 'home') ? '' : 'none';
  document.getElementById('view-region').style.display = (state.view === 'region') ? '' : 'none';
  document.getElementById('view-archive').style.display = (state.view === 'archive') ? '' : 'none';

  // Show preface only on home
  document.getElementById('preface').style.display = (state.view === 'home') ? '' : 'none';

  // Update tab active state
  document.querySelectorAll('.tab').forEach(t => {
    const isArch = t.dataset.tab === 'archive';
    const active = (state.view === 'archive') ? isArch : !isArch;
    t.classList.toggle('is-active', active);
  });

  if (state.view === 'home') {
    renderHomeHero();
    renderRegionalStandings();
  } else if (state.view === 'region') {
    renderRegionView();
  } else if (state.view === 'archive') {
    renderArchive();
  }
}

// ── MASTHEAD ──
function renderMasthead() {
  const date = new Date(DATA.summary.as_of + 'T00:00:00');
  document.getElementById('masthead-date').textContent =
    date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  document.getElementById('active-count').textContent = DATA.active_permits.length;
  document.getElementById('archive-count').textContent = (DATA.archive_permits || []).length;
}

// ── HOME: HERO ──
function renderHomeHero() {
  const s = DATA.summary;
  const pm = s.prev_month || {};
  const pmDate = pm.as_of || '';
  const noNote = countNoteStatus(DATA.active_permits);
  const noNotePct = (s.total_expired + s.total_expiring) > 0
    ? Math.round(100 * noNote / (s.total_expired + s.total_expiring)) : 0;
  const help = countHelpFor(DATA.active_permits);

  const trendCompliance = trendLine(s.overall_compliance, pm.overall_compliance,
    { higherIsBetter: true, isPercent: true, prevDate: pmDate });
  const trendExpired = trendLine(s.total_expired, pm.total_expired,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });
  const trendNoUpdate = trendLine(noNote, pm.no_update,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });
  const trendProps = trendLine(s.properties_with_issues, pm.properties_with_issues,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });

  document.getElementById('home-hero').innerHTML = `
    <div class="tile tile-feature">
      <div class="tile-label">Overall Compliance</div>
      <div class="tile-value large">${s.overall_compliance.toFixed(1)}<span class="tile-suffix">%</span></div>
      <div class="tile-sub">${s.total_permits.toLocaleString()} permits · ${s.total_properties} properties</div>
      ${trendCompliance}
    </div>
    <div class="tile">
      <div class="tile-label">Currently Expired</div>
      <div class="tile-value danger">${s.total_expired}</div>
      <div class="tile-sub">${(100*s.total_expired/s.total_permits).toFixed(1)}% of portfolio</div>
      ${trendExpired}
    </div>
    <div class="tile">
      <div class="tile-label">Expiring ≤30 Days</div>
      <div class="tile-value warning">${s.total_expiring}</div>
      <div class="tile-sub">${(100*s.total_expiring/s.total_permits).toFixed(1)}% of portfolio</div>
    </div>
    <div class="tile">
      <div class="tile-label">No Update</div>
      <div class="tile-value no-update">${noNote}</div>
      <div class="tile-sub">${noNotePct}% missing context</div>
      ${trendNoUpdate}
    </div>
    <div class="tile">
      <div class="tile-label">Open Help Requests</div>
      <div class="tile-value help">${help.needs}</div>
      <div class="tile-sub">${help.progress} being helped</div>
    </div>
    <div class="tile">
      <div class="tile-label">Properties Affected</div>
      <div class="tile-value">${s.properties_with_issues}</div>
      <div class="tile-sub">of ${s.total_properties}</div>
      ${trendProps}
    </div>`;
}

// ── HOME: REGIONAL STANDINGS (all 21) ──
function renderRegionalStandings() {
  const all = DATA.region_summary;

  // Compute help counts per region from saved notes
  const helpByRegion = {};
  for (const p of DATA.active_permits) {
    const note = state.notes[p.permit_id];
    if (note && note.help_status === 'needs_help') {
      helpByRegion[p.region] = (helpByRegion[p.region] || 0) + 1;
    }
  }

  const head = `
    <div class="standings-row head">
      <div class="head-cell">Region</div>
      <div class="head-cell head-secondary">RVP/SVP</div>
      <div class="head-cell" style="text-align:right">Expired</div>
      <div class="head-cell" style="text-align:right">Soon</div>
      <div class="head-cell" style="text-align:right">Help</div>
      <div class="head-cell head-total" style="text-align:right">Total</div>
      <div class="head-cell" style="text-align:left">Compliance</div>
    </div>`;
  const rows = all.map(r => {
    let barClass = '';
    if (r.compliance_score < 80) barClass = 'danger';
    else if (r.compliance_score < 93) barClass = 'warning';
    const helpCount = helpByRegion[r.region] || 0;
    const helpClass = helpCount > 0 ? 'help-needed' : 'help-needed zero';
    const helpDisplay = helpCount > 0 ? helpCount : '—';
    return `
      <div class="standings-row" data-region="${escapeHtml(r.region)}">
        <div><div class="standings-name serif">${escapeHtml(r.region)}</div></div>
        <div class="standings-secondary">${escapeHtml(r.rvp)}</div>
        <div class="num expired">${r.expired || ''}</div>
        <div class="num expiring">${r.expiring_soon || ''}</div>
        <div class="num ${helpClass}">${helpDisplay}</div>
        <div class="num total">${r.total_permits}</div>
        <div class="bar">
          <div class="bar-track"><div class="bar-fill ${barClass}" style="width: ${r.compliance_score}%"></div></div>
          <div class="bar-value">${r.compliance_score.toFixed(1)}%</div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('home-standings').innerHTML = head + rows;
  document.querySelectorAll('#home-standings .standings-row[data-region]').forEach(row => {
    row.addEventListener('click', () => {
      navigateTo('#region/' + regionSlug(row.dataset.region));
    });
  });
}

// ── REGION VIEW ──
function renderRegionView() {
  const region = state.currentRegion;
  const regionData = DATA.region_summary.find(r => r.region === region);
  if (!regionData) { state.view = 'home'; renderViews(); return; }

  document.getElementById('region-name').textContent = region;
  document.getElementById('region-breadcrumb-name').textContent = region;
  document.getElementById('region-rvp').textContent = regionData.rvp;

  // Region permits = active permits in this region
  const regionPermits = DATA.active_permits.filter(p => p.region === region);
  // Properties in region
  const regionProperties = DATA.property_summary.filter(p => p.region === region);

  // Region Hero
  const regionExpired = regionData.expired;
  const regionExpiring = regionData.expiring_soon;
  const regionTotal = regionData.total_permits;
  const regionAffected = regionData.properties_with_issues;
  const regionPropCount = regionData.property_count;
  const noNote = countNoteStatus(regionPermits);
  const noNotePct = (regionExpired + regionExpiring) > 0
    ? Math.round(100 * noNote / (regionExpired + regionExpiring)) : 0;
  const help = countHelpFor(regionPermits);

  const pm = regionData.prev_month || {};
  const pmDate = (DATA.summary.prev_month && DATA.summary.prev_month.as_of) || '';
  const trendCompliance = trendLine(regionData.compliance_score, pm.compliance_score,
    { higherIsBetter: true, isPercent: true, prevDate: pmDate });
  const trendExpired = trendLine(regionExpired, pm.expired,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });
  const trendNoUpdate = trendLine(noNote, pm.no_update,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });
  const trendProps = trendLine(regionAffected, pm.properties_with_issues,
    { higherIsBetter: false, isPercent: false, prevDate: pmDate });

  document.getElementById('region-hero').innerHTML = `
    <div class="tile tile-feature">
      <div class="tile-label">Region Compliance</div>
      <div class="tile-value large">${regionData.compliance_score.toFixed(1)}<span class="tile-suffix">%</span></div>
      <div class="tile-sub">${regionTotal.toLocaleString()} permits · ${regionPropCount} properties</div>
      ${trendCompliance}
    </div>
    <div class="tile">
      <div class="tile-label">Currently Expired</div>
      <div class="tile-value danger">${regionExpired}</div>
      <div class="tile-sub">${regionTotal ? (100*regionExpired/regionTotal).toFixed(1) : 0}% of region</div>
      ${trendExpired}
    </div>
    <div class="tile">
      <div class="tile-label">Expiring ≤30 Days</div>
      <div class="tile-value warning">${regionExpiring}</div>
      <div class="tile-sub">${regionTotal ? (100*regionExpiring/regionTotal).toFixed(1) : 0}% of region</div>
    </div>
    <div class="tile">
      <div class="tile-label">No Update</div>
      <div class="tile-value no-update">${noNote}</div>
      <div class="tile-sub">${noNotePct}% missing context</div>
      ${trendNoUpdate}
    </div>
    <div class="tile">
      <div class="tile-label">Open Help Requests</div>
      <div class="tile-value help">${help.needs}</div>
      <div class="tile-sub">${help.progress} being helped</div>
    </div>
    <div class="tile">
      <div class="tile-label">Properties Affected</div>
      <div class="tile-value">${regionAffected}</div>
      <div class="tile-sub">of ${regionPropCount}</div>
      ${trendProps}
    </div>`;

  // Property Standings — all properties in region, sorted worst first
  const sortedProps = [...regionProperties].sort((a, b) =>
    (a.compliance_score - b.compliance_score) || (b.expired - a.expired)
  );

  // Help counts per property from saved notes
  const helpByProperty = {};
  for (const p of regionPermits) {
    const note = state.notes[p.permit_id];
    if (note && note.help_status === 'needs_help') {
      helpByProperty[p.property_code] = (helpByProperty[p.property_code] || 0) + 1;
    }
  }

  const propHead = `
    <div class="standings-row head">
      <div class="head-cell">Property</div>
      <div class="head-cell head-secondary">Code</div>
      <div class="head-cell" style="text-align:right">Expired</div>
      <div class="head-cell" style="text-align:right">Soon</div>
      <div class="head-cell" style="text-align:right">Help</div>
      <div class="head-cell head-total" style="text-align:right">Total</div>
      <div class="head-cell" style="text-align:left">Compliance</div>
    </div>`;
  const propRows = sortedProps.map(p => {
    let barClass = '';
    if (p.compliance_score < 80) barClass = 'danger';
    else if (p.compliance_score < 93) barClass = 'warning';
    const isActive = state.propertyCode === p.code;
    const helpCount = helpByProperty[p.code] || 0;
    const helpClass = helpCount > 0 ? 'help-needed' : 'help-needed zero';
    const helpDisplay = helpCount > 0 ? helpCount : '—';
    return `
      <div class="standings-row ${isActive ? 'is-active' : ''}" data-property="${escapeHtml(p.code)}">
        <div><div class="standings-name serif">${escapeHtml(p.display_name)}</div></div>
        <div class="standings-secondary code">${escapeHtml(p.code)}</div>
        <div class="num expired">${p.expired || ''}</div>
        <div class="num expiring">${p.expiring_soon || ''}</div>
        <div class="num ${helpClass}">${helpDisplay}</div>
        <div class="num total">${p.total_permits}</div>
        <div class="bar">
          <div class="bar-track"><div class="bar-fill ${barClass}" style="width: ${p.compliance_score}%"></div></div>
          <div class="bar-value">${p.compliance_score.toFixed(1)}%</div>
        </div>
      </div>`;
  }).join('');
  document.getElementById('region-property-standings').innerHTML = propHead + propRows;
  document.querySelectorAll('#region-property-standings .standings-row[data-property]').forEach(row => {
    row.addEventListener('click', () => {
      const code = row.dataset.property;
      state.propertyCode = (state.propertyCode === code) ? '' : code;
      renderRegionView();
      // Smooth scroll to permit table
      if (state.propertyCode) {
        document.getElementById('permits').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Permit Roll
  renderRegionPermits(regionPermits);
}

function getRegionFilteredPermits(allRegionPermits) {
  return allRegionPermits.filter(p => {
    if (state.propertyCode && p.property_code !== state.propertyCode) return false;
    if (state.status && p.status !== state.status) return false;
    if (state.noteFilter) {
      const note = state.notes[p.permit_id];
      const hasText = note && note.text && note.text.trim();
      const hs = note ? note.help_status : null;
      if (state.noteFilter === 'no_note' && hasText) return false;
      if (state.noteFilter === 'has_note' && !hasText) return false;
      if (state.noteFilter === 'needs_help' && hs !== 'needs_help') return false;
      if (state.noteFilter === 'being_helped' && hs !== 'being_helped') return false;
    }
    if (state.search) {
      const hay = (p.title + ' ' + p.display_name + ' ' + p.property_code).toLowerCase();
      if (!hay.includes(state.search.toLowerCase())) return false;
    }
    return true;
  });
}

function renderRegionPermits(allRegionPermits) {
  const filtered = getRegionFilteredPermits(allRegionPermits);
  const total = allRegionPermits.length;
  document.getElementById('filter-summary').innerHTML =
    total === 0
      ? `<strong>No permits requiring attention in this region</strong>`
      : `Showing <strong>${filtered.length}</strong> of ${total} permits`;

  const pills = [];
  if (state.propertyCode) {
    const propName = (DATA.property_summary.find(p => p.code === state.propertyCode) || {}).display_name || state.propertyCode;
    pills.push({ label: 'Property: ' + propName, key: 'propertyCode' });
  }
  if (state.status) pills.push({ label: 'Status: ' + (state.status === 'expired' ? 'Expired' : 'Expiring Soon'), key: 'status' });
  if (state.noteFilter) {
    const m = { no_note: 'No Update', has_note: 'Has Note', needs_help: 'Needs Help', being_helped: 'Being Helped' };
    pills.push({ label: 'Note: ' + m[state.noteFilter], key: 'noteFilter' });
  }
  if (state.search) pills.push({ label: 'Search: ' + state.search, key: 'search' });
  document.getElementById('filter-pills').innerHTML = pills.map(p =>
    `<span class="active-filter-pill">${escapeHtml(p.label)} <button data-key="${p.key}">×</button></span>`
  ).join('');
  document.querySelectorAll('#filter-pills .active-filter-pill button').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.key;
      state[k] = '';
      if (k === 'status') document.getElementById('filter-status').value = '';
      if (k === 'noteFilter') document.getElementById('filter-note').value = '';
      if (k === 'search') document.getElementById('search').value = '';
      renderRegionView();
    });
  });

  const head = `
    <div class="permit-row head">
      <div>Status</div>
      <div>Permit</div>
      <div>Property</div>
      <div class="head-exp" style="text-align:right">Expires</div>
      <div class="head-renewal" style="text-align:right">Renewal Opens</div>
      <div></div>
    </div>`;
  if (filtered.length === 0) {
    if (total === 0) {
      document.getElementById('permits').innerHTML =
        '<div class="empty-state">All permits in this region are current. Nothing to action.</div>';
    } else {
      document.getElementById('permits').innerHTML = head +
        '<div class="empty-state">No permits match the current filters.</div>';
    }
    return;
  }
  document.getElementById('permits').innerHTML = head + filtered.map(p => permitRowHtml(p)).join('');
  attachPermitListeners();
}

function permitRowHtml(p) {
  const statusLabel = p.status === 'expired' ? 'Expired' : 'Expiring';
  const statusClass = p.status === 'expired' ? 'expired' : 'expiring';
  const dayDetail = p.status === 'expired'
    ? `${Math.abs(p.days_to_exp)} day${Math.abs(p.days_to_exp) === 1 ? '' : 's'} ago`
    : `in ${p.days_to_exp} day${p.days_to_exp === 1 ? '' : 's'}`;
  const note = state.notes[p.permit_id];
  const hasNote = note && note.text && note.text.trim();
  const helpStatus = note ? note.help_status : null;
  const isExpanded = state.expandedPermitId === p.permit_id;
  const expClass = isExpanded ? 'is-expanded' : '';
  let helpBadge = '';
  if (helpStatus === 'needs_help') helpBadge = '<span class="help-badge needs-help">Needs Help</span>';
  else if (helpStatus === 'being_helped') helpBadge = '<span class="help-badge being-helped">Being Helped</span>';
  const eff = getEffectivePayload(p.permit_id);
  const dirty = hasPendingChanges(p.permit_id);
  const noteClasses = ['ind-note'];
  if (hasNote) noteClasses.push('has-note');
  else noteClasses.push('no-note');
  const noteText = hasNote ? 'Note added' : 'No update';
  const updatedDisplay = (note && note.updated_at)
    ? `<div class="ind-note-updated">Updated ${relativeTime(note.updated_at)}</div>`
    : '';

  return `
    <div class="permit-row ${expClass} ${!hasNote ? 'no-note' : ''}" data-permit-id="${p.permit_id}">
      <div class="permit-status-cell">
        <span class="permit-status ${statusClass}">${statusLabel}</span>
        <span class="permit-status-detail">${dayDetail}</span>
      </div>
      <div><div class="permit-title">${escapeHtml(p.title)}</div></div>
      <div>
        <div class="permit-property">${escapeHtml(p.display_name)}</div>
        <div class="permit-property-region">${escapeHtml(p.region)}</div>
      </div>
      <div class="permit-date exp">${formatDate(p.expiration)}</div>
      <div class="permit-date renewal">${formatDate(p.renewal_start)}</div>
      <div class="permit-indicators">
        ${helpBadge ? `<div class="ind-row">${helpBadge}</div>` : ''}
        <div class="ind-row">
          <span class="${noteClasses.join(' ')}">${noteText}</span>
          <span class="chev">›</span>
        </div>
        ${updatedDisplay}
      </div>
    </div>
    <div class="permit-detail" data-detail-for="${p.permit_id}">
      <div class="detail-grid">
        <dl class="detail-meta">
          <dt>Property</dt>
          <dd class="serif">${escapeHtml(p.display_name)} <span style="color:var(--ink-muted);font-family:'IBM Plex Mono',monospace;font-size:11px;">· ${escapeHtml(p.property_code)}</span></dd>
          <dt>Region</dt><dd>${escapeHtml(p.region)}</dd>
          <dt>RVP/SVP</dt><dd>${escapeHtml(p.rvp)}</dd>
          <dt>Renewal Opens</dt><dd>${formatDate(p.renewal_start)}</dd>
          <dt>Expiration</dt><dd>${formatDate(p.expiration)}</dd>
          <dt>Status</dt>
          <dd style="color: var(${p.status === 'expired' ? '--expired' : '--expiring'})">
            ${p.status === 'expired' ? 'Expired ' + Math.abs(p.days_to_exp) + ' days ago' : 'Expires in ' + p.days_to_exp + ' day' + (p.days_to_exp===1?'':'s')}
          </dd>
          <a href="https://sso-afaaeb9d.sso.duosecurity.com/saml2/sp/DI1UFRGTBHDPDPTT4BYJ/sso"
             target="_blank" rel="noopener" class="origami-link-detail"
             onclick="event.stopPropagation()">
            Go to Origami <span class="arrow">→</span>
          </a>
        </dl>
        <div class="note-block">
          <div class="note-label">
            <span>Property Note</span>
            <span class="note-saved" data-saved-for="${p.permit_id}"></span>
          </div>
          <textarea class="note-textarea" data-note-for="${p.permit_id}"
            placeholder="Why is this expired or at risk? What's the renewal status? Any blockers?">${escapeHtml(eff.text || '')}</textarea>
          ${note && note.updated_at ? `<div class="note-meta">Last saved ${formatDateTime(note.updated_at)}</div>` : ''}

          <div class="help-status">
            <div class="help-status-label">Help Status</div>
            <div class="help-options" data-help-for="${p.permit_id}">
              <label class="help-option help-none ${!eff.help_status ? 'is-selected' : ''}">
                <input type="radio" name="help-${p.permit_id}" value="" ${!eff.help_status ? 'checked' : ''}>
                <span class="opt-icon">●</span><span class="opt-label">On Track</span>
              </label>
              <label class="help-option help-needs ${eff.help_status === 'needs_help' ? 'is-selected' : ''}">
                <input type="radio" name="help-${p.permit_id}" value="needs_help" ${eff.help_status === 'needs_help' ? 'checked' : ''}>
                <span class="opt-icon">⚠</span><span class="opt-label">Needs Help</span>
              </label>
              <label class="help-option help-progress ${eff.help_status === 'being_helped' ? 'is-selected' : ''}">
                <input type="radio" name="help-${p.permit_id}" value="being_helped" ${eff.help_status === 'being_helped' ? 'checked' : ''}>
                <span class="opt-icon">↻</span><span class="opt-label">Being Helped</span>
              </label>
            </div>
          </div>

          <div class="note-actions">
            <div class="note-actions-info ${dirty ? 'is-dirty' : ''}" data-info-for="${p.permit_id}">
              ${dirty ? 'Unsaved changes' : (note ? 'All changes saved' : '')}
            </div>
            <button class="btn-save" data-save-for="${p.permit_id}" ${dirty ? '' : 'disabled'}>Save</button>
          </div>
        </div>
      </div>
    </div>`;
}

function attachPermitListeners() {
  document.querySelectorAll('.permit-row[data-permit-id]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.permit-detail')) return;
      const id = row.dataset.permitId;
      if (state.expandedPermitId === id && hasPendingChanges(id)) {
        if (!confirm('You have unsaved changes. Discard and close?')) return;
        delete state.pendingChanges[id];
      }
      state.expandedPermitId = (state.expandedPermitId === id) ? null : id;
      renderRegionView();
      if (state.expandedPermitId === id) {
        setTimeout(() => {
          const ta = document.querySelector(`[data-note-for="${id}"]`);
          if (ta) ta.focus();
        }, 50);
      }
    });
  });
  document.querySelectorAll('.note-textarea').forEach(ta => {
    const permitId = ta.dataset.noteFor;
    ta.addEventListener('input', () => markDirty(permitId, { text: ta.value }));
    ta.addEventListener('click', e => e.stopPropagation());
  });
  document.querySelectorAll('.help-options').forEach(group => {
    const permitId = group.dataset.helpFor;
    group.addEventListener('change', e => {
      if (e.target.type !== 'radio') return;
      markDirty(permitId, { help_status: e.target.value || null });
      group.querySelectorAll('.help-option').forEach(opt => {
        const input = opt.querySelector('input');
        opt.classList.toggle('is-selected', input.checked);
      });
    });
    group.addEventListener('click', e => e.stopPropagation());
  });
  document.querySelectorAll('.btn-save').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const permitId = btn.dataset.saveFor;
      const pending = state.pendingChanges[permitId];
      if (!pending) return;
      const indicator = document.querySelector(`[data-saved-for="${permitId}"]`);
      const info = document.querySelector(`[data-info-for="${permitId}"]`);
      indicator.textContent = 'Saving…';
      indicator.className = 'note-saved is-visible is-saving';
      const payload = {
        text: pending.text || '',
        help_status: pending.help_status || null,
        updated_at: new Date().toISOString(),
      };
      const result = saveNote(permitId, payload);
      if (result.ok) {
        delete state.pendingChanges[permitId];
        indicator.textContent = 'Saved';
        indicator.className = 'note-saved is-visible';
        btn.classList.add('is-saved');
        btn.textContent = 'Saved';
        btn.disabled = true;
        if (info) {
          info.classList.remove('is-dirty');
          info.textContent = 'All changes saved';
        }
        setTimeout(() => indicator.classList.remove('is-visible'), 2200);
        // Re-render the region view (so all dependent UI updates)
        renderRegionView();
        updateFooterCounts();
      } else {
        indicator.textContent = 'Save failed: ' + result.error;
        indicator.className = 'note-saved is-visible is-error';
      }
    });
  });
}

// ── ARCHIVE ──
function populateArchiveFilters() {
  const archive = DATA.archive_permits || [];
  const rvps = [...new Set(archive.map(p => p.rvp))].sort();
  const regions = [...new Set(archive.map(p => p.region))].sort();
  const rvpSel = document.getElementById('archive-rvp');
  const regSel = document.getElementById('archive-region');
  rvps.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    rvpSel.appendChild(opt);
  });
  regions.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r; opt.textContent = r;
    regSel.appendChild(opt);
  });
}
function getFilteredArchive() {
  const archive = DATA.archive_permits || [];
  return archive.filter(p => {
    if (state.archiveRvp && p.rvp !== state.archiveRvp) return false;
    if (state.archiveRegion && p.region !== state.archiveRegion) return false;
    if (state.archiveSearch) {
      const q = state.archiveSearch.toLowerCase();
      const hay = (p.title + ' ' + p.display_name + ' ' + p.rvp + ' ' + p.region + ' ' +
                   (p.note ? p.note.text : '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function renderArchive() {
  const filtered = getFilteredArchive();
  const total = (DATA.archive_permits || []).length;
  document.getElementById('archive-summary').innerHTML =
    `Showing <strong>${filtered.length}</strong> of ${total} archived permits`;
  const pills = [];
  if (state.archiveRvp) pills.push({ label: 'RVP: ' + state.archiveRvp, key: 'archiveRvp' });
  if (state.archiveRegion) pills.push({ label: 'Region: ' + state.archiveRegion, key: 'archiveRegion' });
  if (state.archiveSearch) pills.push({ label: 'Search: ' + state.archiveSearch, key: 'archiveSearch' });
  document.getElementById('archive-pills').innerHTML = pills.map(p =>
    `<span class="active-filter-pill">${escapeHtml(p.label)} <button data-archive-key="${p.key}">×</button></span>`
  ).join('');
  document.querySelectorAll('[data-archive-key]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.archiveKey;
      state[k] = '';
      if (k === 'archiveRvp') document.getElementById('archive-rvp').value = '';
      if (k === 'archiveRegion') document.getElementById('archive-region').value = '';
      if (k === 'archiveSearch') document.getElementById('archive-search').value = '';
      renderArchive();
    });
  });
  const container = document.getElementById('archive-content');
  if (total === 0) {
    container.innerHTML = `
      <div class="archive-empty">
        <div class="archive-empty-icon">∅</div>
        <div class="archive-empty-title serif">No archived permits yet</div>
        <div class="archive-empty-body">Permits move here automatically once they're renewed in Origami.</div>
      </div>`;
    return;
  }
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="archive-list">
        <div class="archive-row head">
          <div>Archived</div><div>Permit / Note</div>
          <div class="head-property">Property</div>
          <div class="head-rvp">RVP/SVP</div><div></div>
        </div>
        <div class="empty-state">No archived permits match the current filters.</div>
      </div>`;
    return;
  }
  const head = `
    <div class="archive-row head">
      <div>Archived</div>
      <div>Permit / Note</div>
      <div class="head-property">Property</div>
      <div class="head-rvp">RVP/SVP</div>
      <div></div>
    </div>`;
  const rows = filtered.map(p => archiveRowHtml(p)).join('');
  container.innerHTML = `<div class="archive-list">${head}${rows}</div>`;
  attachArchiveListeners();
}
function archiveRowHtml(p) {
  const isExpanded = state.expandedArchiveId === p.permit_id;
  const expClass = isExpanded ? 'is-expanded' : '';
  const archDate = new Date(p.archived_at);
  const archDateShort = archDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const archDateLong = archDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const note = p.note || {};
  let helpBadge = '';
  if (note.help_status === 'needs_help') helpBadge = '<span class="help-badge needs-help">Was: Needs Help</span>';
  else if (note.help_status === 'being_helped') helpBadge = '<span class="help-badge being-helped">Was: Being Helped</span>';
  return `
    <div class="archive-row ${expClass}" data-archive-id="${p.permit_id}">
      <div class="archive-date-cell">
        <div class="archive-date-label">Archived</div>
        <div class="archive-date-value">${archDateShort}</div>
      </div>
      <div class="archive-permit-cell">
        <div class="archive-permit-title">${escapeHtml(p.title)}</div>
        <div class="archive-note-preview">"${escapeHtml(note.text || '')}"</div>
      </div>
      <div class="archive-property-cell">
        <div class="archive-property">${escapeHtml(p.display_name)}</div>
        <div class="archive-property-region">${escapeHtml(p.region)}</div>
      </div>
      <div class="archive-rvp">${escapeHtml(p.rvp)}</div>
      <div class="archive-chev">›</div>
    </div>
    <div class="archive-detail">
      <div class="archive-detail-grid">
        <dl class="detail-meta">
          <dt>Property</dt>
          <dd class="serif">${escapeHtml(p.display_name)} <span style="color:var(--ink-muted);font-family:'IBM Plex Mono',monospace;font-size:11px;">· ${escapeHtml(p.property_code)}</span></dd>
          <dt>Region</dt><dd>${escapeHtml(p.region)}</dd>
          <dt>RVP/SVP</dt><dd>${escapeHtml(p.rvp)}</dd>
          <dt>Renewal Window Opened</dt><dd>${formatDate(p.renewal_start)}</dd>
          <dt>Original Expiration</dt><dd>${formatDate(p.expiration)}</dd>
          <dt>Archived</dt><dd>${archDateLong}</dd>
        </dl>
        <div>
          <div class="archive-note-block">
            <div class="archive-note-label">Final Property Note</div>
            <div class="archive-note-text">${escapeHtml(note.text || '—')}</div>
            ${helpBadge ? `<div class="archive-help-badge-row">${helpBadge}</div>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}
function attachArchiveListeners() {
  document.querySelectorAll('.archive-row[data-archive-id]').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.archiveId;
      state.expandedArchiveId = (state.expandedArchiveId === id) ? null : id;
      renderArchive();
    });
  });
}
function attachArchiveFilterListeners() {
  document.getElementById('archive-search').addEventListener('input', e => {
    state.archiveSearch = e.target.value; renderArchive();
  });
  document.getElementById('archive-rvp').addEventListener('change', e => {
    state.archiveRvp = e.target.value; renderArchive();
  });
  document.getElementById('archive-region').addEventListener('change', e => {
    state.archiveRegion = e.target.value; renderArchive();
  });
  document.getElementById('archive-clear').addEventListener('click', () => {
    state.archiveSearch = ''; state.archiveRvp = ''; state.archiveRegion = '';
    document.getElementById('archive-search').value = '';
    document.getElementById('archive-rvp').value = '';
    document.getElementById('archive-region').value = '';
    renderArchive();
  });
}

// ── REGION-PAGE FILTER LISTENERS ──
function attachRegionFilterListeners() {
  document.getElementById('search').addEventListener('input', e => {
    state.search = e.target.value; renderRegionView();
  });
  document.getElementById('filter-status').addEventListener('change', e => {
    state.status = e.target.value; renderRegionView();
  });
  document.getElementById('filter-note').addEventListener('change', e => {
    state.noteFilter = e.target.value; renderRegionView();
  });
  document.getElementById('clear-filters').addEventListener('click', () => {
    state.search = ''; state.status = ''; state.noteFilter = ''; state.propertyCode = '';
    document.getElementById('search').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-note').value = '';
    renderRegionView();
  });
}

// ── TAB & NAV ──
function attachNavListeners() {
  // Top-level tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const t = tab.dataset.tab;
      if (t === 'archive') navigateTo('#archive');
      else navigateTo('#');
    });
  });
  // Back to overview link
  document.getElementById('back-to-overview').addEventListener('click', e => {
    e.preventDefault();
    navigateTo('#');
  });
  // Title click → home
  document.getElementById('home-link').addEventListener('click', () => {
    navigateTo('#');
  });
  // Hash change → route
  window.addEventListener('hashchange', handleRoute);
}

function updateFooterCounts() {
  const total = Object.keys(state.notes).length;
  document.getElementById('footer-counts').textContent =
    `${total} note${total === 1 ? '' : 's'} on file`;
}

// ── HELPERS ──
function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  const now = new Date();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return diffMin + ' min ago';
  if (diffHr < 24) return diffHr + ' hr ago';
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + ' days ago';
  if (diffDay < 14) return '1 week ago';
  if (diffDay < 30) return Math.floor(diffDay / 7) + ' weeks ago';
  if (diffDay < 60) return '1 month ago';
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Format the previous-month comparison date as "April 1"
function prevMonthLabel(prevIso) {
  if (!prevIso) return '';
  const d = new Date(prevIso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// Build a small trend line for hero tiles.
// higherIsBetter: true for compliance, false for counts of bad things.
// isPercent: format the delta with a % sign (compliance) vs a plain integer (counts).
function trendLine(current, prev, opts) {
  if (prev === null || prev === undefined) return '';
  const { higherIsBetter = false, isPercent = false, prevDate = '' } = opts || {};
  const delta = current - prev;
  const dateLabel = prevMonthLabel(prevDate);
  if (Math.abs(delta) < (isPercent ? 0.05 : 0.5)) {
    return `<div class="tile-trend trend-flat">No change from ${escapeHtml(dateLabel)}</div>`;
  }
  const isImprovement = higherIsBetter ? delta > 0 : delta < 0;
  const cls = isImprovement ? 'trend-good' : 'trend-bad';
  const arrow = delta > 0 ? '↑' : '↓';
  const absDelta = Math.abs(delta);
  const valStr = isPercent ? absDelta.toFixed(1) + '%' : Math.round(absDelta).toString();
  return `<div class="tile-trend ${cls}"><span class="arrow">${arrow}</span> ${valStr} from ${escapeHtml(dateLabel)}</div>`;
}

function init() {
  loadAllNotes();
  renderMasthead();
  populateArchiveFilters();
  attachNavListeners();
  attachRegionFilterListeners();
  attachArchiveFilterListeners();
  updateFooterCounts();
  handleRoute();  // initial route based on URL hash
}
async function loadDataAndInit() {
  try {
    const res = await fetch('data/dashboard_data.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    DATA = await res.json();
    init();
  } catch (err) {
    document.body.innerHTML =
      '<div style="font-family:sans-serif;padding:60px;text-align:center;color:#9B2C2C;">'
      + '<h2>Could not load dashboard data</h2>'
      + '<p>The data file is missing or failed to load. '
      + 'If the daily refresh hasn\'t run yet, push a CSV to <code>raw/</code> to trigger it.</p>'
      + '<p style="color:#666;font-size:13px;">Error: ' + err.message + '</p></div>';
  }
}
loadDataAndInit();
/**
 * Drives views/usg/worklist.ejs — GET /usg/worklist for data,
 * Socket.IO namespace /usg for live status pushes.
 * Uses Tom Select for the modality dropdown and Flatpickr for the date
 * picker (both loaded via CDN in worklist.ejs).
 */
(function () {
  const tbody = document.getElementById('worklistBody');
  const refreshBtn = document.getElementById('refreshBtn');
  const liveIndicator = document.getElementById('liveIndicator');
  const liveIndicatorInline = document.getElementById('liveIndicatorInline');
  const statusTabs = document.getElementById('statusTabs');
  const statsRow = document.getElementById('statsRow');

  let currentStatus = '';
  let allRows = []; // full result for the current modality/date filter, unfiltered by status — used for both the stat tiles and the table

  const STATUS_KEYS = ['WAITING', 'SENT_TO_MACHINE', 'IMAGES_RECEIVED', 'AI_PROCESSING', 'PENDING_REVIEW', 'COMPLETED'];

  // --- Tom Select for modality ---
  const modalitySelect = new TomSelect('#modalityFilter', {
    controlInput: null,
    onChange: load,
  });

  // --- Flatpickr for the date filter (a real calendar, not a bare <input type=date>) ---
  const datePicker = flatpickr('#dateFilter', {
    dateFormat: 'Y-m-d',
    altInput: true,
    altFormat: 'M j, Y',
    onChange: load,
  });

  function initials(name) {
    if (!name) return '?';
    const parts = name.replace(/\^/g, ' ').trim().split(/\s+/);
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }

  function statusLabel(s) {
    return (s || '').replace(/_/g, ' ');
  }

  function rowActionsFor(item) {
    if (!item.study_id) {
      return `<span class="text-muted small">Awaiting images</span>`;
    }
    const viewer = `/usg/studies/${item.study_id}/viewer`;
    const review = `/usg/studies/${item.study_id}/review`;
    if (item.status === 'PENDING_REVIEW' || item.status === 'AI_COMPLETED') {
      return `<a href="${review}" class="slu-btn slu-btn-warn"><i class="bi bi-clipboard-check"></i> Review</a>
              <a href="${viewer}" class="slu-btn slu-btn-ghost"><i class="bi bi-images"></i></a>`;
    }
    return `<a href="${viewer}" class="slu-btn slu-btn-ghost"><i class="bi bi-images"></i> Images</a>`;
  }

  function renderTable(items) {
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="slu-empty-state"><i class="bi bi-inbox"></i>No studies match this filter.</div></td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((item) => `
      <tr>
        <td>
          <div class="slu-patient-cell">
            <span class="slu-avatar">${initials(item.patient_name_dicom)}</span>
            <span>${(item.patient_name_dicom || '').replace(/\^/g, ' ')}</span>
          </div>
        </td>
        <td><span class="slu-accession">${item.accession_number}</span></td>
        <td><span class="usg-modality-badge usg-modality-${item.modality}">${item.modality}</span></td>
        <td>${item.study_description || ''}</td>
        <td>${item.scheduled_date || ''} <span class="text-muted">${(item.scheduled_time || '').slice(0, 5)}</span></td>
        <td><span class="usg-status-pill usg-status-${item.status}">${statusLabel(item.status)}</span></td>
        <td class="text-end">${rowActionsFor(item)}</td>
      </tr>
    `).join('');
  }

  function renderStats(items) {
    document.getElementById('stat-all').textContent = items.length;
    STATUS_KEYS.forEach((key) => {
      const el = document.getElementById(`stat-${key}`);
      if (el) el.textContent = items.filter((i) => i.status === key).length;
    });
  }

  function setActiveStatus(status) {
    currentStatus = status;
    statusTabs.querySelectorAll('.slu-tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.status === status);
    });
    statsRow.querySelectorAll('.slu-stat-tile').forEach((el) => {
      el.classList.toggle('active', el.dataset.status === status);
    });
    renderTable(currentStatus ? allRows.filter((r) => r.status === currentStatus) : allRows);
  }

  async function load() {
    const params = new URLSearchParams();
    if (modalitySelect.getValue()) params.set('modality', modalitySelect.getValue());
    if (datePicker.selectedDates[0]) {
      params.set('date', datePicker.formatDate(datePicker.selectedDates[0], 'Y-m-d'));
    }

    tbody.innerHTML = `<tr><td colspan="7"><div class="slu-empty-state"><i class="bi bi-hourglass-split"></i>Loading…</div></td></tr>`;
    try {
      const res = await fetch(`/usg/worklist?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load worklist');
      allRows = json.data;
      renderStats(allRows);
      renderTable(currentStatus ? allRows.filter((r) => r.status === currentStatus) : allRows);
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="slu-empty-state text-danger"><i class="bi bi-exclamation-triangle"></i>${err.message}</div></td></tr>`;
    }
  }

  statusTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-status]');
    if (btn) setActiveStatus(btn.dataset.status);
  });
  statsRow.addEventListener('click', (e) => {
    const tile = e.target.closest('.slu-stat-tile[data-status]');
    if (tile) setActiveStatus(tile.dataset.status);
  });
  refreshBtn.addEventListener('click', load);

  // --- Live updates ---
  function setLive(isLive) {
    [liveIndicator, liveIndicatorInline].forEach((el) => {
      if (!el) return;
      el.classList.toggle('offline', !isLive);
      el.innerHTML = isLive ? '<span class="dot"></span> live' : '<span class="dot"></span> offline';
    });
  }

  try {
    const socket = io('/usg');
    socket.on('connect', () => {
      setLive(true);
      socket.emit('subscribe:worklist');
    });
    socket.on('disconnect', () => setLive(false));
    ['usg:image_received', 'usg:ai_processing', 'usg:ai_completed', 'usg:ai_unavailable', 'usg:ai_skipped']
      .forEach((evt) => socket.on(evt, () => load()));
  } catch (err) {
    setLive(false);
  }

  load();
}());

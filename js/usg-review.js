/**
 * Drives views/usg/review.ejs.
 * GET /usg/studies/:id/report-fields for data,
 * POST /usg/measurements/:id/review and POST /usg/findings/:id/review
 * for the accept/modify/reject actions.
 */
(function () {
  const app = document.getElementById('app');
  const studyId = app.dataset.studyId;

  const fieldsBody = document.getElementById('fieldsBody');
  const fieldCountBadge = document.getElementById('fieldCountBadge');
  const findingsBody = document.getElementById('findingsBody');

  function confidenceBar(confidence) {
    if (confidence == null) return '<span class="text-muted small">—</span>';
    const pct = Math.max(0, Math.min(100, confidence));
    return `
      <div class="d-flex align-items-center gap-2">
        <div class="usg-confidence-bar"><span style="width:${pct}%"></span></div>
        <span class="small">${pct}%</span>
      </div>`;
  }

  function rowClassFor(status) {
    return {
      AI_SUGGESTED: 'usg-ai-suggested',
      ACCEPTED: 'usg-accepted',
      MODIFIED: 'usg-modified',
      REJECTED: 'usg-rejected',
    }[status] || '';
  }

  function renderFields(fields) {
    fieldCountBadge.textContent = `${fields.length} field${fields.length === 1 ? '' : 's'}`;
    if (!fields.length) {
      fieldsBody.innerHTML = `<tr><td colspan="6"><div class="slu-empty-state"><i class="bi bi-clipboard-x"></i>No AI-extracted measurements for this study.</div></td></tr>`;
      return;
    }
    fieldsBody.innerHTML = fields.map((f) => `
      <tr class="usg-field-row ${rowClassFor(f.reviewStatus)}" data-measurement-id="${f.measurementId}">
        <td class="text-capitalize">${f.organ.replace(/_/g, ' ')}</td>
        <td class="text-capitalize">${f.parameter.replace(/_/g, ' ')}</td>
        <td><strong>${f.displayValue}</strong></td>
        <td>${confidenceBar(f.confidence)}</td>
        <td><input type="text" class="form-control form-control-sm modify-input" placeholder="edited value…"
              ${f.reviewStatus !== 'AI_SUGGESTED' ? 'disabled' : ''}></td>
        <td class="text-end">
          ${f.reviewStatus === 'AI_SUGGESTED' ? `
            <button class="slu-btn slu-btn-ghost accept-btn" style="border-color:#16a34a; color:#16a34a;"><i class="bi bi-check-lg"></i> Accept</button>
            <button class="slu-btn slu-btn-ghost modify-btn" style="border-color:#4f46e5; color:#4f46e5;"><i class="bi bi-pencil"></i> Modify</button>
            <button class="slu-btn slu-btn-ghost reject-btn" style="border-color:#dc2626; color:#dc2626;"><i class="bi bi-x-lg"></i> Reject</button>
          ` : `<span class="badge rounded-pill text-bg-light border">${f.reviewStatus}</span>`}
        </td>
      </tr>
    `).join('');
  }

  async function postReview(measurementId, action, newValue) {
    const res = await fetch(`/usg/measurements/${measurementId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, newValue }),
    });
    return res.json();
  }

  fieldsBody.addEventListener('click', async (e) => {
    const row = e.target.closest('tr[data-measurement-id]');
    if (!row) return;
    const measurementId = row.dataset.measurementId;
    const input = row.querySelector('.modify-input');

    let action = null;
    let newValue;
    if (e.target.classList.contains('accept-btn')) action = 'accept';
    if (e.target.classList.contains('reject-btn')) action = 'reject';
    if (e.target.classList.contains('modify-btn')) {
      action = 'modify';
      newValue = input.value.trim();
      if (!newValue) {
        input.classList.add('is-invalid');
        return;
      }
      const asNumber = Number(newValue);
      newValue = Number.isNaN(asNumber) ? newValue : asNumber;
    }
    if (!action) return;

    e.target.disabled = true;
    const result = await postReview(measurementId, action, newValue);
    if (result.success) {
      load(); // re-fetch to reflect the new status/highlight
    } else {
      alert(`Failed: ${result.error}`);
      e.target.disabled = false;
    }
  });

  function renderFindings(findings) {
    if (!findings) {
      findingsBody.innerHTML = '<div class="slu-empty-state"><i class="bi bi-file-earmark-text"></i>No AI findings drafted for this study yet.</div>';
      return;
    }
    const disabled = findings.review_status !== 'AI_SUGGESTED';
    findingsBody.innerHTML = `
      <div class="mb-3 d-flex gap-2 flex-wrap">
        <span class="badge rounded-pill text-bg-light border">Severity: ${findings.severity || 'n/a'}</span>
        <span class="badge rounded-pill text-bg-light border">Confidence: ${findings.confidence != null ? findings.confidence + '%' : 'n/a'}</span>
        <span class="badge rounded-pill ${disabled ? 'text-bg-light border' : ''}" style="${disabled ? '' : 'background:#fffbeb;color:#b45309;'}">${findings.review_status}</span>
      </div>
      <label class="form-label small fw-semibold">Findings</label>
      <textarea class="form-control mb-2" rows="3" id="findingsText" ${disabled ? 'disabled' : ''}>${findings.findings_text || ''}</textarea>
      <label class="form-label small fw-semibold">Impression</label>
      <textarea class="form-control mb-2" rows="2" id="impressionText" ${disabled ? 'disabled' : ''}>${findings.impression_text || ''}</textarea>
      <label class="form-label small fw-semibold">Recommendations</label>
      <textarea class="form-control mb-3" rows="2" id="recommendationsText" ${disabled ? 'disabled' : ''}>${findings.recommendations_text || ''}</textarea>
      ${!disabled ? `
        <button class="slu-btn slu-btn-ghost" id="acceptFindingsBtn" style="border-color:#16a34a; color:#16a34a;"><i class="bi bi-check-lg"></i> Accept as-is</button>
        <button class="slu-btn slu-btn-primary" id="modifyFindingsBtn"><i class="bi bi-save"></i> Save edits</button>
        <button class="slu-btn slu-btn-ghost" id="rejectFindingsBtn" style="border-color:#dc2626; color:#dc2626;"><i class="bi bi-x-lg"></i> Reject</button>
      ` : ''}
    `;

    if (!disabled) {
      document.getElementById('acceptFindingsBtn').addEventListener('click', () => submitFindingsReview(findings.id, 'accept'));
      document.getElementById('modifyFindingsBtn').addEventListener('click', () => submitFindingsReview(findings.id, 'modify'));
      document.getElementById('rejectFindingsBtn').addEventListener('click', () => submitFindingsReview(findings.id, 'reject'));
    }
  }

  async function submitFindingsReview(findingsId, action) {
    const editedText = action === 'modify'
      ? [
        document.getElementById('findingsText').value,
        document.getElementById('impressionText').value,
        document.getElementById('recommendationsText').value,
      ].join('\n\n')
      : undefined;

    const res = await fetch(`/usg/findings/${findingsId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, editedText }),
    });
    const json = await res.json();
    if (json.success) {
      load();
    } else {
      alert(`Failed: ${json.error}`);
    }
  }

  async function load() {
    const res = await fetch(`/usg/studies/${studyId}/report-fields`);
    const json = await res.json();
    if (!json.success) {
      fieldsBody.innerHTML = `<tr><td colspan="6"><div class="slu-empty-state text-danger"><i class="bi bi-exclamation-triangle"></i>${json.error}</div></td></tr>`;
      return;
    }
    renderFields(json.fields);
    renderFindings(json.findings);
  }

  load();
}());

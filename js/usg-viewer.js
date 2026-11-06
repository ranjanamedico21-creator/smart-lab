/**
 * Drives views/usg/viewer.ejs.
 * Uses the JSON API: GET /usg/studies/:id, GET /usg/images/:id/file,
 * POST /usg/images/:id/enhance, GET /usg/enhancements/:id,
 * GET /usg/enhancements/:id/file, POST /usg/enhancements/:id/accept.
 */
(function () {
  const app = document.getElementById('app');
  const studyId = app.dataset.studyId;

  const studyHeader = document.getElementById('studyHeader');
  const studyInfoBody = document.getElementById('studyInfoBody');
  const thumbStrip = document.getElementById('thumbStrip');
  const mainImage = document.getElementById('mainImage');
  const enhancedNote = document.getElementById('enhancedNote');
  const enhanceBtn = document.getElementById('enhanceBtn');
  const enhanceStatus = document.getElementById('enhanceStatus');
  const toggleWrap = document.getElementById('toggleWrap');
  const showEnhancedToggle = document.getElementById('showEnhancedToggle');
  const acceptEnhancementBtn = document.getElementById('acceptEnhancementBtn');
  const reviewLink = document.getElementById('reviewLink');

  const enhancementTypeSelect = new TomSelect('#enhancementType', { controlInput: null });

  let images = [];
  let selectedImageId = null;
  let activeEnhancementId = null;
  let pollTimer = null;

  function originalUrl(imageId) {
    return `/usg/images/${imageId}/file`;
  }

  function renderThumbs() {
    thumbStrip.innerHTML = images.map((img) => `
      <img src="${originalUrl(img.id)}" data-image-id="${img.id}"
           class="${img.id === selectedImageId ? 'active' : ''}" />
    `).join('');
  }

  function selectImage(imageId) {
    selectedImageId = imageId;
    mainImage.src = originalUrl(imageId);
    enhancedNote.classList.add('d-none');
    showEnhancedToggle.checked = false;
    toggleWrap.style.display = 'none';
    acceptEnhancementBtn.style.display = 'none';
    activeEnhancementId = null;
    enhanceStatus.textContent = '';
    clearInterval(pollTimer);
    renderThumbs();
  }

  thumbStrip.addEventListener('click', (e) => {
    const img = e.target.closest('img[data-image-id]');
    if (img) selectImage(Number(img.dataset.imageId));
  });

  async function loadStudy() {
    const res = await fetch(`/usg/studies/${studyId}`);
    const json = await res.json();
    if (!json.success) {
      studyHeader.textContent = 'Failed to load study';
      return;
    }
    images = json.images;
    studyHeader.textContent = `${json.study.modality} study — ${json.study.image_count} image(s)`;
    studyInfoBody.innerHTML = `
      <div><strong>Study UID:</strong> ${json.study.study_instance_uid}</div>
      <div><strong>Modality:</strong> ${json.study.modality}</div>
      <div><strong>Body part:</strong> ${json.study.body_part || '—'}</div>
      <div><strong>Machine:</strong> ${json.study.machine_name || '—'}</div>
      <div><strong>Status:</strong> <span class="usg-status-pill usg-status-${json.study.status}">${json.study.status}</span></div>
    `;
    reviewLink.href = `/usg/studies/${studyId}/review`;
    reviewLink.style.display = ['AI_COMPLETED', 'PENDING_REVIEW', 'COMPLETED'].includes(json.study.status) ? '' : 'none';

    if (images.length) selectImage(images[0].id);
  }

  enhanceBtn.addEventListener('click', async () => {
    if (!selectedImageId) return;
    enhanceBtn.disabled = true;
    enhanceStatus.textContent = 'Queuing enhancement…';
    try {
      const res = await fetch(`/usg/images/${selectedImageId}/enhance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enhancementType: enhancementTypeSelect.getValue() }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      activeEnhancementId = json.enhancementId;
      enhanceStatus.textContent = 'Processing…';
      pollEnhancement();
    } catch (err) {
      enhanceStatus.textContent = `Failed: ${err.message}`;
    } finally {
      enhanceBtn.disabled = false;
    }
  });

  function pollEnhancement() {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const res = await fetch(`/usg/enhancements/${activeEnhancementId}`);
      const json = await res.json();
      if (!json.success) return;
      const row = json.data;
      if (row.status === 'DONE') {
        clearInterval(pollTimer);
        enhanceStatus.textContent = `Done (${row.enhancement_type}).`;
        toggleWrap.style.display = '';
        acceptEnhancementBtn.style.display = '';
      } else if (row.status === 'FAILED') {
        clearInterval(pollTimer);
        enhanceStatus.textContent = `Enhancement failed: ${row.error_message || 'unknown error'}`;
      } else {
        enhanceStatus.textContent = `Status: ${row.status}…`;
      }
    }, 2500);
  }

  showEnhancedToggle.addEventListener('change', () => {
    if (!activeEnhancementId) return;
    if (showEnhancedToggle.checked) {
      mainImage.src = `/usg/enhancements/${activeEnhancementId}/file`;
      enhancedNote.classList.remove('d-none');
    } else {
      mainImage.src = originalUrl(selectedImageId);
      enhancedNote.classList.add('d-none');
    }
  });

  acceptEnhancementBtn.addEventListener('click', async () => {
    if (!activeEnhancementId) return;
    acceptEnhancementBtn.disabled = true;
    try {
      const res = await fetch(`/usg/enhancements/${activeEnhancementId}/accept`, { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        acceptEnhancementBtn.textContent = 'Confirmed ✓';
      }
    } finally {
      acceptEnhancementBtn.disabled = false;
    }
  });

  // Live updates for this specific study
  try {
    const socket = io('/usg');
    socket.on('connect', () => socket.emit('subscribe:study', Number(studyId)));
    socket.on('usg:image_received', (payload) => {
      if (String(payload.studyId) === String(studyId)) loadStudy();
    });
    socket.on('usg:enhancement_completed', () => {
      if (activeEnhancementId) pollEnhancement();
    });
  } catch (err) {
    // Socket.IO not available — viewer still works, just without auto-refresh.
  }

  loadStudy();
}());

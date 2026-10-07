(function () {
  const N = Scan.N;
  const KEY = 'serienummer.puzzles.v1';
  const $ = id => document.getElementById(id);
  const screens = ['home', 'crop', 'review', 'play'];

  /* ---------- Lagring ---------- */
  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function saveAll(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { alert('Kunne ikke lagre (lagringsplassen er full?).'); return false; }
  }
  function persist(p) {
    const list = loadAll(), i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = p; else list.unshift(p);
    saveAll(list);
  }

  /* ---------- Navigasjon ---------- */
  function show(name) {
    screens.forEach(s => $('screen-' + s).hidden = s !== name);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.go;
    if (t === 'home') renderHome();
    show(t);
  }));
  function busy(text) { $('busy').hidden = !text; if (text) $('busy-text').textContent = text; }

  /* ---------- Hjem ---------- */
  function renderHome() {
    const list = loadAll(), ul = $('puzzle-list');
    ul.innerHTML = '';
    $('empty-msg').hidden = list.length > 0;
    list.forEach(p => {
      const li = document.createElement('li');
      const done = p.finals.flat().filter(Boolean).length + p.givens.flat().filter(v => v > 0).length;
      li.innerHTML = '<img alt=""><div class="info"><b></b><span></span></div><button aria-label="Slett">🗑️</button>';
      li.querySelector('img').src = p.thumb || '';
      li.querySelector('b').textContent = p.name;
      li.querySelector('span').textContent = new Date(p.created).toLocaleString('nb-NO') + ' · ' + done + '/64';
      li.addEventListener('click', () => openPlay(p.id));
      li.querySelector('button').addEventListener('click', e => {
        e.stopPropagation();
        if (confirm('Slette «' + p.name + '»?')) { saveAll(loadAll().filter(x => x.id !== p.id)); renderHome(); }
      });
      ul.appendChild(li);
    });
  }

  /* ---------- Hjørnevalg ---------- */
  let srcCanvas = null, corners = null, scale = 1, dragging = -1;
  const crop = $('crop-canvas');

  async function onFile(e) {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    busy('Laster bilde…');
    try { srcCanvas = await Scan.loadImage(f); } catch (err) { busy(); alert(err.message); return; }
    busy();
    const w = srcCanvas.width, h = srcCanvas.height;
    corners = [[.12 * w, .2 * h], [.88 * w, .2 * h], [.88 * w, .8 * h], [.12 * w, .8 * h]];
    show('crop');
    drawCrop();
  }
  $('file-camera').addEventListener('change', onFile);
  $('file-gallery').addEventListener('change', onFile);

  function drawCrop() {
    const cw = crop.parentElement.clientWidth || 360;
    scale = cw / srcCanvas.width;
    const dpr = window.devicePixelRatio || 1;
    crop.width = cw * dpr; crop.height = srcCanvas.height * scale * dpr;
    crop.style.height = srcCanvas.height * scale + 'px';
    const ctx = crop.getContext('2d');
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.drawImage(srcCanvas, 0, 0);
    ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#ff2d55';
    ctx.beginPath();
    corners.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.stroke();
    // hjelpelinjer for 8x8
    ctx.strokeStyle = 'rgba(255,45,85,.35)'; ctx.lineWidth = 1 / scale;
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    for (let i = 1; i < N; i++) {
      const t = i / N;
      let a = lerp(corners[0], corners[1], t), b = lerp(corners[3], corners[2], t);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      a = lerp(corners[0], corners[3], t); b = lerp(corners[1], corners[2], t);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
    corners.forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, 14 / scale, 0, 7);
      ctx.fillStyle = 'rgba(255,45,85,.35)'; ctx.fill();
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#ff2d55'; ctx.stroke();
    });
  }
  function ptr(e) {
    const r = crop.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale];
  }
  crop.addEventListener('pointerdown', e => {
    const [x, y] = ptr(e);
    let best = -1, bd = 60 / scale;
    corners.forEach(([cx, cy], i) => { const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = i; } });
    dragging = best;
    if (best >= 0) { crop.setPointerCapture(e.pointerId); e.preventDefault(); }
  });
  crop.addEventListener('pointermove', e => {
    if (dragging < 0) return;
    const [x, y] = ptr(e);
    corners[dragging] = [Math.max(0, Math.min(srcCanvas.width, x)), Math.max(0, Math.min(srcCanvas.height, y))];
    drawCrop();
  });
  ['pointerup', 'pointercancel'].forEach(t => crop.addEventListener(t, () => { dragging = -1; }));
  window.addEventListener('resize', () => { if (!$('screen-crop').hidden) drawCrop(); });

  /* ---------- Skanning ---------- */
  let draft = null;   // { givens, vWalls, hWalls, warped }

  $('btn-scan').addEventListener('click', async () => {
    busy('Retter opp bildet…');
    await new Promise(r => setTimeout(r, 30));
    const warped = Scan.warp(srcCanvas, corners);
    busy('Finner linjer og tall…');
    await new Promise(r => setTimeout(r, 30));
    const res = await Scan.analyze(warped, (i, n) => busy('Leser tall ' + i + '/' + n + '…'));
    busy();
    draft = { givens: res.givens, vWalls: res.vWalls, hWalls: res.hWalls, warped };
    $('review-photo').src = warped.toDataURL('image/jpeg', 0.7);
    $('puzzle-name').value = 'Oppgave ' + new Date().toLocaleDateString('nb-NO');
    $('scan-status').textContent = !res.ocrOk
      ? 'Tallgjenkjenning er ikke tilgjengelig (offline?). Sett de trykte tallene selv.'
      : res.found + ' trykte tall funnet' + (res.unknown ? ', ' + res.unknown + ' kunne ikke leses og er latt stå tomme.' : '.');
    reviewSel = null;
    renderReview(); renderReviewPicker();
    show('review');
  });

  function wallClasses(cell, r, c, v, h) {
    if (c < N - 1 && v[r][c]) cell.classList.add('tr');
    if (r < N - 1 && h[r][c]) cell.classList.add('tb');
    if (c === N - 1) cell.classList.add('c7');
    if (r === N - 1) cell.classList.add('r7');
  }

  function renderReview() {
    const g = $('review-grid'); g.innerHTML = '';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell given';
      wallClasses(cell, r, c, draft.vWalls, draft.hWalls);
      const v = draft.givens[r][c];
      cell.textContent = v > 0 ? v : '';
      if (reviewSel && reviewSel[0] === r && reviewSel[1] === c) cell.classList.add('selected');
      cell.addEventListener('click', e => reviewTap(e, cell, r, c));
      g.appendChild(cell);
    }
  }
  function reviewTap(e, cell, r, c) {
    const b = cell.getBoundingClientRect();
    const fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height, m = 0.2;
    const dists = [[fx, 'l'], [1 - fx, 'r'], [fy, 't'], [1 - fy, 'b']].sort((a, z) => a[0] - z[0]);
    if (dists[0][0] < m) {
      const d = dists[0][1];
      if (d === 'r' && c < N - 1) draft.vWalls[r][c] = !draft.vWalls[r][c];
      else if (d === 'l' && c > 0) draft.vWalls[r][c - 1] = !draft.vWalls[r][c - 1];
      else if (d === 'b' && r < N - 1) draft.hWalls[r][c] = !draft.hWalls[r][c];
      else if (d === 't' && r > 0) draft.hWalls[r - 1][c] = !draft.hWalls[r - 1][c];
      else return;
      renderReview(); return;
    }
    reviewSel = [r, c];
    renderReview(); renderReviewPicker();
  }

  let reviewSel = null;
  function renderReviewPicker() {
    $('review-picker').classList.toggle('off', !reviewSel);
    $('review-hint').textContent = reviewSel
      ? 'Rute rad ' + (reviewSel[0] + 1) + ', kolonne ' + (reviewSel[1] + 1) + '. Trykk tallet igjen for å fjerne det.'
      : 'Trykk på en rute for å sette et fast tall.';
    const box = $('review-buttons'); box.innerHTML = '';
    for (let n = 1; n <= N; n++) {
      const b = document.createElement('button');
      b.textContent = n;
      if (reviewSel && draft.givens[reviewSel[0]][reviewSel[1]] === n) b.className = 'f';
      b.addEventListener('click', () => {
        if (!reviewSel) return;
        const [r, c] = reviewSel;
        draft.givens[r][c] = draft.givens[r][c] === n ? 0 : n;
        renderReview(); renderReviewPicker();
      });
      box.appendChild(b);
    }
  }
  $('review-clear').addEventListener('click', () => {
    if (!reviewSel) return;
    draft.givens[reviewSel[0]][reviewSel[1]] = 0;
    renderReview(); renderReviewPicker();
  });

  $('btn-save').addEventListener('click', () => {
    const th = document.createElement('canvas'); th.width = th.height = 120;
    th.getContext('2d').drawImage(draft.warped, 0, 0, 120, 120);
    const p = {
      id: 'p' + Date.now().toString(36),
      name: $('puzzle-name').value.trim() || 'Oppgave',
      created: Date.now(),
      thumb: th.toDataURL('image/jpeg', 0.6),
      givens: draft.givens, vWalls: draft.vWalls, hWalls: draft.hWalls,
      marks: Array.from({ length: N }, () => Array.from({ length: N }, () => ({}))),
      finals: Array.from({ length: N }, () => new Array(N).fill(0))
    };
    persist(p);
    openPlay(p.id);
  });

  /* ---------- Spill ---------- */
  let puz = null, sel = null;

  function openPlay(id) {
    puz = loadAll().find(p => p.id === id);
    if (!puz) return;
    sel = null;
    $('play-title').textContent = puz.name;
    renderPlay(); renderPicker(); show('play');
  }

  function renderPlay() {
    const g = $('play-grid'); g.innerHTML = '';
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      wallClasses(cell, r, c, puz.vWalls, puz.hWalls);
      const given = puz.givens[r][c];
      if (given > 0) { cell.classList.add('given'); cell.textContent = given; }
      else {
        if (sel && sel[0] === r && sel[1] === c) cell.classList.add('selected');
        const f = puz.finals[r][c];
        if (f) {
          cell.innerHTML = '<span class="final"></span>';
          cell.firstChild.textContent = f;
          if (conflict(r, c, f)) cell.classList.add('conflict');
        } else {
          const m = puz.marks[r][c], box = document.createElement('div');
          box.className = 'marks';
          for (let n = 1; n <= 9; n++) {
            const s = document.createElement('span');
            if (m[n]) { s.className = m[n]; s.textContent = n; }
            box.appendChild(s);
          }
          cell.appendChild(box);
        }
        cell.addEventListener('click', () => { sel = [r, c]; renderPlay(); renderPicker(); });
      }
      g.appendChild(cell);
    }
  }

  function conflict(r, c, v) {
    for (let i = 0; i < N; i++) {
      if (i !== c && (puz.finals[r][i] === v || puz.givens[r][i] === v)) return true;
      if (i !== r && (puz.finals[i][c] === v || puz.givens[i][c] === v)) return true;
    }
    return false;
  }

  function renderPicker() {
    const pk = $('picker'), box = $('picker-buttons');
    pk.classList.toggle('off', !sel);
    $('picker-hint').textContent = sel
      ? 'Rute rad ' + (sel[0] + 1) + ', kolonne ' + (sel[1] + 1) + '. Trykk et tall flere ganger: rød → grønn → svar → av.'
      : 'Trykk på en ledig rute.';
    box.innerHTML = '';
    for (let n = 1; n <= N; n++) {
      const b = document.createElement('button');
      b.textContent = n;
      if (sel) {
        const [r, c] = sel;
        if (puz.finals[r][c] === n) b.className = 'f';
        else if (puz.marks[r][c][n]) b.className = puz.marks[r][c][n];
      }
      b.addEventListener('click', () => cycle(n));
      box.appendChild(b);
    }
  }

  function cycle(n) {
    if (!sel) return;
    const [r, c] = sel, m = puz.marks[r][c];
    if (puz.finals[r][c] === n) { puz.finals[r][c] = 0; delete m[n]; }   // svar -> av, de andre tallene vises igjen
    else {
      puz.finals[r][c] = 0;                                              // forlat svar-visning
      const st = m[n];
      if (!st) m[n] = 'r';
      else if (st === 'r') m[n] = 'g';
      else puz.finals[r][c] = n;                                         // grønn -> endelig svar (markeringene beholdes)
    }
    persist(puz); renderPlay(); renderPicker();
  }

  $('btn-clear').addEventListener('click', () => {
    if (!sel) return;
    puz.marks[sel[0]][sel[1]] = {}; puz.finals[sel[0]][sel[1]] = 0;
    persist(puz); renderPlay(); renderPicker();
  });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Fjerne alle dine markeringer og svar?')) return;
    puz.marks = Array.from({ length: N }, () => Array.from({ length: N }, () => ({})));
    puz.finals = Array.from({ length: N }, () => new Array(N).fill(0));
    persist(puz); renderPlay(); renderPicker();
  });

  renderHome();
})();

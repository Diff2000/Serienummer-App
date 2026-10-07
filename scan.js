/* Bildebehandling: retting av perspektiv, deteksjon av tykke linjer og trykte tall. */
(function () {
  const N = 8;          // 8x8 rutenett
  const CELL = 100;     // rutestørrelse i det utrettede bildet
  const SIZE = N * CELL;

  function loadImage(file, maxDim = 1800) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Kunne ikke lese bildet')); };
      img.src = url;
    });
  }

  // Løser 8x8-system (Gauss) for homografi: enhetskvadrat -> kvadrilateral.
  function homography(q) {
    // q: [[x,y] x4] i rekkefølgen TL, TR, BR, BL
    const dst = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [u, v] = dst[i], [x, y] = q[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    for (let i = 0; i < 8; i++) {
      let p = i;
      for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      for (let r = i + 1; r < 8; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < 8; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const h = new Array(8);
    for (let i = 7; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < 8; c++) s -= A[i][c] * h[c];
      h[i] = s / A[i][i];
    }
    return h;
  }

  function warp(src, corners, margin = 0) {
    const h = homography(corners);
    const sctx = src.getContext('2d');
    const sd = sctx.getImageData(0, 0, src.width, src.height);
    const out = document.createElement('canvas');
    out.width = out.height = SIZE;
    const octx = out.getContext('2d');
    const od = octx.createImageData(SIZE, SIZE);
    const sw = src.width, sh = src.height;
    for (let y = 0; y < SIZE; y++) {
      const v = (y + 0.5) / SIZE * (1 + 2 * margin) - margin;
      for (let x = 0; x < SIZE; x++) {
        const u = (x + 0.5) / SIZE * (1 + 2 * margin) - margin;
        const w = h[6] * u + h[7] * v + 1;
        const sx = (h[0] * u + h[1] * v + h[2]) / w;
        const sy = (h[3] * u + h[4] * v + h[5]) / w;
        const o = (y * SIZE + x) * 4;
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { od.data[o] = od.data[o + 1] = od.data[o + 2] = 255; od.data[o + 3] = 255; continue; }
        const fx = sx - x0, fy = sy - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        for (let k = 0; k < 3; k++) {
          od.data[o + k] = sd.data[i00 + k] * (1 - fx) * (1 - fy) + sd.data[i10 + k] * fx * (1 - fy) +
                           sd.data[i01 + k] * (1 - fx) * fy + sd.data[i11 + k] * fx * fy;
        }
        od.data[o + 3] = 255;
      }
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  // ---- Automatisk finjustering av hjørnene ----
  // Måler hvor ytterkantene faktisk ligger i det utrettede bildet og flytter hjørnene deretter.
  function fitLine(pts) {   // pts: [t, v] -> v = a + b*t, med enkel utligger-fjerning
    let use = pts;
    for (let pass = 0; pass < 2; pass++) {
      const n = use.length;
      if (n < 4) return null;
      let st = 0, sv = 0, stt = 0, stv = 0;
      for (const [t, v] of use) { st += t; sv += v; stt += t * t; stv += t * v; }
      const den = n * stt - st * st;
      if (!den) return null;
      const b = (n * stv - st * sv) / den, a = (sv - b * st) / n;
      if (pass === 1) return { a, b, n };
      const res = use.map(([t, v]) => Math.abs(v - (a + b * t)));
      const med = res.slice().sort((x, y) => x - y)[res.length >> 1];
      use = use.filter(([t, v], k) => res[k] <= Math.max(4, med * 2.5));
    }
    return null;
  }

  const MARGIN = 0.1;   // under finjustering vises 10 % utenfor rutenettet på hver side
  function edgeOffsets(ink, side, p0, p1) {
    // side: 'top' | 'bottom' | 'left' | 'right'. Returnerer punkter [langs, posisjon på tvers].
    const R = 55, pts = [];
    const horizontal = side === 'top' || side === 'bottom';
    const nominal = (side === 'top' || side === 'left') ? p0 : p1;
    const span = p1 - p0, n = 12;
    for (let k = 0; k < n; k++) {
      const t0 = Math.round(p0 + span * (0.06 + 0.88 * k / n)), t1 = t0 + Math.round(span * 0.88 / n) - 2;
      const prof = [];
      for (let o = -R; o <= R; o++) {
        const p = Math.round(nominal) + o;
        let c = 0;
        if (p >= 0 && p < SIZE) for (let t = t0; t < t1; t++) c += horizontal ? ink[p * SIZE + t] : ink[t * SIZE + p];
        prof.push(c / (t1 - t0));
      }
      let best = 0, bi = -1;
      for (let i = 1; i < prof.length - 1; i++) {
        const sc = prof[i - 1] + prof[i] + prof[i + 1];
        if (sc > best) { best = sc; bi = i; }
      }
      if (bi < 0 || best < 1.0) continue;
      pts.push([(t0 + t1) / 2, Math.round(nominal) + bi - R]);
    }
    return pts;
  }

  function refine(src, corners, iterations = 8) {
    let cs = corners.map(c => c.slice());
    const p0 = SIZE * MARGIN / (1 + 2 * MARGIN), p1 = SIZE - p0;
    for (let it = 0; it < iterations; it++) {
      const w = warp(src, cs, MARGIN);
      const ink = inkMask(lumOf(w));
      const top = fitLine(edgeOffsets(ink, 'top', p0, p1)), bottom = fitLine(edgeOffsets(ink, 'bottom', p0, p1));
      const left = fitLine(edgeOffsets(ink, 'left', p0, p1)), right = fitLine(edgeOffsets(ink, 'right', p0, p1));
      const ok = f => f && f.n >= 6 && Math.abs(f.b) < 0.06;
      if (!ok(top) && !ok(bottom) && !ok(left) && !ok(right)) break;
      const nom = v => ({ a: v, b: 0, n: 0 });
      const T = ok(top) ? top : nom(p0), B = ok(bottom) ? bottom : nom(p1);
      const Lf = ok(left) ? left : nom(p0), Rt = ok(right) ? right : nom(p1);
      const meet = (h, v) => {   // h: y = a + b x, v: x = a + b y
        const y = (h.a + h.b * v.a) / (1 - h.b * v.b);
        return [v.a + v.b * y, y];
      };
      const q = [meet(T, Lf), meet(T, Rt), meet(B, Rt), meet(B, Lf)];
      const h = homography(cs);
      cs = q.map(([x, y]) => {
        const u = x / SIZE * (1 + 2 * MARGIN) - MARGIN, v = y / SIZE * (1 + 2 * MARGIN) - MARGIN;
        const wv = h[6] * u + h[7] * v + 1;
        return [(h[0] * u + h[1] * v + h[2]) / wv, (h[3] * u + h[4] * v + h[5]) / wv];
      });
      const tgt = [[p0, p0], [p1, p0], [p1, p1], [p0, p1]];
      const move = Math.max(...q.map(([x, y], i) => Math.hypot(x - tgt[i][0], y - tgt[i][1])));
      if (move < 1.5) break;
    }
    return cs;
  }

  function lumOf(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
    const lum = new Float32Array(SIZE * SIZE), sat = new Float32Array(SIZE * SIZE), red = new Float32Array(SIZE * SIZE);
    for (let i = 0; i < lum.length; i++) {
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      lum[i] = r * 0.299 + g * 0.587 + b * 0.114;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat[i] = mx ? (mx - mn) / mx : 0;
      red[i] = r - Math.max(g, b);
    }
    return { lum, sat, red };
  }

  // Lokal terskel (tåler skygge og ujevn belysning): blekk = tydelig mørkere enn omgivelsene.
  function localMean(lum, rad) {
    const W = SIZE + 1, I = new Float64Array(W * W);
    for (let y = 0; y < SIZE; y++) {
      let row = 0;
      for (let x = 0; x < SIZE; x++) { row += lum[y * SIZE + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; }
    }
    const out = new Float32Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(SIZE, y + rad + 1);
      for (let x = 0; x < SIZE; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(SIZE, x + rad + 1);
        out[y * SIZE + x] = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      }
    }
    return out;
  }

  // Maske over "trykt blekk": lokalt mørkt og ikke rødlig/farget (håndskrift er ofte farget).
  function inkMask(L) {
    const mean = localMean(L.lum, 22);
    const ink = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < ink.length; i++) {
      if (L.lum[i] < mean[i] * 0.78 && L.lum[i] < 170 && L.sat[i] < 0.55 && L.red[i] < 42) ink[i] = 1;
    }
    return ink;
  }

  // Splitter verdier i to grupper (Otsu på 1D). Returnerer terskel.
  function split1D(vals) {
    const v = vals.slice().sort((a, b) => a - b);
    let best = -1, thr = v[v.length >> 1];
    for (let i = 1; i < v.length; i++) {
      if (v[i] === v[i - 1]) continue;
      const a = v.slice(0, i), b = v.slice(i);
      const ma = a.reduce((p, q) => p + q, 0) / a.length, mb = b.reduce((p, q) => p + q, 0) / b.length;
      const score = a.length * b.length * (mb - ma) * (mb - ma);
      if (score > best) { best = score; thr = (v[i - 1] + v[i]) / 2; }
    }
    return thr;
  }

  // For hvert linjestykke mellom to ruter: finn linjen lokalt (±SEARCH px) og mål tykkelsen.
  const SEARCH = 22;
  function segmentThickness(ink, vertical, line, from, to) {
    // line = nominell posisjon på tvers, from..to = utstrekning langs linjen
    const len = to - from, dens = [];
    for (let o = -SEARCH - 12; o <= SEARCH + 12; o++) {
      const p = line + o;
      let n = 0;
      for (let t = from; t < to; t++) n += vertical ? ink[t * SIZE + p] : ink[p * SIZE + t];
      dens.push(n / len);
    }
    // beste senter = maks glidende sum over 5 px
    let best = -1, bi = 0;
    for (let i = 2; i < dens.length - 2; i++) {
      if (Math.abs(i - (SEARCH + 12)) > SEARCH) continue;
      const sc = dens[i - 2] + dens[i - 1] + dens[i] + dens[i + 1] + dens[i + 2];
      if (sc > best) { best = sc; bi = i; }
    }
    // areal: sum av tetthet innenfor ±7 px av senteret
    let area = 0;
    for (let i = Math.max(0, bi - 7); i <= Math.min(dens.length - 1, bi + 7); i++) area += dens[i];
    return area;
  }

  function detectWalls(ink) {
    const vA = [], hA = [];
    for (let r = 0; r < N; r++) {
      vA.push([]);
      for (let c = 0; c < N - 1; c++) vA[r].push(segmentThickness(ink, true, CELL * (c + 1), CELL * r + 22, CELL * r + CELL - 22));
    }
    for (let r = 0; r < N - 1; r++) {
      hA.push([]);
      for (let c = 0; c < N; c++) hA[r].push(segmentThickness(ink, false, CELL * (r + 1), CELL * c + 22, CELL * c + CELL - 22));
    }
    const all = vA.flat().concat(hA.flat());
    const thr = Math.max(split1D(all), 4.5);
    return {
      vWalls: vA.map(row => row.map(a => a >= thr)),
      hWalls: hA.map(row => row.map(a => a >= thr)),
      thr, areas: { v: vA, h: hA }
    };
  }

  // Finner det trykte tallet i en rute: et frittstående blekk-objekt av passende størrelse som ikke berører kanten.
  function findGlyph(ink, gray, r, c) {
    const M = 9, x0 = c * CELL + M, y0 = r * CELL + M, w = CELL - 2 * M, h = CELL - 2 * M;
    const seen = new Uint8Array(w * h);
    let best = null;
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (seen[si] || !ink[(y0 + sy) * SIZE + x0 + sx]) continue;
      const stack = [si], px = [];
      seen[si] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy, edge = false;
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i / w) | 0;
        px.push(i);
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!seen[ni] && ink[(y0 + ny) * SIZE + x0 + nx]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      const bh = maxY - minY + 1, bw = maxX - minX + 1, fill = px.length / (bh * bw);
      if (edge || bh < 24 || bh > 62 || bw < 5 || bw > 48 || bw > bh * 1.4 || fill < 0.12 || px.length < 80) continue;
      if (!best || px.length > best.px.length) best = { px, minX, maxX, minY, maxY, bw, bh, x0, y0, w };
    }
    if (!best) return null;
    // Bilde til OCR: gråtoner kun rundt selve tegnet (alt annet hvitt), skalert opp med hvit kant.
    const pad = 12, scale = 90 / best.bh;
    const keep = new Uint8Array(w * h);
    for (const i of best.px) {
      const x = i % w, y = (i / w) | 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) keep[ny * w + nx] = 1;
      }
    }
    const bw2 = best.bw + pad * 2, bh2 = best.bh + pad * 2;
    const small = document.createElement('canvas'); small.width = bw2; small.height = bh2;
    const sctx = small.getContext('2d'), id = sctx.createImageData(bw2, bh2);
    let lo = 255, hi = 0;
    for (const i of best.px) { const g = gray[(best.y0 + ((i / w) | 0)) * SIZE + best.x0 + (i % w)]; if (g < lo) lo = g; if (g > hi) hi = g; }
    for (let y = 0; y < bh2; y++) for (let x = 0; x < bw2; x++) {
      const gx = best.minX - pad + x, gy = best.minY - pad + y;
      let v = 255;
      if (gx >= 0 && gy >= 0 && gx < w && gy < h && keep[gy * w + gx]) {
        const g = gray[(best.y0 + gy) * SIZE + best.x0 + gx];
        v = Math.max(0, Math.min(255, (g - lo) / Math.max(1, 200 - lo) * 255));
        v = v < 128 ? v * 0.5 : v;   // gjør streken mørkere
      }
      const o = (y * bw2 + x) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = v; id.data[o + 3] = 255;
    }
    sctx.putImageData(id, 0, 0);
    const cv = document.createElement('canvas');
    cv.width = Math.round(bw2 * scale); cv.height = Math.round(bh2 * scale);
    const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high';
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    cx.drawImage(small, 0, 0, cv.width, cv.height);
    return cv;
  }

  // Bedre (større) språkmodell enn standard gir sikrere lesing av enkelttall.
  const TESS_DEFAULT = { langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int', gzip: true };
  let tessPromise = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (!tessPromise) tessPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res(window.Tesseract);
      s.onerror = () => { tessPromise = null; rej(new Error('OCR utilgjengelig')); };
      document.head.appendChild(s);
    });
    return tessPromise;
  }

  async function analyze(warped, onProgress) {
    const L = lumOf(warped);
    const ink = inkMask(L);
    const { vWalls, hWalls, thr, areas } = detectWalls(ink);
    const givens = Array.from({ length: N }, () => new Array(N).fill(0));
    const glyphs = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const g = findGlyph(ink, L.lum, r, c);
      if (g) { glyphs.push({ r, c, g }); if (window.DEBUG_GLYPHS) window.DEBUG_GLYPHS.push([r, c, g.toDataURL()]); }
    }
    let ocrOk = true, unknown = 0;
    try {
      const T = await loadTesseract();
      const worker = await T.createWorker('eng', 1, window.TESS_OPTS || TESS_DEFAULT);
      await worker.setParameters({ tessedit_char_whitelist: '12345678', tessedit_pageseg_mode: '10' });
      for (let i = 0; i < glyphs.length; i++) {
        const { r, c, g } = glyphs[i];
        // Prøv flere tolkningsmodi og ta den sikreste. Lav sikkerhet = feil (f.eks. 5 lest som 3).
        let best = null;
        for (const mode of ['10', '8', '13']) {
          await worker.setParameters({ tessedit_pageseg_mode: mode });
          const { data } = await worker.recognize(g);
          const mm = (data.text || '').match(/[1-8]/);
          if (mm && (!best || data.confidence > best.conf)) best = { d: +mm[0], conf: data.confidence };
          if (best && best.conf >= 85) break;
        }
        const m = best && best.conf >= 40 ? [String(best.d)] : null;
        if (m) givens[r][c] = +m[0]; else unknown++;
        if (onProgress) onProgress(i + 1, glyphs.length);
      }
      await worker.terminate();
    } catch (e) {
      ocrOk = false; unknown = glyphs.length;
    }
    return { vWalls, hWalls, givens, ocrOk, unknown, found: glyphs.length, thr, areas, glyphCells: glyphs.map(g => [g.r, g.c]) };
  }

  window.Scan = { N, CELL, SIZE, loadImage, warp, refine, analyze, homography };
})();

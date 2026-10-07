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

  function warp(src, corners) {
    const h = homography(corners);
    const sctx = src.getContext('2d');
    const sd = sctx.getImageData(0, 0, src.width, src.height);
    const out = document.createElement('canvas');
    out.width = out.height = SIZE;
    const octx = out.getContext('2d');
    const od = octx.createImageData(SIZE, SIZE);
    const sw = src.width, sh = src.height;
    for (let y = 0; y < SIZE; y++) {
      const v = (y + 0.5) / SIZE;
      for (let x = 0; x < SIZE; x++) {
        const u = (x + 0.5) / SIZE;
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

  function otsu(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, thr = 128;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue;
      const wF = total - wB; if (!wF) break;
      sB += t * hist[t];
      const mB = sB / wB, mF = (sum - sB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; thr = t; }
    }
    return thr;
  }

  // Maske over "trykt blekk": mørkt og lite fargemettet (håndskrift er ofte rødlig/farget).
  function inkMask(canvas) {
    const d = canvas.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
    const lum = new Uint8Array(SIZE * SIZE), hist = new Array(256).fill(0);
    for (let i = 0; i < lum.length; i++) {
      const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
      lum[i] = l; hist[l]++;
    }
    const t = otsu(hist, lum.length) * 0.9;
    const ink = new Uint8Array(SIZE * SIZE);
    for (let i = 0; i < lum.length; i++) {
      if (lum[i] >= t) continue;
      const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx ? (mx - mn) / mx : 0;
      const reddish = r - Math.max(g, b) > 28;
      if (sat < 0.5 && !reddish) ink[i] = 1;
    }
    return ink;
  }

  function maxRun(arr, thr) {
    let best = 0, cur = 0;
    for (const v of arr) { if (v > thr) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best;
  }

  function detectWalls(ink) {
    const vWalls = [], hWalls = [];
    for (let r = 0; r < N; r++) {
      vWalls.push([]);
      for (let c = 0; c < N - 1; c++) {
        const x = CELL * (c + 1), y0 = CELL * r + 18, y1 = CELL * r + CELL - 18;
        const prof = [];
        for (let o = -7; o <= 7; o++) {
          let n = 0;
          for (let y = y0; y < y1; y++) n += ink[y * SIZE + x + o];
          prof.push(n / (y1 - y0));
        }
        vWalls[r].push(maxRun(prof, 0.55) >= 4);
      }
    }
    for (let r = 0; r < N - 1; r++) {
      hWalls.push([]);
      for (let c = 0; c < N; c++) {
        const y = CELL * (r + 1), x0 = CELL * c + 18, x1 = CELL * c + CELL - 18;
        const prof = [];
        for (let o = -7; o <= 7; o++) {
          let n = 0;
          for (let x = x0; x < x1; x++) n += ink[(y + o) * SIZE + x];
          prof.push(n / (x1 - x0));
        }
        hWalls[r].push(maxRun(prof, 0.55) >= 4);
      }
    }
    return { vWalls, hWalls };
  }

  // Finner det største tegnet i en rute (trykt tall). Returnerer canvas med tegnet, eller null.
  function findGlyph(ink, r, c) {
    const M = 10, x0 = c * CELL + M, y0 = r * CELL + M, w = CELL - 2 * M, h = CELL - 2 * M;
    const seen = new Uint8Array(w * h);
    let best = null;
    for (let sy = 0; sy < h; sy++) for (let sx = 0; sx < w; sx++) {
      const si = sy * w + sx;
      if (seen[si] || !ink[(y0 + sy) * SIZE + x0 + sx]) continue;
      const stack = [si], px = [];
      seen[si] = 1;
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      while (stack.length) {
        const i = stack.pop(), x = i % w, y = (i / w) | 0;
        px.push(i);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!seen[ni] && ink[(y0 + ny) * SIZE + x0 + nx]) { seen[ni] = 1; stack.push(ni); }
        }
      }
      const bh = maxY - minY + 1, bw = maxX - minX + 1;
      if (bh < 22 || bw < 5 || px.length < 70) continue;
      if (!best || px.length > best.px.length) best = { px, minX, maxX, minY, maxY, bw, bh };
    }
    if (!best) return null;
    const pad = 14, scale = 80 / best.bh;
    const cv = document.createElement('canvas');
    cv.width = Math.round((best.bw + pad * 2) * scale); cv.height = Math.round((best.bh + pad * 2) * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000';
    for (const i of best.px) {
      ctx.fillRect(Math.floor((i % w - best.minX + pad) * scale), Math.floor(((i / w | 0) - best.minY + pad) * scale),
        Math.ceil(scale), Math.ceil(scale));
    }
    return cv;
  }

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
    const ink = inkMask(warped);
    const { vWalls, hWalls } = detectWalls(ink);
    const givens = Array.from({ length: N }, () => new Array(N).fill(0));
    const glyphs = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
      const g = findGlyph(ink, r, c);
      if (g) glyphs.push({ r, c, g });
    }
    for (const g of glyphs) givens[g.r][g.c] = -1;   // -1 = fant et tall, men ikke lest
    let ocrOk = true, unknown = 0;
    try {
      const T = await loadTesseract();
      const worker = await T.createWorker('eng');
      await worker.setParameters({ tessedit_char_whitelist: '12345678', tessedit_pageseg_mode: '10' });
      for (let i = 0; i < glyphs.length; i++) {
        const { r, c, g } = glyphs[i];
        const { data } = await worker.recognize(g);
        const m = (data.text || '').match(/[1-8]/);
        if (m) givens[r][c] = +m[0]; else unknown++;
        if (onProgress) onProgress(i + 1, glyphs.length);
      }
      await worker.terminate();
    } catch (e) {
      ocrOk = false; unknown = glyphs.length;
    }
    return { vWalls, hWalls, givens, ocrOk, unknown, found: glyphs.length, glyphCells: glyphs.map(g => [g.r, g.c]) };
  }

  window.Scan = { N, CELL, SIZE, loadImage, warp, analyze, homography };
})();

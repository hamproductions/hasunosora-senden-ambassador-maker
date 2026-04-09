(() => {
  const OUTPUT_SIZE = 1600;
  const FRAME_SIZE = 800;
  const CIRCLE_RADIUS = OUTPUT_SIZE * 0.48;
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 4;

  const upload = document.getElementById('upload');
  const scaleInput = document.getElementById('scale');
  const rotateInput = document.getElementById('rotate');
  const tolMainInput = document.getElementById('tol-main');
  const tolDarkInput = document.getElementById('tol-dark');
  const tolFlowerInput = document.getElementById('tol-flower');
  const tolFlowerDarkInput = document.getElementById('tol-flower-dark');
  const tolResidueInput = document.getElementById('tol-residue');
  const tolMainVal = document.getElementById('tol-main-val');
  const tolDarkVal = document.getElementById('tol-dark-val');
  const tolFlowerVal = document.getElementById('tol-flower-val');
  const tolFlowerDarkVal = document.getElementById('tol-flower-dark-val');
  const tolResidueVal = document.getElementById('tol-residue-val');
  const downloadBtn = document.getElementById('download');
  const shareBtn = document.getElementById('share');
  const campaignTitleEl = document.getElementById('campaign-title');
  const campaignBodyEl = document.getElementById('campaign-body');
  const picker = document.getElementById('picker');
  const canvas = document.getElementById('canvas');
  const toneGrid = document.querySelector('.tone-grid');
  const debugPanel = document.querySelector('.debug-panel');
  const debugEnable = document.getElementById('debug-enable');
  const debugMask = document.getElementById('debug-mask');
  const debugBoxes = document.getElementById('debug-boxes');
  const debugCopy = document.getElementById('debug-copy');
  const debugReset = document.getElementById('debug-reset');
  const debugOut = document.getElementById('debug-out');
  const langJaBtn = document.getElementById('lang-ja');
  const langEnBtn = document.getElementById('lang-en');
  const ctx = canvas.getContext('2d');

  const state = {
    locale: /^ja/i.test(navigator.language || '') ? 'ja' : 'en',
    img: null,
    x: OUTPUT_SIZE / 2,
    y: OUTPUT_SIZE / 2,
    scale: 1,
    rotate: 0,
    frameIndex: 0,
    tuning: {
      tolMain: Number(tolMainInput ? tolMainInput.value : 115),
      tolDark: Number(tolDarkInput ? tolDarkInput.value : 36),
      tolFlower: Number(tolFlowerInput ? tolFlowerInput.value : 220),
      tolFlowerDark: Number(tolFlowerDarkInput ? tolFlowerDarkInput.value : 130),
      tolResidue: Number(tolResidueInput ? tolResidueInput.value : 220)
    },
    debug: {
      enabled: false,
      showMask: false,
      showBoxes: !!(debugBoxes && debugBoxes.checked),
      dragging: false,
      start: null,
      box: { x: 0.12, y: 0.62, w: 0.23, h: 0.27 }
    }
  };

  const pointers = new Map();
  let multiGesture = null;
  let rebuildTimer = null;
  let rebuildBusy = false;
  let rebuildQueued = false;
  let frames = [];
  let frameThumbs = [];
  let sourceImages = [];
  let sourceData = [];
  let currentMasks = null;
  let maskPreviewCanvas = null;
  let maskPreviewDirty = true;
  const debugMode = new URLSearchParams(location.search).get('debug') === '1';
  const RELEASE_AT = new Date('2026-05-08T00:00:00+09:00');
  const BOX_LOGO = { x: 0.2969, y: 0.6804, w: 0.4002, h: 0.2418 };
  const BOX_FLOWER_L = { x: 0.0713, y: 0.6849, w: 0.1803, h: 0.2045 };
  const BOX_FLOWER_R = { x: 0.7312, y: 0.6879, w: 0.1859, h: 0.1981 };
  const BOX_TEXT = { x: 0.1081, y: 0.0250, w: 0.7637, h: 0.2495 };
  const SAMPLE_TEMPLATE_MAIN = { x: 0.0178, y: 0.5114, w: 0.0266, h: 0.0317 };
  const SAMPLE_TEMPLATE_DARK = { x: 0.4324, y: 0.0593, w: 0.0172, h: 0.0067 };
  const SAMPLE_TARGET_MAIN = { x: 0.0175, y: 0.5221, w: 0.0189, h: 0.0180 };
  const SAMPLE_TARGET_DARK = { x: 0.4329, y: 0.0588, w: 0.0118, h: 0.0045 };

  function t(key) {
    const data = window.HASU_I18N || {};
    const lang = data[state.locale] || data.en || {};
    return lang[key] || key;
  }

  function setLocale(locale) {
    state.locale = locale === 'ja' ? 'ja' : 'en';
    document.documentElement.lang = state.locale;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.title = t('title');
    langJaBtn.classList.toggle('active', state.locale === 'ja');
    langEnBtn.classList.toggle('active', state.locale === 'en');
    updateCampaignCopy();
    rebuildPicker();
  }

  function updateCampaignCopy(now = new Date()) {
    if (!campaignTitleEl || !campaignBodyEl) return;
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const releaseDay = new Date(RELEASE_AT.getFullYear(), RELEASE_AT.getMonth(), RELEASE_AT.getDate());
    const diffDays = Math.ceil((releaseDay - today) / 86400000);
    if (diffDays > 0) {
      campaignTitleEl.textContent = t('campaignTitleCountdown').replaceAll('{days}', String(diffDays));
      campaignBodyEl.textContent = t('campaignBodyCountdown').replaceAll('{days}', String(diffDays));
      return;
    }
    campaignTitleEl.textContent = t('campaignTitleLive');
    campaignBodyEl.textContent = t('campaignBodyLive');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function getImageDataFromImage(img) {
    const c = document.createElement('canvas');
    c.width = FRAME_SIZE;
    c.height = FRAME_SIZE;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, FRAME_SIZE, FRAME_SIZE);
    return g.getImageData(0, 0, FRAME_SIZE, FRAME_SIZE);
  }

  function clamp(v) {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2;
    const dg = g1 - g2;
    const db = b1 - b2;
    return dr * dr + dg * dg + db * db;
  }

  function isNearWhite(r, g, b) {
    return r > 225 && g > 225 && b > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 34;
  }

  function isNearBlack(r, g, b) {
    return r < 26 && g < 26 && b < 40;
  }

  function luma(r, g, b) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  function rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    const d = max - min;
    if (d !== 0) {
      s = d / (1 - Math.abs(2 * l - 1));
      switch (max) {
        case rn:
          h = ((gn - bn) / d) % 6;
          break;
        case gn:
          h = (bn - rn) / d + 2;
          break;
        default:
          h = (rn - gn) / d + 4;
          break;
      }
      h /= 6;
      if (h < 0) h += 1;
    }
    return { h, s, l };
  }

  function hueToRgb(p, q, t) {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = clamp(l * 255);
      return { r: v, g: v, b: v };
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
      r: clamp(hueToRgb(p, q, h + 1 / 3) * 255),
      g: clamp(hueToRgb(p, q, h) * 255),
      b: clamp(hueToRgb(p, q, h - 1 / 3) * 255)
    };
  }

  function mixRgb(a, b, t) {
    const w = clamp01(t);
    return {
      r: clamp(a.r + (b.r - a.r) * w),
      g: clamp(a.g + (b.g - a.g) * w),
      b: clamp(a.b + (b.b - a.b) * w)
    };
  }

  function hueDistance01(a, b) {
    const d = Math.abs(a - b);
    return Math.min(d, 1 - d);
  }

  function isPinkFamilyHsl(hsl, ref, satMax, lumMax) {
    return (
      hueDistance01(hsl.h, ref.h) <= 0.055 &&
      Math.abs(hsl.s - ref.s) <= satMax &&
      Math.abs(hsl.l - ref.l) <= lumMax
    );
  }

  function toneMatchColor(sr, sg, sb, keyColor, targetColor, satScale = 0.9) {
    const src = rgbToHsl(sr, sg, sb);
    const key = rgbToHsl(keyColor.r, keyColor.g, keyColor.b);
    const target = rgbToHsl(targetColor.r, targetColor.g, targetColor.b);
    const outH = target.h;
    const outS = clamp01(target.s + (src.s - key.s) * satScale);
    const outL = clamp01(target.l + (src.l - key.l));
    return hslToRgb(outH, outS, outL);
  }

  function dominantThreeColors(imageData) {
    const d = imageData.data;
    let c1 = { r: 230, g: 165, b: 125 };
    let c2 = { r: 220, g: 120, b: 170 };
    let c3 = { r: 230, g: 70, b: 150 };

    const samples = [];
    for (let y = 0; y < FRAME_SIZE; y++) {
      if (y % 2) continue;
      for (let x = 0; x < FRAME_SIZE; x++) {
        if (x % 2) continue;
        const i = (y * FRAME_SIZE + x) * 4;
        const a = d[i + 3];
        if (a < 8) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        if (max - min < 18) continue;
        samples.push({ r, g, b });
      }
    }

    if (samples.length < 16) {
      return { main: c1, dark: c2, shadow: c3, colors: [c1, c2, c3] };
    }

    c1 = samples[0];
    c2 = samples[Math.floor(samples.length / 2)];
    c3 = samples[samples.length - 1];
    for (let iter = 0; iter < 6; iter++) {
      let aR = 0; let aG = 0; let aB = 0; let aN = 0;
      let bR = 0; let bG = 0; let bB = 0; let bN = 0;
      let cR = 0; let cG = 0; let cB = 0; let cN = 0;
      for (let n = 0; n < samples.length; n++) {
        const p = samples[n];
        const da = colorDistSq(p.r, p.g, p.b, c1.r, c1.g, c1.b);
        const db = colorDistSq(p.r, p.g, p.b, c2.r, c2.g, c2.b);
        const dc = colorDistSq(p.r, p.g, p.b, c3.r, c3.g, c3.b);
        if (da <= db && da <= dc) {
          aR += p.r; aG += p.g; aB += p.b; aN++;
        } else if (db <= da && db <= dc) {
          bR += p.r; bG += p.g; bB += p.b; bN++;
        } else {
          cR += p.r; cG += p.g; cB += p.b; cN++;
        }
      }
      if (aN) c1 = { r: aR / aN, g: aG / aN, b: aB / aN };
      if (bN) c2 = { r: bR / bN, g: bG / bN, b: bB / bN };
      if (cN) c3 = { r: cR / cN, g: cG / cN, b: cB / cN };
    }

    const arr = [c1, c2, c3].sort((a, b) => luma(b.r, b.g, b.b) - luma(a.r, a.g, a.b));
    return { main: arr[0], dark: arr[1], shadow: arr[2], colors: [c1, c2, c3] };
  }

  function sampleColorFromIndices(imageData, indices, fallback) {
    const d = imageData.data;
    let rr = 0;
    let gg = 0;
    let bb = 0;
    let ww = 0;
    for (let n = 0; n < indices.length; n++) {
      const i = indices[n];
      const a = d[i + 3];
      if (a < 8) continue;
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      if (isNearWhite(r, g, b)) continue;
      const w = a / 255;
      rr += r * w;
      gg += g * w;
      bb += b * w;
      ww += w;
    }
    if (ww <= 0) return fallback;
    return { r: rr / ww, g: gg / ww, b: bb / ww };
  }

  function sampleColorFromBox(imageData, box, fallback, mode = 'main') {
    const d = imageData.data;
    const x0 = Math.max(0, Math.floor(box.x * FRAME_SIZE));
    const y0 = Math.max(0, Math.floor(box.y * FRAME_SIZE));
    const x1 = Math.min(FRAME_SIZE - 1, Math.ceil((box.x + box.w) * FRAME_SIZE));
    const y1 = Math.min(FRAME_SIZE - 1, Math.ceil((box.y + box.h) * FRAME_SIZE));
    const samples = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * FRAME_SIZE + x) * 4;
        if (d[i + 3] < 8) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (isNearWhite(r, g, b) || isNearBlack(r, g, b)) continue;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        if (sat < (mode === 'dark' ? 8 : 14)) continue;
        samples.push({ r, g, b, sat, lum: luma(r, g, b) });
      }
    }
    if (!samples.length) return fallback;

    let pool = samples;
    if (mode === 'dark') {
      const sorted = [...samples].sort((a, b) => a.lum - b.lum);
      pool = sorted.slice(0, Math.max(6, Math.ceil(sorted.length * 0.35)));
    }

    const bins = new Map();
    for (let n = 0; n < pool.length; n++) {
      const p = pool[n];
      const qr = Math.round(p.r / 12);
      const qg = Math.round(p.g / 12);
      const qb = Math.round(p.b / 12);
      const key = `${qr}/${qg}/${qb}`;
      let bin = bins.get(key);
      if (!bin) {
        bin = { r: 0, g: 0, b: 0, n: 0, score: 0 };
        bins.set(key, bin);
      }
      bin.r += p.r;
      bin.g += p.g;
      bin.b += p.b;
      bin.n += 1;
      bin.score += mode === 'dark' ? (260 - p.lum) + p.sat * 0.35 : 1 + p.sat * 0.08;
    }

    let best = null;
    for (const bin of bins.values()) {
      if (!best || bin.score > best.score) best = bin;
    }
    if (!best || !best.n) return fallback;
    return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n };
  }

  function extractMaskIndices(templateData, keyColor, thresholdSq, regionFn) {
    const d = templateData.data;
    const idx = [];
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        if (!regionFn(x, y)) continue;
        const i = (y * FRAME_SIZE + x) * 4;
        if (d[i + 3] < 8) continue;
        if (colorDistSq(d[i], d[i + 1], d[i + 2], keyColor.r, keyColor.g, keyColor.b) <= thresholdSq) {
          idx.push(i);
        }
      }
    }
    return idx;
  }

  function extractMaskIndicesFiltered(templateData, keyColor, thresholdSq, regionFn, guardFn) {
    const d = templateData.data;
    const idx = [];
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        if (!regionFn(x, y)) continue;
        const i = (y * FRAME_SIZE + x) * 4;
        if (d[i + 3] < 8) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        if (guardFn && !guardFn(r, g, b)) continue;
        if (colorDistSq(r, g, b, keyColor.r, keyColor.g, keyColor.b) <= thresholdSq) idx.push(i);
      }
    }
    return idx;
  }

  function inBoxNorm(x, y, box) {
    const fx = x / FRAME_SIZE;
    const fy = y / FRAME_SIZE;
    return fx >= box.x && fx <= box.x + box.w && fy >= box.y && fy <= box.y + box.h;
  }

  function expandBox(box, pad) {
    return {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      w: Math.min(1, box.x + box.w + pad) - Math.max(0, box.x - pad),
      h: Math.min(1, box.y + box.h + pad) - Math.max(0, box.y - pad)
    };
  }

  function mergeIndices(...groups) {
    const hit = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
    for (let g = 0; g < groups.length; g++) {
      const arr = groups[g];
      for (let n = 0; n < arr.length; n++) {
        hit[arr[n] >> 2] = 1;
      }
    }
    const out = [];
    for (let p = 0; p < hit.length; p++) {
      if (hit[p]) out.push(p * 4);
    }
    return out;
  }

  function buildFlowerMaskFromBoxes(templateData, boxes, keyColor, thresholdSq, protectFn) {
    const d = templateData.data;
    const result = [];
    const w = FRAME_SIZE;
    const h = FRAME_SIZE;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let b = 0; b < boxes.length; b++) {
      const box = boxes[b];
      const x0 = Math.max(0, Math.floor(box.x * w));
      const y0 = Math.max(0, Math.floor(box.y * h));
      const x1 = Math.min(w - 1, Math.ceil((box.x + box.w) * w));
      const y1 = Math.min(h - 1, Math.ceil((box.y + box.h) * h));

      const visited = new Uint8Array(w * h);
      const components = [];
      const boxW = x1 - x0 + 1;
      const boxH = y1 - y0 + 1;
      const boxArea = boxW * boxH;

      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const p = y * w + x;
          if (visited[p]) continue;
          visited[p] = 1;
          const i = p * 4;
          if (d[i + 3] < 8) continue;
          if (protectFn(x, y)) continue;
          if (colorDistSq(d[i], d[i + 1], d[i + 2], keyColor.r, keyColor.g, keyColor.b) > thresholdSq) continue;

          const q = [p];
          const comp = [];
          let minX = x;
          let minY = y;
          let maxX = x;
          let maxY = y;
          for (let qi = 0; qi < q.length; qi++) {
            const cur = q[qi];
            comp.push(cur * 4);
            const cx = cur % w;
            const cy = (cur / w) | 0;
            if (cx < minX) minX = cx;
            if (cy < minY) minY = cy;
            if (cx > maxX) maxX = cx;
            if (cy > maxY) maxY = cy;
            for (let k = 0; k < dirs.length; k++) {
              const nx = cx + dirs[k][0];
              const ny = cy + dirs[k][1];
              if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
              const np = ny * w + nx;
              if (visited[np]) continue;
              visited[np] = 1;
              const ni = np * 4;
              if (d[ni + 3] < 8) continue;
              if (protectFn(nx, ny)) continue;
              if (colorDistSq(d[ni], d[ni + 1], d[ni + 2], keyColor.r, keyColor.g, keyColor.b) > thresholdSq) continue;
              q.push(np);
            }
          }
          if (comp.length > 0) {
            components.push({
              pixels: comp,
              area: comp.length,
              minX,
              minY,
              maxX,
              maxY
            });
          }
        }
      }
      let accepted = 0;
      for (let c = 0; c < components.length; c++) {
        const comp = components[c];
        const cw = comp.maxX - comp.minX + 1;
        const ch = comp.maxY - comp.minY + 1;
        const areaRatio = comp.area / boxArea;
        const lowerHalf = comp.minY >= y0 + boxH * 0.32;
        const notHuge = areaRatio <= 0.26;
        const bigEnough = areaRatio >= 0.0018 && cw >= 6 && ch >= 6;
        if (!lowerHalf || !notHuge || !bigEnough) continue;
        accepted++;
        result.push(...comp.pixels);
      }
      if (!accepted) {
        components.sort((a, b2) => b2.area - a.area);
        for (let c = 0; c < components.length; c++) {
          const comp = components[c];
          if (comp.area / boxArea > 0.45) continue;
          if (comp.minY < y0 + boxH * 0.25) continue;
          result.push(...comp.pixels);
        }
      }
    }
    return result;
  }

  function extractIndicesByPredicate(templateData, predicate) {
    const d = templateData.data;
    const idx = [];
    for (let y = 0; y < FRAME_SIZE; y++) {
      for (let x = 0; x < FRAME_SIZE; x++) {
        if (!predicate(x, y)) continue;
        const i = (y * FRAME_SIZE + x) * 4;
        if (d[i + 3] < 8) continue;
        idx.push(i);
      }
    }
    return idx;
  }

  function buildRecoloredVariant(templateData, palette, masks, templatePalette, tuning) {
    const out = document.createElement('canvas');
    out.width = FRAME_SIZE;
    out.height = FRAME_SIZE;
    const og = out.getContext('2d');
    const img = og.createImageData(FRAME_SIZE, FRAME_SIZE);
    img.data.set(templateData.data);

    const d = img.data;

    for (let n = 0; n < masks.main.length; n++) {
      const i = masks.main[n];
      const remap = toneMatchColor(
        templateData.data[i],
        templateData.data[i + 1],
        templateData.data[i + 2],
        templatePalette.main,
        palette.main,
        0.82
      );
      d[i] = remap.r;
      d[i + 1] = remap.g;
      d[i + 2] = remap.b;
    }
    for (let n = 0; n < masks.dark.length; n++) {
      const i = masks.dark[n];
      const remap = toneMatchColor(
        templateData.data[i],
        templateData.data[i + 1],
        templateData.data[i + 2],
        templatePalette.dark,
        palette.dark,
        0.9
      );
      d[i] = remap.r;
      d[i + 1] = remap.g;
      d[i + 2] = remap.b;
    }
    for (let n = 0; n < masks.shadow.length; n++) {
      const i = masks.shadow[n];
      const remap = toneMatchColor(
        templateData.data[i],
        templateData.data[i + 1],
        templateData.data[i + 2],
        templatePalette.dark,
        palette.shadow,
        0.9
      );
      d[i] = remap.r;
      d[i + 1] = remap.g;
      d[i + 2] = remap.b;
    }
    for (let n = 0; n < masks.flowerMain.length; n++) {
      const i = masks.flowerMain[n];
      d[i] = clamp(palette.main.r);
      d[i + 1] = clamp(palette.main.g);
      d[i + 2] = clamp(palette.main.b);
    }
    for (let n = 0; n < masks.flowerDark.length; n++) {
      const i = masks.flowerDark[n];
      const remap = toneMatchColor(
        templateData.data[i],
        templateData.data[i + 1],
        templateData.data[i + 2],
        templatePalette.dark,
        palette.dark,
        0.92
      );
      d[i] = remap.r;
      d[i + 1] = remap.g;
      d[i + 2] = remap.b;
    }

    const logoHit = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
    for (let n = 0; n < masks.logo.length; n++) {
      logoHit[masks.logo[n] >> 2] = 1;
    }
    const templateMainHsl = rgbToHsl(templatePalette.main.r, templatePalette.main.g, templatePalette.main.b);
    const templateDarkHsl = rgbToHsl(templatePalette.dark.r, templatePalette.dark.g, templatePalette.dark.b);
    const residueMainTol = Math.min(255, tuning.tolMain + tuning.tolResidue * 0.72);
    const residueDarkTol = Math.min(255, tuning.tolDark + 16 + tuning.tolResidue * 0.9);
    const residueMainTolSq = residueMainTol * residueMainTol;
    const residueDarkTolSq = residueDarkTol * residueDarkTol;
    const liveSatMain = 0.08 + clamp01(tuning.tolResidue / 220) * 0.18;
    const liveSatDark = 0.09 + clamp01(tuning.tolResidue / 220) * 0.2;
    const liveLumMain = 0.11 + clamp01(tuning.tolResidue / 220) * 0.18;
    const liveLumDark = 0.12 + clamp01(tuning.tolResidue / 220) * 0.2;
    for (let p = 0; p < FRAME_SIZE * FRAME_SIZE; p++) {
      if (logoHit[p]) continue;
      const i = p * 4;
      if (d[i + 3] < 8) continue;
      const sr = templateData.data[i];
      const sg = templateData.data[i + 1];
      const sb = templateData.data[i + 2];
      const cr = d[i];
      const cg = d[i + 1];
      const cb = d[i + 2];
      if (isNearWhite(cr, cg, cb) || isNearBlack(cr, cg, cb)) continue;
      const currentHsl = rgbToHsl(cr, cg, cb);
      const mainDistSq = colorDistSq(sr, sg, sb, templatePalette.main.r, templatePalette.main.g, templatePalette.main.b);
      const darkDistSq = colorDistSq(sr, sg, sb, templatePalette.dark.r, templatePalette.dark.g, templatePalette.dark.b);
      const currentLooksPinkMain = isPinkFamilyHsl(currentHsl, templateMainHsl, liveSatMain, liveLumMain);
      const currentLooksPinkDark = isPinkFamilyHsl(currentHsl, templateDarkHsl, liveSatDark, liveLumDark);
      if (
        mainDistSq <= residueMainTolSq &&
        currentLooksPinkMain
      ) {
        const remap = toneMatchColor(sr, sg, sb, templatePalette.main, palette.main, 0.86);
        const match = clamp01(1 - Math.sqrt(mainDistSq) / Math.max(1, residueMainTol));
        const blend = mixRgb(
          { r: cr, g: cg, b: cb },
          remap,
          0.5 + match * 0.24
        );
        d[i] = blend.r;
        d[i + 1] = blend.g;
        d[i + 2] = blend.b;
        continue;
      }
      if (
        darkDistSq <= residueDarkTolSq &&
        currentLooksPinkDark
      ) {
        const remap = toneMatchColor(sr, sg, sb, templatePalette.dark, palette.dark, 0.92);
        const match = clamp01(1 - Math.sqrt(darkDistSq) / Math.max(1, residueDarkTol));
        const blend = mixRgb(
          { r: cr, g: cg, b: cb },
          remap,
          0.54 + match * 0.22
        );
        d[i] = blend.r;
        d[i + 1] = blend.g;
        d[i + 2] = blend.b;
      }
    }

    for (let n = 0; n < masks.logo.length; n++) {
      const i = masks.logo[n];
      d[i] = templateData.data[i];
      d[i + 1] = templateData.data[i + 1];
      d[i + 2] = templateData.data[i + 2];
    }

    og.putImageData(img, 0, 0);
    return out;
  }

  function buildMasks(baseData, tuning) {
    const templateMain = sampleColorFromBox(baseData, SAMPLE_TEMPLATE_MAIN, { r: 244, g: 143, b: 190 }, 'main');
    const templateDark = sampleColorFromBox(baseData, SAMPLE_TEMPLATE_DARK, { r: 238, g: 112, b: 163 }, 'dark');
    const logoCoreBox = BOX_LOGO;
    const protectLogo = (x, y) => inBoxNorm(x, y, logoCoreBox);
    const textRegion = (x, y) => inBoxNorm(x, y, BOX_TEXT) && !protectLogo(x, y);

    const mainBase = extractMaskIndicesFiltered(
      baseData,
      templateMain,
      tuning.tolMain * tuning.tolMain,
      (x, y) => !protectLogo(x, y),
      (r, g, b) => !isNearWhite(r, g, b) && !isNearBlack(r, g, b) && (Math.max(r, g, b) - Math.min(r, g, b)) >= 10
    );
    const main = mainBase;
    const dark = extractMaskIndices(
      baseData,
      templateDark,
      tuning.tolDark * tuning.tolDark,
      textRegion
    );
    const shadow = extractMaskIndices(
      baseData,
      templateDark,
      Math.min(255 * 255, (tuning.tolDark + 28) * (tuning.tolDark + 28)),
      textRegion
    );
    const flowerTolSq = Math.min(255 * 255, (tuning.tolFlower * 1.45) * (tuning.tolFlower * 1.45));
    const flowerDarkTolSq = Math.min(255 * 255, (tuning.tolFlowerDark * 1.45) * (tuning.tolFlowerDark * 1.45));
    const flowerMain = buildFlowerMaskFromBoxes(
      baseData,
      [BOX_FLOWER_L, BOX_FLOWER_R],
      templateMain,
      flowerTolSq,
      protectLogo
    );
    const flowerDark = buildFlowerMaskFromBoxes(
      baseData,
      [BOX_FLOWER_L, BOX_FLOWER_R],
      templateDark,
      flowerDarkTolSq,
      protectLogo
    );
    const logoCore = extractIndicesByPredicate(baseData, (x, y) => inBoxNorm(x, y, logoCoreBox));

    return {
      masks: {
        main,
        dark,
        shadow,
        flowerMain,
        flowerDark,
        logo: logoCore
      },
      templateMain,
      templateDark
    };
  }

  function buildFrames() {
    const list = [];
    if (!sourceData.length) return list;
    const baseData = sourceData[0];
    const base = document.createElement('canvas');
    base.width = FRAME_SIZE;
    base.height = FRAME_SIZE;
    base.getContext('2d').putImageData(baseData, 0, 0);
    list.push(base);

    const { masks, templateMain, templateDark } = buildMasks(baseData, state.tuning);
    currentMasks = masks;
    maskPreviewDirty = true;

    for (let i = 1; i < sourceData.length; i++) {
      const srcData = sourceData[i];
      const dark = sampleColorFromBox(srcData, SAMPLE_TARGET_DARK, templateDark, 'dark');
      const palette = {
        main: sampleColorFromBox(srcData, SAMPLE_TARGET_MAIN, templateMain, 'main'),
        dark,
        shadow: dark
      };
      list.push(buildRecoloredVariant(baseData, palette, masks, { main: templateMain, dark: templateDark }, state.tuning));
    }
    return list;
  }

  function drawUserImage(targetCtx = ctx) {
    if (!state.img) {
      targetCtx.save();
      targetCtx.strokeStyle = 'rgba(134, 125, 117, 0.65)';
      targetCtx.lineWidth = 3;
      targetCtx.setLineDash([18, 14]);
      targetCtx.beginPath();
      targetCtx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
      targetCtx.stroke();
      targetCtx.restore();
      return;
    }

    const fit = Math.max(OUTPUT_SIZE / state.img.width, OUTPUT_SIZE / state.img.height);
    const w = state.img.width * fit;
    const h = state.img.height * fit;

    targetCtx.save();
    targetCtx.beginPath();
    targetCtx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
    targetCtx.clip();
    targetCtx.translate(state.x, state.y);
    targetCtx.rotate((state.rotate * Math.PI) / 180);
    targetCtx.scale(state.scale, state.scale);
    targetCtx.drawImage(state.img, -w / 2, -h / 2, w, h);
    targetCtx.restore();
  }

  function drawHardcodedBoxes() {
    const boxes = [
      { label: 'BOX_LOGO', box: BOX_LOGO, color: '#ff5f87' },
      { label: 'BOX_FLOWER_L', box: BOX_FLOWER_L, color: '#ffd84d' },
      { label: 'BOX_FLOWER_R', box: BOX_FLOWER_R, color: '#ffd84d' },
      { label: 'BOX_TEXT', box: BOX_TEXT, color: '#57d4ff' },
      { label: 'SAMPLE_TEMPLATE_MAIN', box: SAMPLE_TEMPLATE_MAIN, color: '#8dff73' },
      { label: 'SAMPLE_TEMPLATE_DARK', box: SAMPLE_TEMPLATE_DARK, color: '#4effb9' },
      { label: 'SAMPLE_TARGET_MAIN', box: SAMPLE_TARGET_MAIN, color: '#b98cff' },
      { label: 'SAMPLE_TARGET_DARK', box: SAMPLE_TARGET_DARK, color: '#ff9a57' },
    ];

    ctx.save();
    ctx.font = '600 18px sans-serif';
    ctx.textBaseline = 'top';
    for (let n = 0; n < boxes.length; n++) {
      const item = boxes[n];
      const x = item.box.x * OUTPUT_SIZE;
      const y = item.box.y * OUTPUT_SIZE;
      const w = item.box.w * OUTPUT_SIZE;
      const h = item.box.h * OUTPUT_SIZE;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);

      const textW = ctx.measureText(item.label).width;
      const tagW = textW + 12;
      const tagH = 24;
      const tagX = Math.max(0, Math.min(OUTPUT_SIZE - tagW, x + 2));
      const tagY = Math.max(0, y - tagH - 2);
      ctx.fillStyle = 'rgba(8, 12, 24, 0.9)';
      ctx.fillRect(tagX, tagY, tagW, tagH);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(tagX, tagY, tagW, tagH);
      ctx.fillStyle = item.color;
      ctx.fillText(item.label, tagX + 6, tagY + 4);
    }
    ctx.restore();
  }

  function renderFrame(targetCtx = ctx) {
    targetCtx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    drawUserImage(targetCtx);
    const frame = frames[state.frameIndex];
    if (frame) targetCtx.drawImage(frame, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  }

  function render() {
    renderFrame(ctx);
    if (state.debug.showMask && currentMasks) {
      if (!maskPreviewCanvas || maskPreviewDirty) {
        const c = document.createElement('canvas');
        c.width = FRAME_SIZE;
        c.height = FRAME_SIZE;
        const cg = c.getContext('2d');
        const img = cg.createImageData(FRAME_SIZE, FRAME_SIZE);
        const d = img.data;
        const fill = (arr, a) => {
          for (let n = 0; n < arr.length; n++) {
            const i = arr[n];
            d[i] = 226;
            d[i + 1] = 226;
            d[i + 2] = 226;
            d[i + 3] = Math.max(d[i + 3], a);
          }
        };
        fill(currentMasks.main || [], 116);
        fill(currentMasks.dark || [], 136);
        fill(currentMasks.shadow || [], 158);
        fill(currentMasks.flowerMain || [], 188);
        fill(currentMasks.flowerDark || [], 168);
        fill(currentMasks.logo || [], 210);
        cg.putImageData(img, 0, 0);
        maskPreviewCanvas = c;
        maskPreviewDirty = false;
      }
      ctx.drawImage(maskPreviewCanvas, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    }
    if (state.debug.showBoxes) drawHardcodedBoxes();

    if (state.debug.enabled) {
      const b = state.debug.box;
      const x = b.x * OUTPUT_SIZE;
      const y = b.y * OUTPUT_SIZE;
      const w = b.w * OUTPUT_SIZE;
      const h = b.h * OUTPUT_SIZE;
      ctx.save();
      ctx.strokeStyle = '#3cf';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      ctx.fillStyle = '#3cf';
      ctx.fillRect(x - 4, y - 4, 8, 8);
      ctx.restore();
    }
  }

  function updateDebugOut() {
    if (!debugOut) return;
    const b = state.debug.box;
    debugOut.textContent = JSON.stringify({
      x: Number(b.x.toFixed(4)),
      y: Number(b.y.toFixed(4)),
      w: Number(b.w.toFixed(4)),
      h: Number(b.h.toFixed(4))
    });
  }

  function updateTuningOut() {
    if (tolMainVal) tolMainVal.textContent = String(state.tuning.tolMain);
    if (tolDarkVal) tolDarkVal.textContent = String(state.tuning.tolDark);
    if (tolFlowerVal) tolFlowerVal.textContent = String(state.tuning.tolFlower);
    if (tolFlowerDarkVal) tolFlowerDarkVal.textContent = String(state.tuning.tolFlowerDark);
    if (tolResidueVal) tolResidueVal.textContent = String(state.tuning.tolResidue);
  }

  async function initSourceFrames() {
    sourceImages = await Promise.all(window.HASU_FRAMES.map(loadImage));
    sourceData = sourceImages.map(getImageDataFromImage);
  }

  function applyFrameSet(nextFrames) {
    frames = nextFrames;
    if (state.frameIndex >= frames.length) state.frameIndex = 0;
    maskPreviewDirty = true;
    buildThumbs();
    rebuildPicker();
    render();
  }

  async function rebuildFrames() {
    if (rebuildBusy) {
      rebuildQueued = true;
      return;
    }
    rebuildBusy = true;
    const next = buildFrames();
    applyFrameSet(next);
    rebuildBusy = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      await rebuildFrames();
    }
  }

  function scheduleRebuild() {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      rebuildFrames();
    }, 120);
  }

  function buildThumbs() {
    frameThumbs = frames.map((frame) => {
      const t = document.createElement('canvas');
      t.width = 192;
      t.height = 192;
      const tg = t.getContext('2d');
      tg.imageSmoothingEnabled = true;
      tg.imageSmoothingQuality = 'high';
      tg.drawImage(frame, 0, 0, 192, 192);
      return t.toDataURL('image/png');
    });
  }

  function rebuildPicker() {
    picker.innerHTML = '';
    frames.forEach((frame, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick' + (i === state.frameIndex ? ' active' : '');
      b.setAttribute('aria-label', `${t('frameLabel')} ${i + 1}`);

      const img = document.createElement('img');
      img.src = frameThumbs[i];
      img.alt = `${t('frameLabel')} ${i + 1}`;
      b.appendChild(img);

      b.addEventListener('click', () => {
        state.frameIndex = i;
        picker.querySelectorAll('.pick').forEach((el, idx) => {
          el.classList.toggle('active', idx === i);
        });
        render();
      });

      picker.appendChild(b);
    });
  }

  function resetTransform() {
    state.x = OUTPUT_SIZE / 2;
    state.y = OUTPUT_SIZE / 2;
    state.scale = 1;
    state.rotate = 0;
    scaleInput.value = '1';
    rotateInput.value = '0';
  }

  function canvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((evt.clientX - rect.left) / rect.width) * OUTPUT_SIZE,
      y: ((evt.clientY - rect.top) / rect.height) * OUTPUT_SIZE
    };
  }

  function setScale(nextScale, anchor = null) {
    const prevScale = state.scale;
    const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale));
    if (!anchor || !state.img || prevScale === next) {
      state.scale = next;
      scaleInput.value = String(next);
      return;
    }
    const rad = (state.rotate * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = anchor.x - state.x;
    const dy = anchor.y - state.y;
    const localX = (cos * dx + sin * dy) / prevScale;
    const localY = (-sin * dx + cos * dy) / prevScale;
    state.scale = next;
    state.x = anchor.x - ((cos * localX - sin * localY) * next);
    state.y = anchor.y - ((sin * localX + cos * localY) * next);
    scaleInput.value = String(next);
  }

  function readTwoPointers() {
    const vals = [...pointers.values()];
    if (vals.length < 2) return null;
    const p1 = vals[0];
    const p2 = vals[1];
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    return {
      centerX: cx,
      centerY: cy,
      distance: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx)
    };
  }

  canvas.addEventListener('pointerdown', (evt) => {
    if (state.debug.enabled) {
      const p = canvasPoint(evt);
      state.debug.dragging = true;
      state.debug.start = { x: p.x / OUTPUT_SIZE, y: p.y / OUTPUT_SIZE };
      state.debug.box = { x: state.debug.start.x, y: state.debug.start.y, w: 0.001, h: 0.001 };
      updateDebugOut();
      render();
      return;
    }
    if (!state.img) return;
    const p = canvasPoint(evt);
    pointers.set(evt.pointerId, p);
    canvas.setPointerCapture(evt.pointerId);

    if (pointers.size === 2) {
      const g = readTwoPointers();
      if (g) {
        multiGesture = {
          centerX: g.centerX,
          centerY: g.centerY,
          x: state.x,
          y: state.y,
          scale: state.scale,
          rotate: state.rotate,
          distance: g.distance,
          angle: g.angle
        };
      }
    }
  });

  canvas.addEventListener('pointermove', (evt) => {
    if (state.debug.enabled && state.debug.dragging && state.debug.start) {
      const p = canvasPoint(evt);
      const x1 = p.x / OUTPUT_SIZE;
      const y1 = p.y / OUTPUT_SIZE;
      const x0 = state.debug.start.x;
      const y0 = state.debug.start.y;
      state.debug.box = {
        x: Math.max(0, Math.min(1, Math.min(x0, x1))),
        y: Math.max(0, Math.min(1, Math.min(y0, y1))),
        w: Math.max(0.001, Math.min(1, Math.abs(x1 - x0))),
        h: Math.max(0.001, Math.min(1, Math.abs(y1 - y0)))
      };
      updateDebugOut();
      render();
      return;
    }
    if (!state.img || !pointers.has(evt.pointerId)) return;
    const prev = pointers.get(evt.pointerId);
    const p = canvasPoint(evt);
    pointers.set(evt.pointerId, p);

    if (pointers.size >= 2 && multiGesture) {
      const g = readTwoPointers();
      if (!g) return;
      state.x = multiGesture.x + (g.centerX - multiGesture.centerX);
      state.y = multiGesture.y + (g.centerY - multiGesture.centerY);
      state.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, multiGesture.scale * (g.distance / Math.max(1, multiGesture.distance))));
      state.rotate = multiGesture.rotate + ((g.angle - multiGesture.angle) * 180 / Math.PI);
      scaleInput.value = String(state.scale);
      rotateInput.value = String(state.rotate);
      render();
      return;
    }

    if (pointers.size === 1) {
      if (!prev) return;
      state.x += p.x - prev.x;
      state.y += p.y - prev.y;
      render();
    }
  });

  function endPointer(evt) {
    if (state.debug.enabled) {
      state.debug.dragging = false;
      state.debug.start = null;
      updateDebugOut();
      return;
    }
    pointers.delete(evt.pointerId);
    if (canvas.hasPointerCapture(evt.pointerId)) canvas.releasePointerCapture(evt.pointerId);
    if (pointers.size < 2) multiGesture = null;
  }

  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', endPointer);
  canvas.addEventListener('wheel', (evt) => {
    if (!state.img || state.debug.enabled) return;
    evt.preventDefault();
    setScale(state.scale * Math.exp(-evt.deltaY * 0.0015), canvasPoint(evt));
    render();
  }, { passive: false });
  picker.addEventListener('wheel', (evt) => {
    const dx = Math.abs(evt.deltaX);
    const dy = Math.abs(evt.deltaY);
    if (!dx && !dy) return;
    if (dx > dy) return;
    evt.preventDefault();
    picker.scrollLeft += evt.deltaY;
  }, { passive: false });

  upload.addEventListener('change', async () => {
    const file = upload.files && upload.files[0];
    if (!file) return;
    const src = URL.createObjectURL(file);
    state.img = await loadImage(src);
    URL.revokeObjectURL(src);
    resetTransform();
    render();
  });

  scaleInput.addEventListener('input', () => {
    setScale(Number(scaleInput.value));
    render();
  });

  rotateInput.addEventListener('input', () => {
    state.rotate = Number(rotateInput.value);
    render();
  });

  if (tolMainInput) {
    tolMainInput.addEventListener('input', () => {
      state.tuning.tolMain = Number(tolMainInput.value);
      updateTuningOut();
      scheduleRebuild();
    });
  }
  if (tolDarkInput) {
    tolDarkInput.addEventListener('input', () => {
      state.tuning.tolDark = Number(tolDarkInput.value);
      updateTuningOut();
      scheduleRebuild();
    });
  }
  if (tolFlowerInput) {
    tolFlowerInput.addEventListener('input', () => {
      state.tuning.tolFlower = Number(tolFlowerInput.value);
      updateTuningOut();
      scheduleRebuild();
    });
  }
  if (tolFlowerDarkInput) {
    tolFlowerDarkInput.addEventListener('input', () => {
      state.tuning.tolFlowerDark = Number(tolFlowerDarkInput.value);
      updateTuningOut();
      scheduleRebuild();
    });
  }
  if (tolResidueInput) {
    tolResidueInput.addEventListener('input', () => {
      state.tuning.tolResidue = Number(tolResidueInput.value);
      updateTuningOut();
      scheduleRebuild();
    });
  }

  downloadBtn.addEventListener('click', () => {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('filePrefix')}-${state.frameIndex + 1}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  });

  shareBtn.addEventListener('click', () => {
    const text = encodeURIComponent(t('tweet'));
    const url = encodeURIComponent(location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener,noreferrer');
  });

  langJaBtn.addEventListener('click', () => setLocale('ja'));
  langEnBtn.addEventListener('click', () => setLocale('en'));

  if (debugPanel && debugMode) {
    debugPanel.hidden = false;
  }
  if (toneGrid && debugMode) {
    toneGrid.hidden = false;
  }
  if (!debugMode) {
    state.debug.enabled = false;
    state.debug.showMask = false;
    state.debug.showBoxes = false;
  }

  if (debugEnable) {
    debugEnable.addEventListener('change', () => {
      state.debug.enabled = !!debugEnable.checked;
      updateDebugOut();
      render();
    });
  }
  if (debugMask) {
    debugMask.addEventListener('change', () => {
      state.debug.showMask = !!debugMask.checked;
      render();
    });
  }
  if (debugBoxes) {
    debugBoxes.addEventListener('change', () => {
      state.debug.showBoxes = !!debugBoxes.checked;
      render();
    });
  }
  if (debugReset) {
    debugReset.addEventListener('click', () => {
      state.debug.box = { x: 0.12, y: 0.62, w: 0.23, h: 0.27 };
      updateDebugOut();
      render();
    });
  }
  if (debugCopy) {
    debugCopy.addEventListener('click', async () => {
      const text = debugOut ? debugOut.textContent : '';
      try {
        await navigator.clipboard.writeText(text);
      } catch {}
    });
  }

  (async () => {
    await initSourceFrames();
    applyFrameSet(buildFrames());
    setLocale(state.locale);
    updateCampaignCopy();
    updateTuningOut();
    updateDebugOut();
    render();
  })();
})();

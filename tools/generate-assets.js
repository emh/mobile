// Generates all PWA / favicon / social assets for Mobile with no external image
// tooling — a manual PNG encoder (raw RGBA → zlib → IHDR/IDAT/IEND) plus a tiny
// software rasteriser (alpha-composited circles + capsule strokes), supersampled
// 4× for anti-aliasing. Run: `node tools/generate-assets.js`
const zlib = require("zlib"), fs = require("fs"), path = require("path");

const OUT = path.join(__dirname, "..");

// ── Palette ──────────────────────────────────────────────────────────────────
const PAPER = [0xF4, 0xF1, 0xEA];
const INK   = [0x11, 0x11, 0x11];
const RED   = [0xCC, 0x22, 0x00];
const BLUE  = [0x00, 0x33, 0xAA];
const YELL  = [0xF5, 0xC4, 0x00];

// ── PNG encoder (RGBA buffer → PNG bytes) ──────────────────────────────────────
const crcTable = (() => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, buf) { const len = Buffer.alloc(4); len.writeUInt32BE(buf.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, buf]))); return Buffer.concat([len, t, buf, crc]); }
function encodePng(width, height, rgba) {
  const stride = 1 + width * 4, raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// ── Software canvas (opaque, alpha-composited) ─────────────────────────────────
function Canvas(w, h, bg, alphaBg) {
  const data = Buffer.alloc(w * h * 4);
  const transparent = !!alphaBg;
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2];
    data[i * 4 + 3] = transparent ? 0 : 255;
  }
  const blend = (x, y, c, a) => {
    if (x < 0 || y < 0 || x >= w || y >= h || a <= 0) return;
    const i = (y * w + x) * 4;
    if (transparent && data[i + 3] === 0) {           // painting onto empty pixel
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = Math.round(a * 255);
      return;
    }
    data[i]     = Math.round(c[0] * a + data[i]     * (1 - a));
    data[i + 1] = Math.round(c[1] * a + data[i + 1] * (1 - a));
    data[i + 2] = Math.round(c[2] * a + data[i + 2] * (1 - a));
    data[i + 3] = Math.max(data[i + 3], Math.round(a * 255));
  };
  const circle = (cx, cy, r, c, a = 1) => {
    a = a === undefined ? 1 : a;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) blend(x, y, c, a);
  };
  const seg = (x1, y1, x2, y2, hw, c, a = 1) => {     // capsule (round-capped segment)
    const minx = Math.floor(Math.min(x1, x2) - hw), maxx = Math.ceil(Math.max(x1, x2) + hw);
    const miny = Math.floor(Math.min(y1, y2) - hw), maxy = Math.ceil(Math.max(y1, y2) + hw);
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const px = x + 0.5 - x1, py = y + 0.5 - y1;
      let t = (px * dx + py * dy) / len2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(px - dx * t, py - dy * t) <= hw) blend(x, y, c, a);
    }
  };
  // Quadratic bow from (x1,y1) to (x2,y2) with mid control offset (cy + bow).
  const bow = (x1, y1, x2, y2, b, hw, c, a = 1) => {
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 + b, N = 48;
    let px = x1, py = y1;
    for (let i = 1; i <= N; i++) {
      const t = i / N, mt = 1 - t;
      const qx = mt * mt * x1 + 2 * mt * t * cx + t * t * x2;
      const qy = mt * mt * y1 + 2 * mt * t * cy + t * t * y2;
      seg(px, py, qx, qy, hw, c, a); px = qx; py = qy;
    }
  };
  return { w, h, data, blend, circle, seg, bow };
}

// Box-downsample a supersampled canvas (×s) to target w×h.
function downsample(big, w, h, s) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
      const i = ((y * s + yy) * big.w + (x * s + xx)) * 4;
      r += big.data[i]; g += big.data[i + 1]; b += big.data[i + 2]; a += big.data[i + 3];
    }
    const n = s * s, o = (y * w + x) * 4;
    out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
  }
  return out;
}

// ── The mobile motif ───────────────────────────────────────────────────────────
// Drawn in a 120-unit logical box; `scale` shrinks it toward the centre (for the
// maskable safe zone). Mirrors favicon.svg: top rod, red disc left, sub-rod right
// carrying blue + yellow discs.
function drawMobile(cv, U /* units→px */, scale, transparent) {
  const cxc = 60, cyc = 56;                          // logical centre of content
  const M = (x, y) => [(cxc + (x - cxc) * scale) * U, (cyc + (y - cyc) * scale) * U];
  const px = (n) => n * U * scale;
  const ink = (a) => INK;
  const lw = 1.1, rw = 2.2, sw = 0.8;                // string / rod / sub-rod half-widths (logical)

  // ceiling string
  let a, b;
  [a, b] = [M(54, 14), M(54, 28)]; cv.seg(a[0], a[1], b[0], b[1], px(lw), INK, 0.55);
  // top rod (slight downward bow)
  [a, b] = [M(28, 28), M(80, 28)]; cv.bow(a[0], a[1], b[0], b[1], px(2.5), px(rw), INK, 1);
  // left arm string + red disc
  [a, b] = [M(28, 28), M(28, 44)]; cv.seg(a[0], a[1], b[0], b[1], px(lw), INK, 0.55);
  { const c = M(28, 57); cv.circle(c[0], c[1], px(12), INK, 1); cv.circle(c[0], c[1], px(11), RED, 1); }
  // right arm string + sub-rod
  [a, b] = [M(80, 28), M(80, 42)]; cv.seg(a[0], a[1], b[0], b[1], px(lw), INK, 0.55);
  [a, b] = [M(66, 42), M(98, 42)]; cv.bow(a[0], a[1], b[0], b[1], px(1.8), px(sw + rw * 0.55), INK, 1);
  // sub-left string + blue disc
  [a, b] = [M(66, 42), M(66, 54)]; cv.seg(a[0], a[1], b[0], b[1], px(lw), INK, 0.55);
  { const c = M(66, 64); cv.circle(c[0], c[1], px(9), INK, 1); cv.circle(c[0], c[1], px(8.2), BLUE, 1); }
  // sub-right string + yellow disc
  [a, b] = [M(98, 42), M(98, 52)]; cv.seg(a[0], a[1], b[0], b[1], px(lw), INK, 0.55);
  { const c = M(98, 60); cv.circle(c[0], c[1], px(7.5), INK, 1); cv.circle(c[0], c[1], px(6.8), YELL, 1); }
}

function renderIcon(size, { scale = 1, transparent = false } = {}) {
  const s = 4, big = Canvas(size * s, size * s, transparent ? PAPER : PAPER, transparent);
  big.U = (size * s) / 120;
  drawMobile(big, big.U, scale, transparent);
  return encodePng(size, size, downsample(big, size, size, s));
}

// ── 5×7 block font (for the OG wordmark) ───────────────────────────────────────
const FONT = {
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "/": ["00001", "00001", "00010", "00100", "01000", "10000", "10000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
function drawText(cv, text, x, y, px, gap, c, a = 1) {
  let cursor = x;
  for (const ch of text) {
    const g = FONT[ch]; if (!g) { cursor += 6 * px + gap; continue; }
    for (let row = 0; row < 7; row++) for (let col = 0; col < 5; col++)
      if (g[row][col] === "1")
        for (let yy = 0; yy < px; yy++) for (let xx = 0; xx < px; xx++)
          cv.blend(Math.round(cursor + col * px + xx), Math.round(y + row * px + yy), c, a);
    cursor += 5 * px + gap;
  }
  return cursor - gap;
}
const textWidth = (text, px, gap) => text.length * (5 * px + gap) - gap;

// ── OG image — 1200×630, opaque ─────────────────────────────────────────────────
function renderOg() {
  const W = 1200, H = 630, s = 2;
  const cv = Canvas(W * s, H * s, PAPER, false);
  const U = (W * s) / 120;                            // reuse the 120-unit motif, centred-ish

  // Title wordmark "MOBILE"
  const tpx = 9 * s, tgap = 11 * s;
  const tw = textWidth("MOBILE", tpx, tgap);
  drawText(cv, "MOBILE", (W * s - tw) / 2, 50 * s, tpx, tgap, INK, 0.88);
  // rule under title
  for (let yy = 0; yy < 2 * s; yy++) for (let xx = 0; xx < 46 * s; xx++)
    cv.blend(Math.round((W * s - 46 * s) / 2 + xx), Math.round(118 * s + yy), INK, 0.25);

  // The mobile motif, scaled & positioned in the middle band.
  const mU = (400 * s) / 120, mScale = 1;
  const ox = W * s / 2 - 60 * mU, oy = 150 * s;
  const sub = {
    seg: (x1, y1, x2, y2, hw, c, a) => cv.seg(ox + x1, oy + y1, ox + x2, oy + y2, hw, c, a),
    circle: (x, y, r, c, a) => cv.circle(ox + x, oy + y, r, c, a),
    bow: (x1, y1, x2, y2, b, hw, c, a) => cv.bow(ox + x1, oy + y1, ox + x2, oy + y2, b, hw, c, a),
    blend: cv.blend,
  };
  drawMobile(sub, mU, mScale, false);

  // URL footer
  const upx = 5 * s, ugap = 7 * s;
  const uw = textWidth("EMH.IO/MOBILE", upx, ugap);
  drawText(cv, "EMH.IO/MOBILE", (W * s - uw) / 2, 588 * s, upx, ugap, INK, 0.35);

  return encodePng(W, H, downsample(cv, W, H, s));
}

// ── ICO builder (embeds PNGs: 16/32/48) ─────────────────────────────────────────
function buildIco(entries) {
  const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const dir = [], imgs = []; let offset = 6 + entries.length * 16;
  for (const e of entries) {
    const d = Buffer.alloc(16);
    d.writeUInt8(e.size >= 256 ? 0 : e.size, 0); d.writeUInt8(e.size >= 256 ? 0 : e.size, 1);
    d.writeUInt16LE(1, 4); d.writeUInt16LE(32, 6); d.writeUInt32LE(e.buf.length, 8); d.writeUInt32LE(offset, 12);
    offset += e.buf.length; dir.push(d); imgs.push(e.buf);
  }
  return Buffer.concat([header, ...dir, ...imgs]);
}

// ── Write everything ────────────────────────────────────────────────────────────
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log("  " + name + "  (" + buf.length + " bytes)"); };

console.log("Generating PWA assets…");
write("icon-192.png", renderIcon(192, { transparent: true }));
write("icon-512.png", renderIcon(512, { transparent: true }));
write("icon-maskable-512.png", renderIcon(512, { scale: 0.72, transparent: false }));
write("icon-180.png", renderIcon(180, { transparent: false }));   // iOS: opaque
write("favicon-16.png", renderIcon(16, { transparent: true }));
write("favicon-32.png", renderIcon(32, { transparent: true }));
write("favicon.ico", buildIco([
  { size: 16, buf: renderIcon(16, { transparent: true }) },
  { size: 32, buf: renderIcon(32, { transparent: true }) },
  { size: 48, buf: renderIcon(48, { transparent: true }) },
]));
write("og.png", renderOg());
console.log("Done.");

// Generates the PWA / favicon icon set by resampling tools/icon-src.png with no
// external image tooling — a manual PNG decoder (inflate + de-filter) feeds an
// area-averaging resizer, then a manual PNG encoder (deflate → IHDR/IDAT/IEND)
// writes each size. Run: `node tools/generate-assets.js`
const zlib = require("zlib"), fs = require("fs"), path = require("path");

const OUT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "icon-src.png");

// ── PNG encode (RGBA buffer → PNG bytes) ────────────────────────────────────────
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

// ── PNG decode (8-bit, color type 2/RGB or 6/RGBA, non-interlaced) → RGBA ────────
function decodePng(buf) {
  let p = 8, width = 0, height = 0, colorType = 0, bitDepth = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString("ascii", p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`Unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType})`);
  const ch = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  const out = Buffer.alloc(width * height * 4);
  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  let q = 0;
  const paeth = (a, b, c) => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  for (let y = 0; y < height; y++) {
    const filter = raw[q++];
    for (let i = 0; i < stride; i++) {
      const x = raw[q++];
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v;
      switch (filter) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new Error("Bad filter " + filter);
      }
      cur[i] = v & 0xFF;
    }
    for (let x = 0; x < width; x++) {
      const si = x * ch, di = (y * width + x) * 4;
      out[di] = cur[si]; out[di + 1] = cur[si + 1]; out[di + 2] = cur[si + 2];
      out[di + 3] = ch === 4 ? cur[si + 3] : 255;
    }
    cur.copy(prev);
  }
  return { width, height, data: out };
}

// ── Area-averaging resize (src RGBA → dst RGBA) ─────────────────────────────────
function resize(src, dw, dh, dstX = 0, dstY = 0, dstW = dw, dstH = dh, bg = null) {
  const { width: sw, height: sh, data } = src;
  const out = Buffer.alloc(dw * dh * 4);
  if (bg) for (let i = 0; i < dw * dh; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  for (let y = 0; y < dstH; y++) {
    const sy0 = (y / dstH) * sh, sy1 = ((y + 1) / dstH) * sh;
    for (let x = 0; x < dstW; x++) {
      const sx0 = (x / dstW) * sw, sx1 = ((x + 1) / dstW) * sw;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(sy0); yy < Math.ceil(sy1); yy++) {
        const wy = Math.min(sy1, yy + 1) - Math.max(sy0, yy);
        for (let xx = Math.floor(sx0); xx < Math.ceil(sx1); xx++) {
          const wx = Math.min(sx1, xx + 1) - Math.max(sx0, xx);
          const w = wx * wy, si = (yy * sw + xx) * 4;
          r += data[si] * w; g += data[si + 1] * w; b += data[si + 2] * w; a += data[si + 3] * w; wsum += w;
        }
      }
      const di = ((dstY + y) * dw + (dstX + x)) * 4;
      out[di] = Math.round(r / wsum); out[di + 1] = Math.round(g / wsum); out[di + 2] = Math.round(b / wsum); out[di + 3] = Math.round(a / wsum);
    }
  }
  return out;
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

// ── Generate ─────────────────────────────────────────────────────────────────────
const src = decodePng(fs.readFileSync(SRC));
const bg = [src.data[0], src.data[1], src.data[2]];   // top-left pixel = paper colour
const icon = (n) => encodePng(n, n, resize(src, n, n));
// Maskable: shrink art to the 80% safe zone, padding the rest with the paper colour.
function maskable(n) {
  const inner = Math.round(n * 0.8), off = Math.round((n - inner) / 2);
  return encodePng(n, n, resize(src, n, n, off, off, inner, inner, bg));
}

const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log("  " + name + "  (" + buf.length + " bytes)"); };

console.log(`Source ${src.width}×${src.height}, paper #${bg.map(c => c.toString(16).padStart(2, "0")).join("")}`);
console.log("Generating icons…");
write("icon-192.png", icon(192));
write("icon-512.png", icon(512));
write("icon-maskable-512.png", maskable(512));
write("icon-180.png", icon(180));
write("favicon-16.png", icon(16));
write("favicon-32.png", icon(32));
write("favicon.ico", buildIco([
  { size: 16, buf: icon(16) },
  { size: 32, buf: icon(32) },
  { size: 48, buf: icon(48) },
]));
console.log("Done.");

// Generates the PWA icon set as real PNG files using only Node's built-in zlib —
// no image dependency needed. Brand mark: a checkmark-in-shield on the accent green,
// echoing the "verified player" identity the product is built around.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCENT = [31, 111, 77]; // #1f6f4d
const WHITE = [255, 255, 255];

function crc(buf) {
  // Node's zlib doesn't export crc32 as a function pre-computed for arbitrary buffers
  // in all versions, so implement the standard CRC-32 table-based algorithm directly.
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function inShield(x, y, size) {
  const cx = size / 2;
  const top = size * 0.14;
  const bottom = size * 0.88;
  const halfW = size * 0.32;
  const t = (y - top) / (bottom - top);
  if (t < 0 || t > 1) return false;
  // shield narrows to a point near the bottom
  const widthAt = t < 0.75 ? halfW : halfW * (1 - (t - 0.75) / 0.25);
  return Math.abs(x - cx) <= widthAt;
}

function inCheck(x, y, size) {
  // simple thick checkmark, three line segments approximated with distance-to-segment
  const p1 = [size * 0.30, size * 0.52];
  const p2 = [size * 0.44, size * 0.66];
  const p3 = [size * 0.72, size * 0.36];
  const thickness = size * 0.075;
  function distSeg(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const apx = px - ax, apy = py - ay;
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
    const cx = ax + t * abx, cy = ay + t * aby;
    return Math.hypot(px - cx, py - cy);
  }
  return distSeg(x, y, p1[0], p1[1], p2[0], p2[1]) <= thickness ||
    distSeg(x, y, p2[0], p2[1], p3[0], p3[1]) <= thickness;
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const off = rowStart + 1 + x * 4;
      const shield = inShield(x, y, size);
      const mark = shield && inCheck(x, y, size);
      const [r, g, b] = mark ? WHITE : ACCENT;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = deflateSync(raw);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('public/icons', { recursive: true });
const sizes = [180, 192, 512];
for (const s of sizes) {
  writeFileSync(`public/icons/icon-${s}.png`, makePng(s));
  console.log(`wrote public/icons/icon-${s}.png`);
}

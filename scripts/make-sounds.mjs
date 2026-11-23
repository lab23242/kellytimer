// Synthesises the three chimes into public/sounds/*.wav (mono, 16-bit, 32 kHz).
// Additive synthesis only, no samples, so the output is ours to release as CC0.
// Usage: node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 32000;
const PEAK = 0.5; // about -6 dBFS: gentle, never startling
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../public/sounds");

function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) * 2 - 1;
}

/** partials: [{ f, a, decay (s, time constant), beat (Hz) }] */
function additive(seconds, partials, { attack = 0.012, vibrato = null } = {}) {
  const n = Math.round(seconds * RATE);
  const out = new Float64Array(n);
  for (const p of partials) {
    let phase1 = 0;
    let phase2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      let f = p.f;
      if (vibrato && t > vibrato.from) {
        const depth = Math.min(1, (t - vibrato.from) / 0.4) * vibrato.depth;
        f *= 1 + depth * Math.sin(2 * Math.PI * vibrato.rate * t);
      }
      if (p.bend) f *= 1 + p.bend * Math.exp(-t / 0.08);
      phase1 += (2 * Math.PI * f) / RATE;
      phase2 += (2 * Math.PI * (f + (p.beat || 0))) / RATE;
      const env = Math.min(1, t / attack) * Math.exp(-t / p.decay);
      const s = p.beat ? 0.5 * (Math.sin(phase1) + Math.sin(phase2)) : Math.sin(phase1);
      out[i] += p.a * env * s;
    }
  }
  return out;
}

function addNoiseBurst(buf, { seconds, amount, smooth, seed }) {
  const rnd = lcg(seed);
  let lp = 0;
  const n = Math.round(seconds * RATE);
  for (let i = 0; i < n && i < buf.length; i++) {
    lp += (rnd() - lp) * smooth;
    buf[i] += lp * amount * Math.exp(-i / (n / 4));
  }
  return buf;
}

function fadeOut(buf, seconds) {
  const n = Math.round(seconds * RATE);
  for (let i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
  return buf;
}

function normalize(buf) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  const k = PEAK / max;
  return buf.map((v) => v * k);
}

function wav(buf) {
  const data = Buffer.alloc(buf.length * 2);
  buf.forEach((v, i) => data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// Singing bowl: inharmonic partials, each split in two for the slow "wah" beating.
const bowl = additive(
  5,
  [
    { f: 196, a: 1.0, decay: 2.6, beat: 0.9 },
    { f: 196 * 2.71, a: 0.42, decay: 1.7, beat: 1.6 },
    { f: 196 * 5.15, a: 0.16, decay: 0.9, beat: 2.3 },
    { f: 196 * 8.13, a: 0.05, decay: 0.5 },
  ],
  { attack: 0.02 },
);

// Plucked string (qin-like): harmonics with a pluck-position notch, a soft settle in
// pitch after the attack and a little vibrato as it rings.
const qinPartials = [];
for (let h = 1; h <= 14; h++) {
  const notch = Math.abs(Math.sin((Math.PI * h) / 7)); // plucked at 1/7 of the string
  qinPartials.push({ f: 146.8 * h * (1 + 0.0004 * h * h), a: (notch / h ** 1.1) * 0.9, decay: 2.2 / h ** 0.7, bend: 0.012 });
}
const qin = addNoiseBurst(additive(4, qinPartials, { attack: 0.004, vibrato: { from: 0.6, rate: 4.6, depth: 0.003 } }), {
  seconds: 0.05,
  amount: 0.08,
  smooth: 0.25,
  seed: 3,
});

// Small bell: brighter, shorter, still soft.
const bell = additive(
  3.5,
  [
    { f: 784, a: 1.0, decay: 1.3, beat: 0.6 },
    { f: 784 * 2.0, a: 0.25, decay: 0.8 },
    { f: 784 * 2.76, a: 0.3, decay: 0.6, beat: 1.1 },
    { f: 784 * 5.4, a: 0.06, decay: 0.3 },
  ],
  { attack: 0.006 },
);

mkdirSync(outDir, { recursive: true });
for (const [name, buf] of Object.entries({ bowl: fadeOut(bowl, 0.6), qin: fadeOut(qin, 0.5), bell: fadeOut(bell, 0.4) })) {
  const file = resolve(outDir, `${name}.wav`);
  writeFileSync(file, wav(normalize(buf)));
  console.log(`wrote ${file}`);
}

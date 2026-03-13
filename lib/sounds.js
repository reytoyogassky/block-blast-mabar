/**
 * Block Blast Mabar — Sound Engine
 * Musik: upbeat chiptune ceria, nada F major pentatonic
 * BPM 148, verse/chorus loop, bass groove + drum kit
 */

let ctx = null;
let bgGain = null;
let sfxGain = null;
let bgNodes = [];
let muted = false;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bgGain = ctx.createGain();
    bgGain.gain.value = 0.15;
    bgGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playTone(freq, type, duration, gain = 0.4, delay = 0, dest = null) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime + delay);
  g.gain.setValueAtTime(0, c.currentTime + delay);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + delay + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
  osc.connect(g);
  g.connect(dest || sfxGain);
  osc.start(c.currentTime + delay);
  osc.stop(c.currentTime + delay + duration + 0.05);
}

function playNoise(duration, gain = 0.15, freq = 800, delay = 0) {
  const c = getCtx();
  const bufSize = Math.ceil(c.sampleRate * duration);
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = 0.8;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, c.currentTime + delay);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + delay + duration);
  src.connect(filter);
  filter.connect(g);
  g.connect(sfxGain);
  src.start(c.currentTime + delay);
  src.stop(c.currentTime + delay + duration + 0.05);
}

export function sfxPickup() {
  if (muted) return;
  playTone(600, 'sine', 0.07, 0.22);
  playTone(900, 'sine', 0.05, 0.14, 0.04);
}

export function sfxDrop() {
  if (muted) return;
  playTone(220, 'square', 0.05, 0.16);
  playNoise(0.05, 0.1, 500);
}

export function sfxClear(lines = 1) {
  if (muted) return;
  const chords = [
    [523, 659, 784],
    [523, 659, 784, 1047],
    [523, 659, 784, 1047, 1319],
  ];
  const chord = chords[Math.min(lines - 1, 2)];
  chord.forEach((freq, i) => {
    playTone(freq, 'sine', 0.18, 0.28, i * 0.065);
    playTone(freq * 2, 'sine', 0.1, 0.1, i * 0.065);
  });
  playNoise(0.1, 0.07, 1400, 0);
}

export function sfxCombo(multiplier = 2) {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200 * multiplier, c.currentTime + 0.3);
  g.gain.setValueAtTime(0.25, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.3);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.35);
  playTone(900 * multiplier, 'sine', 0.2, 0.22, 0.28);
}

export function sfxGameOver() {
  if (muted) return;
  [440, 349, 294, 220].forEach((freq, i) => {
    playTone(freq, 'sine', 0.4, 0.22, i * 0.12);
  });
  playNoise(0.4, 0.08, 200, 0);
}

export function sfxWin() {
  if (muted) return;
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, i) => {
    playTone(freq, 'triangle', 0.2, 0.28, i * 0.1);
    playTone(freq * 1.5, 'sine', 0.1, 0.12, i * 0.1 + 0.04);
  });
}

export function sfxNoPlace() {
  if (muted) return;
  playTone(180, 'square', 0.07, 0.18);
  playTone(140, 'square', 0.09, 0.13, 0.05);
}

// ── Background Music — Upbeat Ceria ──────────────────────────────────────────
// F major pentatonic: F G A C D (dua oktaf)
// BPM 148, struktur verse/chorus 16-beat, bass groove, drum kit lengkap

let bgInterval = null;
let bgStarted  = false;
let beatStep   = 0;

const PEN = [
  174.6, 196.0, 220.0, 261.6, 293.7,   // F3 G3 A3 C4 D4
  349.2, 392.0, 440.0, 523.3, 587.3,   // F4 G4 A4 C5 D5
];

const MELODY_A = [5, 6, 7, 8, 7, 6, 5, 7];  // verse — bouncy
const MELODY_B = [6, 7, 8, 9, 8, 9, 7, 8];  // chorus — excited naik

const BASS_PAT = [174.6, 174.6, 261.6, 261.6, 220.0, 220.0, 196.0, 196.0];
const CHORD_R  = [174.6, 220.0, 261.6, 196.0]; // F Am C G

function bgTone(freq, type, dur, vol, delay = 0) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g   = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(0,   t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.setValueAtTime(vol, t0 + dur * 0.65);
  g.gain.linearRampToValueAtTime(0,   t0 + dur);
  osc.connect(g); g.connect(bgGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
  bgNodes.push(osc);
}

function bgNoise(dur, gain, freq, delay = 0) {
  const c = getCtx();
  const bufSize = Math.ceil(c.sampleRate * dur);
  const buf  = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
  const src  = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = freq; filt.Q.value = 1.0;
  const g = c.createGain();
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(bgGain);
  src.start(t0); src.stop(t0 + dur + 0.02);
  bgNodes.push(src);
}

export function startBgMusic() {
  if (bgStarted || muted) return;
  bgStarted = true;
  beatStep  = 0;
  getCtx();

  const BPM  = 148;
  const BEAT = 60 / BPM; // ~0.405s

  function tick() {
    if (muted) return;
    const s     = beatStep;
    const bar   = Math.floor(s / 16) % 2;   // 0 = verse, 1 = chorus
    const beat8 = s % 8;
    const isDown = s % 2 === 0;

    // Melodi
    const mel   = bar === 0 ? MELODY_A : MELODY_B;
    const mFreq = PEN[mel[beat8]];
    bgTone(mFreq * (bar === 1 ? 2 : 1), 'square', BEAT * 0.75, 0.17);

    // Harmony setiap downbeat
    if (isDown) {
      const hFreq = PEN[(mel[beat8] + 2) % PEN.length];
      bgTone(hFreq * (bar === 1 ? 2 : 1), 'triangle', BEAT * 0.5, 0.07);
    }

    // Bass setiap beat
    const bFreq = BASS_PAT[Math.floor(s / 2) % BASS_PAT.length];
    bgTone(bFreq * 0.5, 'sawtooth', BEAT * 0.8, 0.25);
    if (isDown) bgTone(bFreq * 0.25, 'sine', BEAT * 1.5, 0.18);

    // Chord stab setiap 4 beat
    if (s % 4 === 0) {
      const root = CHORD_R[Math.floor(s / 4) % CHORD_R.length];
      [1, 1.25, 1.5].forEach((m, i) => bgTone(root * m, 'triangle', BEAT * 0.35, 0.055, i * 0.012));
    }

    // Drum kit
    if (s % 8 === 0 || s % 8 === 4) {
      bgNoise(0.12, 0.2, 80);                // kick
      bgTone(55, 'sine', 0.11, 0.3);
    }
    if (s % 8 === 2 || s % 8 === 6) {
      bgNoise(0.08, 0.16, 300);              // snare
      bgTone(180, 'square', 0.05, 0.1);
    }
    bgNoise(0.028, 0.045, 9000);             // hihat tertutup
    if (s % 4 === 1) bgNoise(0.07, 0.06, 7000); // hihat terbuka

    // Clap di chorus
    if (bar === 1 && (s % 4 === 1 || s % 4 === 3)) bgNoise(0.055, 0.09, 1600);

    beatStep++;
    // Cleanup node lama
    if (s % 32 === 0 && bgNodes.length > 100) {
      bgNodes.forEach(n => { try { n.stop(0); } catch(_) {} });
      bgNodes = [];
    }
  }

  tick();
  bgInterval = setInterval(tick, BEAT * 1000);
}

export function stopBgMusic() {
  if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
  bgStarted = false;
  bgNodes.forEach(n => { try { n.stop(); } catch(_) {} });
  bgNodes = [];
}

export function setMuted(val) {
  muted = val;
  if (val) {
    stopBgMusic();
    if (sfxGain) sfxGain.gain.value = 0;
    if (bgGain)  bgGain.gain.value  = 0;
  } else {
    if (sfxGain) sfxGain.gain.value = 0.55;
    if (bgGain)  bgGain.gain.value  = 0.15;
    startBgMusic();
  }
}

export function isMuted() { return muted; }
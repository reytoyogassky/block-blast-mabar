/**
 * Block Blast Mabar — Sound Engine
 * Semua suara dibuat dengan Web Audio API (tidak perlu file audio eksternal)
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
    bgGain.gain.value = 0.18;
    bgGain.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(ctx.destination);
  }
  // Resume on user gesture
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
  const bufSize = c.sampleRate * duration;
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

// ── SFX ─────────────────────────────────────────────────────────────────────

export function sfxPickup() {
  if (muted) return;
  playTone(520, 'sine', 0.08, 0.25);
  playTone(780, 'sine', 0.06, 0.15, 0.05);
}

export function sfxDrop() {
  if (muted) return;
  playTone(200, 'square', 0.06, 0.18);
  playNoise(0.06, 0.12, 400);
}

export function sfxClear(lines = 1) {
  if (muted) return;
  // Rising arpeggio based on line count
  const notes = [
    [523, 659, 784],          // 1 line
    [523, 659, 784, 1047],    // 2 lines
    [523, 659, 784, 1047, 1319], // 3+ lines
  ];
  const chord = notes[Math.min(lines - 1, 2)];
  chord.forEach((freq, i) => {
    playTone(freq, 'sine', 0.18, 0.3, i * 0.065);
    playTone(freq * 2, 'sine', 0.1, 0.12, i * 0.065);
  });
  playNoise(0.12, 0.08, 1200, 0);
}

export function sfxCombo(multiplier = 2) {
  if (muted) return;
  // Dramatic ascending sweep
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(300, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1200 * multiplier, c.currentTime + 0.35);
  g.gain.setValueAtTime(0.3, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.4);

  playTone(800 * multiplier, 'sine', 0.25, 0.25, 0.3);
  playTone(1600 * multiplier, 'sine', 0.15, 0.2, 0.35);
}

export function sfxGameOver() {
  if (muted) return;
  // Descending sad tones
  [440, 349, 294, 220].forEach((freq, i) => {
    playTone(freq, 'sine', 0.4, 0.25, i * 0.12);
  });
  playNoise(0.5, 0.1, 200, 0);
}

export function sfxWin() {
  if (muted) return;
  // Victory fanfare
  const fanfare = [523, 659, 784, 1047, 784, 1047, 1319];
  fanfare.forEach((freq, i) => {
    playTone(freq, 'triangle', 0.2, 0.3, i * 0.1);
    playTone(freq * 1.5, 'sine', 0.1, 0.15, i * 0.1 + 0.04);
  });
}

export function sfxNoPlace() {
  if (muted) return;
  playTone(180, 'square', 0.08, 0.2);
  playTone(140, 'square', 0.1, 0.15, 0.06);
}

// ── Background Music ─────────────────────────────────────────────────────────
// Procedural chiptune loop using oscillators + LFO

let bgInterval = null;

const SCALE = [261, 294, 330, 349, 392, 440, 494, 523]; // C major
const MELODY = [0, 2, 4, 7, 4, 2, 0, 4, 2, 7, 5, 2, 4, 0, 7, 5];
const BASS   = [0, 0, 4, 4, 5, 5, 2, 2];

let melodyStep = 0;
let bassStep = 0;
let bgStarted = false;

function playBgNote(freq, type, duration, vol) {
  const c = getCtx();
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + 0.01);
  g.gain.setValueAtTime(vol, c.currentTime + duration * 0.7);
  g.gain.linearRampToValueAtTime(0, c.currentTime + duration);
  osc.connect(g);
  g.connect(bgGain);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration + 0.02);
  bgNodes.push(osc);
}

export function startBgMusic() {
  if (bgStarted || muted) return;
  bgStarted = true;
  getCtx();

  const BPM = 128;
  const BEAT = 60 / BPM;

  let step = 0;
  function tick() {
    if (muted) return;
    const isDown = step % 2 === 0;

    // Melody
    const mNote = SCALE[MELODY[melodyStep % MELODY.length]];
    playBgNote(mNote * 2, 'square', BEAT * 0.85, 0.22);
    melodyStep++;

    // Harmony (parallel third)
    const hNote = SCALE[(MELODY[melodyStep % MELODY.length] + 2) % SCALE.length];
    playBgNote(hNote * 2, 'triangle', BEAT * 0.6, 0.1);

    // Bass every 2 beats
    if (isDown) {
      const bNote = SCALE[BASS[bassStep % BASS.length]] / 2;
      playBgNote(bNote, 'sawtooth', BEAT * 1.8, 0.35);
      bassStep++;
    }

    // Hi-hat
    playNoise(0.04, 0.04, 8000);
    if (isDown) playNoise(0.08, 0.08, 200); // kick

    step++;
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
    if (bgGain) bgGain.gain.value = 0;
  } else {
    if (sfxGain) sfxGain.gain.value = 0.55;
    if (bgGain) bgGain.gain.value = 0.18;
    startBgMusic();
  }
}

export function isMuted() { return muted; }
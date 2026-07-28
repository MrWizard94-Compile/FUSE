// Sound generator for FUSE
// Run with: node generate-sounds.js
// Creates a /sounds folder with all WAV files

const fs = require('fs')
const path = require('path')

const SAMPLE_RATE = 44100

function writeWav(filename, samples) {
  const dir = path.join(__dirname, 'sounds')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir)

  const numSamples = samples.length
  const buffer = Buffer.alloc(44 + numSamples * 2)

  // WAV header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)       // PCM
  buffer.writeUInt16LE(1, 22)       // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }

  fs.writeFileSync(path.join(dir, filename), buffer)
  console.log(`Generated: sounds/${filename}`)
}

// ─── Low pass filter (one pole) ───────────────────────────────────
function lowPass(input, cutoff) {
  const rc = 1.0 / (cutoff * 2 * Math.PI)
  const dt = 1.0 / SAMPLE_RATE
  const alpha = dt / (rc + dt)
  const out = new Float32Array(input.length)
  out[0] = input[0]
  for (let i = 1; i < input.length; i++) {
    out[i] = out[i - 1] + alpha * (input[i] - out[i - 1])
  }
  return out
}

// ─── High pass filter (one pole) ──────────────────────────────────
function highPass(input, cutoff) {
  const rc = 1.0 / (cutoff * 2 * Math.PI)
  const dt = 1.0 / SAMPLE_RATE
  const alpha = rc / (rc + dt)
  const out = new Float32Array(input.length)
  out[0] = input[0]
  for (let i = 1; i < input.length; i++) {
    out[i] = alpha * (out[i - 1] + input[i] - input[i - 1])
  }
  return out
}

// ─── White noise ───────────────────────────────────────────────────
function noise(length) {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = Math.random() * 2 - 1
  return out
}

// ─── Sine tone ─────────────────────────────────────────────────────
function sine(freq, length, phase = 0) {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE + phase)
  return out
}

// ─── Mix arrays ────────────────────────────────────────────────────
function mix(...arrays) {
  const len = arrays[0].length
  const out = new Float32Array(len)
  for (const arr of arrays) for (let i = 0; i < len; i++) out[i] += arr[i]
  return out
}

// ─── Apply envelope ────────────────────────────────────────────────
function envelope(samples, attackSec, decaySec, sustainLevel, releaseSec, sustainSec = 0) {
  const out = new Float32Array(samples.length)
  const attackSamples = Math.floor(attackSec * SAMPLE_RATE)
  const decaySamples = Math.floor(decaySec * SAMPLE_RATE)
  const sustainSamples = Math.floor(sustainSec * SAMPLE_RATE)
  const releaseSamples = Math.floor(releaseSec * SAMPLE_RATE)

  for (let i = 0; i < samples.length; i++) {
    let amp = 0
    if (i < attackSamples) {
      amp = i / attackSamples
    } else if (i < attackSamples + decaySamples) {
      const t = (i - attackSamples) / decaySamples
      amp = 1 - t * (1 - sustainLevel)
    } else if (i < attackSamples + decaySamples + sustainSamples) {
      amp = sustainLevel
    } else {
      const t = (i - attackSamples - decaySamples - sustainSamples) / Math.max(releaseSamples, 1)
      amp = sustainLevel * Math.max(0, 1 - t)
    }
    out[i] = samples[i] * amp
  }
  return out
}

// ─── Normalize ─────────────────────────────────────────────────────
function normalize(samples, target = 0.85) {
  let peak = 0
  for (const s of samples) if (Math.abs(s) > peak) peak = Math.abs(s)
  if (peak === 0) return samples
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * (target / peak)
  return out
}

// ─── Frequency sweep on noise ──────────────────────────────────────
function sweepNoise(durationSec, freqStart, freqEnd, bandwidth = 0.3) {
  const len = Math.floor(durationSec * SAMPLE_RATE)
  const src = noise(len)
  const out = new Float32Array(len)

  // Simulate sweeping bandpass by blending successive filtered versions
  const steps = 64
  for (let s = 0; s < steps; s++) {
    const t = s / steps
    const freq = freqStart * Math.pow(freqEnd / freqStart, t)
    const startSample = Math.floor((s / steps) * len)
    const endSample = Math.floor(((s + 1) / steps) * len)

    let filtered = lowPass(src, freq * (1 + bandwidth))
    filtered = highPass(filtered, freq * (1 - bandwidth))

    for (let i = startSample; i < endSample && i < len; i++) {
      out[i] += filtered[i]
    }
  }
  return out
}

// ══════════════════════════════════════════════════════════════════
// 1. WHOOSH (mission launch)
// ══════════════════════════════════════════════════════════════════
function generateWhoosh() {
  const dur = 0.55
  const len = Math.floor(dur * SAMPLE_RATE)

  // Core: noise sweep 80Hz -> 4000Hz
  const sweep = sweepNoise(dur, 80, 4000, 0.5)

  // Amplitude envelope: fast attack, tail off
  const env = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const t = i / len
    // Sharp attack then exponential decay
    env[i] = Math.pow(t, 0.08) * Math.exp(-t * 4.5)
  }

  const shaped = new Float32Array(len)
  for (let i = 0; i < len; i++) shaped[i] = sweep[i] * env[i] * 1.8

  // Low thud underneath
  const thudLen = Math.floor(0.18 * SAMPLE_RATE)
  const thud = sine(55, thudLen)
  const thudEnv = new Float32Array(thudLen)
  for (let i = 0; i < thudLen; i++) thudEnv[i] = Math.exp(-i / (thudLen * 0.3)) * 0.6
  const thudShaped = new Float32Array(len)
  for (let i = 0; i < thudLen; i++) thudShaped[i] = thud[i] * thudEnv[i]

  const final = mix(shaped, thudShaped)
  writeWav('whoosh.wav', normalize(final))
}

// ══════════════════════════════════════════════════════════════════
// 2. COMPLETE (mission success)
// ══════════════════════════════════════════════════════════════════
function generateComplete() {
  const dur = 1.4
  const len = Math.floor(dur * SAMPLE_RATE)
  const out = new Float32Array(len)

  // Impact thud at start
  const thudLen = Math.floor(0.25 * SAMPLE_RATE)
  const thudFreqs = [60, 90, 45]
  for (const f of thudFreqs) {
    const t = sine(f, thudLen)
    for (let i = 0; i < thudLen; i++) {
      out[i] += t[i] * Math.exp(-i / (thudLen * 0.25)) * 0.35
    }
  }

  // Noise punch
  const punch = noise(Math.floor(0.08 * SAMPLE_RATE))
  const punchFilt = lowPass(punch, 500)
  for (let i = 0; i < punchFilt.length; i++) {
    out[i] += punchFilt[i] * Math.exp(-i / (SAMPLE_RATE * 0.04)) * 0.5
  }

  // Rising cinematic chord: staggered notes
  const notes = [
    { freq: 220, start: 0.08, dur: 0.5, amp: 0.3 },
    { freq: 277, start: 0.16, dur: 0.5, amp: 0.25 },
    { freq: 330, start: 0.24, dur: 0.55, amp: 0.28 },
    { freq: 440, start: 0.35, dur: 0.65, amp: 0.32 },
    { freq: 550, start: 0.46, dur: 0.8, amp: 0.28 },
    { freq: 660, start: 0.56, dur: 0.85, amp: 0.22 },
  ]

  for (const n of notes) {
    const startSample = Math.floor(n.start * SAMPLE_RATE)
    const noteSamples = Math.floor(n.dur * SAMPLE_RATE)
    const tone = sine(n.freq, noteSamples)
    // Add slight harmonics for richness
    const harm = sine(n.freq * 2, noteSamples)
    for (let i = 0; i < noteSamples && startSample + i < len; i++) {
      const t = i / noteSamples
      const env2 = Math.pow(t + 0.001, 0.15) * Math.exp(-t * 2.5)
      out[startSample + i] += (tone[i] * 0.8 + harm[i] * 0.2) * env2 * n.amp
    }
  }

  writeWav('complete.wav', normalize(out))
}

// ══════════════════════════════════════════════════════════════════
// 3. FAIL (mission expired/abandoned)
// ══════════════════════════════════════════════════════════════════
function generateFail() {
  const dur = 0.9
  const len = Math.floor(dur * SAMPLE_RATE)
  const out = new Float32Array(len)

  // Dark noise burst
  const n = noise(len)
  const filtered = lowPass(n, 300)
  for (let i = 0; i < len; i++) {
    out[i] += filtered[i] * Math.exp(-i / (SAMPLE_RATE * 0.18)) * 0.5
  }

  // Three descending tones
  const drops = [
    { freq: 280, start: 0.0, dur: 0.35 },
    { freq: 180, start: 0.22, dur: 0.35 },
    { freq: 110, start: 0.44, dur: 0.45 },
  ]

  for (const d of drops) {
    const startSample = Math.floor(d.start * SAMPLE_RATE)
    const dLen = Math.floor(d.dur * SAMPLE_RATE)
    // Slightly detuned for ominous feel
    const t1 = sine(d.freq, dLen)
    const t2 = sine(d.freq * 1.015, dLen)
    for (let i = 0; i < dLen && startSample + i < len; i++) {
      const t = i / dLen
      const env2 = Math.pow(t + 0.001, 0.1) * Math.exp(-t * 3)
      out[startSample + i] += (t1[i] + t2[i]) * 0.5 * env2 * 0.35
    }
  }

  writeWav('fail.wav', normalize(out))
}

// ══════════════════════════════════════════════════════════════════
// 4. LEVELUP
// ══════════════════════════════════════════════════════════════════
function generateLevelUp() {
  const dur = 2.2
  const len = Math.floor(dur * SAMPLE_RATE)
  const out = new Float32Array(len)

  // Opening whoosh (baked in)
  const whooshLen = Math.floor(0.5 * SAMPLE_RATE)
  const sweep = sweepNoise(0.5, 80, 3000, 0.4)
  const whooshEnv = new Float32Array(whooshLen)
  for (let i = 0; i < whooshLen; i++) whooshEnv[i] = Math.pow(i / whooshLen, 0.08) * Math.exp(-(i / whooshLen) * 4)
  for (let i = 0; i < whooshLen; i++) out[i] += sweep[i] * whooshEnv[i] * 1.4

  // Bass slam at 0.4s
  const slamStart = Math.floor(0.4 * SAMPLE_RATE)
  const slamLen = Math.floor(0.35 * SAMPLE_RATE)
  const slamFreqs = [50, 70, 35]
  for (const f of slamFreqs) {
    const t = sine(f, slamLen)
    for (let i = 0; i < slamLen; i++) {
      out[slamStart + i] += t[i] * Math.exp(-i / (slamLen * 0.3)) * 0.45
    }
  }

  // Noise slam
  const slamNoise = noise(Math.floor(0.12 * SAMPLE_RATE))
  const slamNoiseFilt = lowPass(slamNoise, 400)
  for (let i = 0; i < slamNoiseFilt.length; i++) {
    out[slamStart + i] += slamNoiseFilt[i] * Math.exp(-i / (SAMPLE_RATE * 0.05)) * 0.6
  }

  // Rising chord sequence: 7 notes building to a big held finish
  const chord = [
    { freq: 261, start: 0.5,  dur: 0.35, amp: 0.22 },
    { freq: 329, start: 0.62, dur: 0.35, amp: 0.22 },
    { freq: 392, start: 0.74, dur: 0.38, amp: 0.24 },
    { freq: 523, start: 0.86, dur: 0.4,  amp: 0.26 },
    { freq: 659, start: 0.98, dur: 0.45, amp: 0.26 },
    { freq: 784, start: 1.1,  dur: 0.5,  amp: 0.24 },
    { freq: 1047,start: 1.22, dur: 1.0,  amp: 0.28 }, // long final note
  ]

  for (const n of chord) {
    const startSample = Math.floor(n.start * SAMPLE_RATE)
    const nLen = Math.floor(n.dur * SAMPLE_RATE)
    const t1 = sine(n.freq, nLen)
    const t2 = sine(n.freq * 2.001, nLen) // slight octave harmonic
    for (let i = 0; i < nLen && startSample + i < len; i++) {
      const t = i / nLen
      const isLast = n.freq === 1047
      const envAmp = Math.pow(t + 0.001, 0.1) * (isLast ? Math.exp(-t * 1.2) : Math.exp(-t * 2.8))
      out[startSample + i] += (t1[i] * 0.75 + t2[i] * 0.25) * envAmp * n.amp
    }
  }

  writeWav('levelup.wav', normalize(out))
}

// ══════════════════════════════════════════════════════════════════
// 5. TICK (ignition countdown)
// ══════════════════════════════════════════════════════════════════
function generateTick() {
  const len = Math.floor(0.06 * SAMPLE_RATE)
  const n = noise(len)
  const filt = highPass(lowPass(n, 2000), 800)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = filt[i] * Math.exp(-i / (len * 0.3)) * 1.5
  writeWav('tick.wav', normalize(out, 0.6))
}

// ══════════════════════════════════════════════════════════════════
// 6. TICK URGENT
// ══════════════════════════════════════════════════════════════════
function generateTickUrgent() {
  const len = Math.floor(0.07 * SAMPLE_RATE)
  const n = noise(len)
  const filt = highPass(lowPass(n, 3500), 1500)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = filt[i] * Math.exp(-i / (len * 0.25)) * 2.0
  writeWav('tick-urgent.wav', normalize(out, 0.75))
}

// ══════════════════════════════════════════════════════════════════
// 7. ALARM (countdown under 1 min)
// ══════════════════════════════════════════════════════════════════
function generateAlarm() {
  const dur = 0.12
  const len = Math.floor(dur * SAMPLE_RATE)
  const n = noise(len)
  const filt = highPass(lowPass(n, 1800), 900)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) out[i] = filt[i] * Math.exp(-i / (len * 0.4)) * 1.8
  writeWav('alarm.wav', normalize(out, 0.7))
}

// ─── Run all ───────────────────────────────────────────────────────
console.log('Generating FUSE sound effects...\n')
generateWhoosh()
generateComplete()
generateFail()
generateLevelUp()
generateTick()
generateTickUrgent()
generateAlarm()
console.log('\nAll sounds generated in /sounds folder.')

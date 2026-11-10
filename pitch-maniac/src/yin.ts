/**
 * YIN Pitch Detection Algorithm implementation for Web Audio Float32Array frames.
 * Fast, accurate time-domain autocorrelation-based pitch tracking.
 */
export function detectPitchYIN(
  buffer: Float32Array,
  sampleRate: number,
  threshold: number = 0.15,
  minFreq: number = 65,    // C2
  maxFreq: number = 1000   // ~B5
): { hz: number; midi: number; voiced: boolean } {
  // Check RMS energy
  let sumSq = 0;
  for (let i = 0; i < buffer.length; i++) {
    sumSq += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sumSq / buffer.length);
  if (rms < 0.015) {
    return { hz: 0, midi: 0, voiced: false };
  }

  const minPeriod = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxPeriod = Math.min(Math.floor(buffer.length / 2), Math.floor(sampleRate / minFreq));

  const d = new Float32Array(maxPeriod + 1);

  // 1. Difference function d(tau)
  for (let tau = minPeriod; tau <= maxPeriod; tau++) {
    let diffSum = 0;
    const limit = buffer.length - tau;
    for (let i = 0; i < limit; i++) {
      const delta = buffer[i] - buffer[i + tau];
      diffSum += delta * delta;
    }
    d[tau] = diffSum;
  }

  // 2. Cumulative mean normalized difference function d'(tau)
  const dPrime = new Float32Array(maxPeriod + 1);
  dPrime[0] = 1.0;
  let runningSum = 0;
  for (let tau = 1; tau <= maxPeriod; tau++) {
    runningSum += d[tau];
    if (runningSum > 0) {
      dPrime[tau] = d[tau] / (runningSum / tau);
    } else {
      dPrime[tau] = 1.0;
    }
  }

  // 3. Absolute thresholding & local minimum
  let tauSelected = -1;
  for (let tau = minPeriod; tau < maxPeriod; tau++) {
    if (dPrime[tau] < threshold) {
      while (tau + 1 < maxPeriod && dPrime[tau + 1] < dPrime[tau]) {
        tau++;
      }
      tauSelected = tau;
      break;
    }
  }

  // Fallback to absolute minimum if low enough
  if (tauSelected === -1) {
    let bestTau = minPeriod;
    let minVal = dPrime[minPeriod];
    for (let tau = minPeriod + 1; tau < maxPeriod; tau++) {
      if (dPrime[tau] < minVal) {
        minVal = dPrime[tau];
        bestTau = tau;
      }
    }
    if (minVal < 0.35) {
      tauSelected = bestTau;
    }
  }

  if (tauSelected > 0) {
    // 4. Parabolic interpolation
    const s0 = dPrime[tauSelected - 1];
    const s1 = dPrime[tauSelected];
    const s2 = dPrime[Math.min(tauSelected + 1, maxPeriod)];
    const denom = s0 - 2 * s1 + s2;
    let delta = 0;
    if (Math.abs(denom) > 1e-6) {
      delta = (0.5 * (s0 - s2)) / denom;
      delta = Math.max(-0.5, Math.min(0.5, delta));
    }

    const refinedTau = tauSelected + delta;
    const hz = sampleRate / refinedTau;
    const midi = 69 + 12 * Math.log2(hz / 440);
    return { hz, midi, voiced: true };
  }

  return { hz: 0, midi: 0, voiced: false };
}

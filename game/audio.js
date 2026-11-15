// Sound, synthesized with WebAudio: no audio files, nothing fetched. Gunshots are a
// noise burst through a low-pass filter with a pitch per weapon class, the charge
// beeps are square blips, the explosion is a long filtered rumble. Distant shots are
// quieter and duller, which is also information: the bots hear everything, the player
// hears a mix that says roughly where the fight is.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  const listener = { x: 0, z: 0 };

  function ensure() {
    if (context) {
      if (context.state === 'suspended') context.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    context = new AC();
    master = context.createGain();
    master.gain.value = 0.5;
    master.connect(context.destination);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function burst(duration, filterFreq, gainValue, type = 'lowpass') {
    if (!ensure()) return;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(now, Math.random() * 0.2);
    source.stop(now + duration);
  }

  function tone(freq, duration, gainValue, type = 'square', slideTo = null) {
    if (!ensure()) return;
    const osc = context.createOscillator();
    osc.type = type;
    const gain = context.createGain();
    const now = context.currentTime;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    gain.gain.setValueAtTime(gainValue, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain).connect(master);
    osc.start(now);
    osc.stop(now + duration);
  }

  function distanceGain(x, z, base) {
    const d = Math.hypot(x - listener.x, z - listener.z);
    return base / (1 + d * 0.06);
  }

  const SHOT_SHAPES = {
    rifle: [0.16, 1900, 0.5], smg: [0.11, 2300, 0.38], pistol: [0.12, 2100, 0.4],
    shotgun: [0.3, 1100, 0.7], sniper: [0.4, 900, 0.8], knife: [0.05, 3000, 0.1],
  };

  return {
    unlock() { ensure(); },
    setListener(x, z) { listener.x = x; listener.z = z; },
    shotAt(weaponId, x, z) {
      const [duration, freq, gain] = SHOT_SHAPES[weaponId] ?? SHOT_SHAPES.rifle;
      burst(duration, freq * (1 - Math.min(0.5, Math.hypot(x - listener.x, z - listener.z) * 0.008)), distanceGain(x, z, gain));
    },
    dryFire() { tone(1400, 0.04, 0.12, 'square'); },
    reload() { tone(300, 0.05, 0.15, 'square'); setTimeout(() => tone(420, 0.05, 0.15, 'square'), 160); },
    hit(kill) { tone(kill ? 1180 : 880, 0.07, 0.2, 'sine'); },
    hurt() { burst(0.12, 500, 0.3); },
    throwWhoosh() { burst(0.18, 1200, 0.12, 'bandpass'); },
    explode(x, z) { burst(0.7, 300, distanceGain(x, z, 1.4)); tone(70, 0.6, 0.5, 'sine', 34); },
    flashPop(x, z) { burst(0.08, 4000, distanceGain(x, z, 0.4), 'highpass'); },
    beep(final = false) { tone(final ? 1320 : 880, final ? 0.3 : 0.08, 0.22, 'square'); },
    channelTick() { tone(660, 0.04, 0.1, 'square'); },
    buy() { tone(990, 0.06, 0.15, 'sine'); setTimeout(() => tone(1320, 0.08, 0.15, 'sine'), 70); },
    roundEnd(won) { tone(won ? 660 : 392, 0.16, 0.2, 'triangle'); setTimeout(() => tone(won ? 880 : 330, 0.24, 0.2, 'triangle'), 150); },
  };
}

// Local, opt-in venue audio: no downloaded tracks, autoplay, or audio requests.
export class ArenaAudio {
  constructor() {
    this.enabled = false;
    this.paused = false;
  }
  async toggle() {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      const c = this.context;
      this.master = c.createGain(); this.master.gain.value = 0;
      this.master.connect(c.destination);
      this.noise = c.createBuffer(1, c.sampleRate * 4, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const bed = c.createBufferSource(), low = c.createBiquadFilter(), high = c.createBiquadFilter();
      bed.buffer = this.noise; bed.loop = true;
      low.type = "lowpass"; low.frequency.value = 850;
      high.type = "highpass"; high.frequency.value = 260;
      this.crowd = c.createGain(); this.crowd.gain.value = 0.045;
      bed.connect(low); low.connect(high); high.connect(this.crowd); this.crowd.connect(this.master); bed.start();
      // Slow breathing keeps the venue from sounding like steady white noise.
      const swell = c.createOscillator(), amount = c.createGain();
      swell.frequency.value = 0.32; amount.gain.value = 0.012;
      swell.connect(amount); amount.connect(this.crowd.gain); swell.start();
    }
    await this.context.resume();
    this.enabled = !this.enabled;
    this.sync();
    return this.enabled;
  }
  sync() {
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.enabled && !this.paused ? 0.65 : 0, now, 0.025);
  }
  setPaused(paused) {
    if (this.paused === paused) return;
    this.paused = paused; this.sync();
  }
  note(frequency, duration, volume, type = "sine", delay = 0, fall = 1) {
    if (!this.enabled || this.paused) return;
    const c = this.context, now = c.currentTime + delay, osc = c.createOscillator(), gain = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.exponentialRampToValueAtTime(frequency * fall, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain); gain.connect(this.master); osc.start(now); osc.stop(now + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  noiseCue(duration, volume, frequency, q = 0.8) {
    if (!this.enabled || this.paused) return;
    const c = this.context, now = c.currentTime, source = c.createBufferSource(), filter = c.createBiquadFilter(), gain = c.createGain();
    source.buffer = this.noise; filter.type = "bandpass"; filter.frequency.value = frequency; filter.Q.value = q;
    gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(volume, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start(now, Math.random()); source.stop(now + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  bell() {
    [660, 1056, 1584].forEach((f, i) => this.note(f, 0.9 - i * 0.18, 0.09 / (i + 1)));
  }
  cheer(big = false) {
    this.noiseCue(big ? 2.4 : 0.85, big ? 0.22 : 0.1, 730, 1.1);
    this.noiseCue(big ? 2.1 : 0.7, big ? 0.1 : 0.04, 1400, 2);
  }
  exchange(events) {
    const hit = events.find((event) => event.damage > 0);
    if (events.some((event) => event.outcome === "block")) {
      this.note(960, 0.19, 0.055, "triangle", 0, 0.65);
      this.noiseCue(0.12, 0.08, 2300);
    }
    if (!hit) return;
    const big = events.some((event) => event.action === "ultimate" && event.damage > 0);
    this.note(big ? 110 : 150, big ? 0.32 : 0.14, big ? 0.17 : 0.1, "sine", 0, 0.35);
    this.noiseCue(big ? 0.38 : 0.14, big ? 0.24 : 0.15, 450);
    if (big || hit.damage >= 12) this.cheer(big);
  }
  knockout() { this.bell(); this.cheer(true); }
  victory() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.note(f, 0.65, 0.07, "triangle", i * 0.12));
    this.cheer(true);
  }
}

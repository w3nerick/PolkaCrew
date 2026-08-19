let context: AudioContext | null = null;
let master: GainNode | null = null;
let ambience: { oscillators: OscillatorNode[]; gain: GainNode } | null = null;
let muted = false;

function audio() {
  if (typeof window === 'undefined') return null;
  if (!context) {
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(context.destination);
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(frequency: number, duration: number, gain = .035, offset = 0, type: OscillatorType = 'sine') {
  const ctx = audio();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  amp.gain.setValueAtTime(0, ctx.currentTime + offset);
  amp.gain.linearRampToValueAtTime(gain, ctx.currentTime + offset + .015);
  amp.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + offset + duration);
  oscillator.connect(amp).connect(master ?? ctx.destination);
  oscillator.start(ctx.currentTime + offset);
  oscillator.stop(ctx.currentTime + offset + duration + .03);
}

export const gameSound = {
  setMuted(value: boolean) {
    muted = value;
    if (context && master) master.gain.setTargetAtTime(value ? 0 : 1, context.currentTime, .03);
  },
  startAmbient() {
    const ctx = audio();
    if (!ctx || ambience) return;
    const gain = ctx.createGain();
    gain.gain.value = .012;
    gain.connect(master ?? ctx.destination);
    const oscillators = [55, 82.5].map((frequency, index) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = index ? 'sine' : 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = index ? 7 : -5;
      oscillator.connect(gain);
      oscillator.start();
      return oscillator;
    });
    ambience = { oscillators, gain };
  },
  stopAmbient() {
    ambience?.oscillators.forEach(oscillator => oscillator.stop());
    ambience?.gain.disconnect();
    ambience = null;
  },
  task() { tone(520, .1); tone(780, .16, .035, .08); },
  report() { tone(220, .2, .05, 0, 'sawtooth'); tone(150, .25, .04, .12, 'square'); },
  kill() { tone(90, .28, .06, 0, 'sawtooth'); },
  sabotage() { tone(180, .18, .04, 0, 'square'); tone(150, .18, .04, .2, 'square'); },
  vote() { tone(410, .09); },
  win() { [392, 523, 659, 784].forEach((f, i) => tone(f, .24, .035, i * .08)); },
  lose() { [320, 260, 190].forEach((f, i) => tone(f, .28, .04, i * .11, 'triangle')); },
};

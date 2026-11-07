import { requestVibration } from "./vibration";

let context: AudioContext | null = null;
let tone: OscillatorNode | null = null;

export function stopControllerFeedback() {
  if (tone) {
    tone.stop();
    tone.disconnect();
    tone = null;
  }
  requestVibration(0);
}

export function previewControllerRhythm(sequence: number[]) {
  stopControllerFeedback();
  if (!sequence.length) return;
  if (!document.hidden) requestVibration(sequence);
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => {});
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 440;
  gain.gain.value = 0;
  oscillator.connect(gain);
  gain.connect(context.destination);
  let time = context.currentTime;
  for (let i = 0; i < sequence.length; i++) {
    const duration = sequence[i] / 1000;
    if (i % 2 === 0) {
      const fade = Math.min(.008, duration / 3);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(.08, time + fade);
      gain.gain.setValueAtTime(.08, time + duration - fade);
      gain.gain.linearRampToValueAtTime(0, time + duration);
    }
    time += duration;
  }
  tone = oscillator;
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    if (tone === oscillator) tone = null;
  };
  oscillator.start();
  oscillator.stop(time);
}

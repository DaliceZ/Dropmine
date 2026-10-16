export class CompletionSound {
  private context?: AudioContext;
  private stopped = false;

  private unlock = () => {
    if (this.stopped) return;
    try {
      this.context ??= new AudioContext();
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => undefined);
    } catch {
      this.context = undefined;
    }
  };

  start() {
    this.stopped = false;
    document.addEventListener("pointerdown", this.unlock, true);
    document.addEventListener("keydown", this.unlock, true);
  }

  play() {
    const context = this.context;
    if (!context || context.state !== "running" || this.stopped) return;
    try {
      const start = context.currentTime;
      for (const [offset, frequency] of [
        [0, 1046.5],
        [0.13, 1568],
      ]) {
        for (const harmonic of [1, 2]) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = "sine";
          oscillator.frequency.value = frequency * harmonic;
          gain.gain.setValueAtTime(0, start + offset);
          gain.gain.linearRampToValueAtTime(
            harmonic === 1 ? 0.065 : 0.012,
            start + offset + 0.008,
          );
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.65);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(start + offset);
          oscillator.stop(start + offset + 0.7);
          oscillator.onended = () => {
            oscillator.disconnect();
            gain.disconnect();
          };
        }
      }
    } catch {
      return;
    }
  }

  stop() {
    this.stopped = true;
    document.removeEventListener("pointerdown", this.unlock, true);
    document.removeEventListener("keydown", this.unlock, true);
    if (this.context) void this.context.close().catch(() => undefined);
    this.context = undefined;
  }
}

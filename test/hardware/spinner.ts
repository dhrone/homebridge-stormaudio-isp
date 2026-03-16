/**
 * Terminal spinner with percentage display for the hardware test harness.
 *
 * Shows a spinning character and a two-digit percentage on a single line,
 * overwriting itself in place. Clears cleanly before any other output.
 */

const FRAMES = ['|', '/', '-', '\\'];
const INTERVAL_MS = 100;

export class Spinner {
  private frameIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private label = '';
  private percent = 0;

  /** Start the spinner with an initial label and percentage. */
  start(label: string, percent: number): void {
    this.label = label;
    this.percent = percent;
    this.frameIndex = 0;
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % FRAMES.length;
      this.render();
    }, INTERVAL_MS);
  }

  /** Update the label and/or percentage while spinning. */
  update(label: string, percent: number): void {
    this.label = label;
    this.percent = percent;
  }

  /** Clear the spinner line and stop. Call before printing other output. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    process.stdout.write('\r\x1b[K');
  }

  private render(): void {
    const pct = String(Math.round(this.percent)).padStart(2, ' ');
    process.stdout.write(`\r${FRAMES[this.frameIndex]}  ${pct}%  ${this.label}\x1b[K`);
  }
}

/**
 * Sleep for a duration while displaying a spinner with countdown progress.
 * The percentage shown interpolates from `startPct` to `endPct` over the wait.
 */
export function sleepWithProgress(
  ms: number,
  spinner: Spinner,
  label: string,
  startPct: number,
  endPct: number,
): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const fraction = Math.min(elapsed / ms, 1);
      spinner.update(label, startPct + (endPct - startPct) * fraction);
    }, INTERVAL_MS);

    setTimeout(() => {
      clearInterval(tick);
      spinner.update(label, endPct);
      resolve();
    }, ms);
  });
}

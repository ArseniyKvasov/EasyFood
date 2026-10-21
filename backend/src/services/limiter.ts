/** Ограничитель частоты запросов: сколько в секунду и сколько одновременно. */
export class RateLimiter {
  private stamps: number[] = [];
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly maxPerSecond: number,
    private readonly maxConcurrent = 4,
  ) {}

  /** Ждёт свободного слота и отдаёт его вызывающему коду. */
  async take(): Promise<void> {
    await this.acquireSlot();
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < 1000);
      if (this.stamps.length < this.maxPerSecond) {
        this.stamps.push(now);
        return;
      }
      await sleep(Math.max(15, 1000 - (now - this.stamps[0]) + 5));
    }
  }

  /** Освобождает слот. Вызывать в finally. */
  release(): void {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

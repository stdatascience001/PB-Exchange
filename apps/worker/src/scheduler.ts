export function msUntilNextRun(hour: number, minute: number): number {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

export function scheduleDaily(hour: number, minute: number, task: () => Promise<void>): void {
  const run = async () => {
    try {
      await task();
    } catch (err) {
      console.error('[Worker] Scheduled task failed:', err);
    }
    setTimeout(run, msUntilNextRun(hour, minute));
  };
  setTimeout(run, msUntilNextRun(hour, minute));
}

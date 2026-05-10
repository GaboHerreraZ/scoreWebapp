const CYCLE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CycleWindow {
  cycleStart: Date;
  cycleEnd: Date;
}

export function getCurrentCycleWindow(
  subscriptionStartDate: Date,
  now: Date = new Date(),
): CycleWindow {
  const start = new Date(subscriptionStartDate);
  const elapsedMs = now.getTime() - start.getTime();

  if (elapsedMs < 0) {
    return {
      cycleStart: start,
      cycleEnd: new Date(start.getTime() + CYCLE_DAYS * MS_PER_DAY),
    };
  }

  const completedCycles = Math.floor(elapsedMs / (CYCLE_DAYS * MS_PER_DAY));
  const cycleStart = new Date(
    start.getTime() + completedCycles * CYCLE_DAYS * MS_PER_DAY,
  );
  const cycleEnd = new Date(cycleStart.getTime() + CYCLE_DAYS * MS_PER_DAY);

  return { cycleStart, cycleEnd };
}

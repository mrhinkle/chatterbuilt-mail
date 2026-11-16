/** Wall time for a budget. Tests pass a clock that trips after one stored thread. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

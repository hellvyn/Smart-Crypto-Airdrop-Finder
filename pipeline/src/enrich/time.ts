/** Real waiting, for callers not given a sleep (tests inject a fake one so they never wait). */
export const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

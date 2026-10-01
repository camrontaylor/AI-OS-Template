export interface ExclusiveSubmitLock {
  tryAcquire: () => boolean;
  release: () => void;
}

export function createExclusiveSubmitLock(): ExclusiveSubmitLock {
  let locked = false;
  return {
    tryAcquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

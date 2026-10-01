export interface ScriptRunnerSession {
  begin(): boolean;
  dispose(): void;
  isDisposed(): boolean;
  complete(): boolean;
}

export function createScriptRunnerSession(): ScriptRunnerSession {
  let started = false;
  let disposed = false;
  let completed = false;

  return {
    begin() {
      disposed = false;
      if (started) {
        return false;
      }
      started = true;
      return true;
    },
    dispose() {
      disposed = true;
    },
    isDisposed() {
      return disposed;
    },
    complete() {
      if (completed) {
        return false;
      }
      completed = true;
      return true;
    },
  };
}

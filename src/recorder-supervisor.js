import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { home, atomic, json, id, redact } from "./util.js";

export const processAlive = (pid) => {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const file = (name) => path.join(home(), name);
export function acquireRecorderLock(name, instance) {
  const lock = file(name);
  fs.mkdirSync(home(), { recursive: true });
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(lock);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Recorder lock must be a real directory");
    const owner = json(path.join(lock, "owner.json"), null);
    // A process that just created the directory must have time to publish ownership.
    if (
      processAlive(owner?.pid) ||
      (!owner && Date.now() - stat.mtimeMs < 15000)
    )
      return null;
    const retired = `${lock}.${id()}.retired`;
    try {
      fs.renameSync(lock, retired);
    } catch {
      return null;
    }
    try {
      const ownerFile = path.join(retired, "owner.json");
      if (fs.existsSync(ownerFile)) fs.unlinkSync(ownerFile);
      fs.rmdirSync(retired);
    } catch {
      /* Unknown contents are preserved in the retired directory. */
    }
    try {
      fs.mkdirSync(lock);
    } catch {
      return null;
    }
  }
  atomic(path.join(lock, "owner.json"), { pid: process.pid, instance });
  return () => {
    if (json(path.join(lock, "owner.json"), null)?.instance !== instance)
      return;
    fs.unlinkSync(path.join(lock, "owner.json"));
    fs.rmdirSync(lock);
  };
}
export function requestRecorderStart(cli, { automatic = false } = {}) {
  const control = json(file("recorder-control.json"), null);
  if (automatic && control?.enabled === false)
    return { started: false, intentionallyStopped: true };
  if (!automatic || !control)
    atomic(file("recorder-control.json"), {
      enabled: true,
      generation: id(),
      at: Date.now(),
    });
  const state = json(file("supervisor.json"), null);
  if (processAlive(state?.pid))
    return {
      running: true,
      supervised: true,
      alreadyRunning: true,
      blocked: state.status === "blocked",
    };
  const lockOwner = json(file("supervisor.lock/owner.json"), null);
  if (processAlive(lockOwner?.pid))
    return { running: true, supervised: true, alreadyRunning: true };
  fs.mkdirSync(home(), { recursive: true });
  const log = fs.openSync(file("supervisor.log"), "a");
  try {
    const child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", cli, "supervisor"],
      {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
        env: process.env,
      },
    );
    child.unref();
    child.on("error", (error) =>
      atomic(file("supervisor-start-error.json"), {
        at: Date.now(),
        error: redact(error.message),
      }),
    );
    // Only the lock owner publishes supervisor.json; concurrent start calls cannot overwrite it.
    return { started: true, supervised: true, pid: child.pid };
  } finally {
    fs.closeSync(log);
  }
}
export function requestRecorderStop() {
  atomic(file("recorder-control.json"), {
    enabled: false,
    generation: id(),
    at: Date.now(),
  });
}
export async function runRecorderSupervisor(startRecorder) {
  const instance = id(),
    release = acquireRecorderLock("supervisor.lock", instance);
  if (!release) return;
  let state = {
    ...json(file("supervisor.json"), {}),
    pid: process.pid,
    instance,
    status: "starting",
  };
  let generation = null,
    attempts = [],
    nextAttempt = 0,
    observed = null,
    gap = null,
    finished = false;
  const save = () =>
    atomic(file("supervisor.json"), { ...state, heartbeat: Date.now() });
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearInterval(timer);
    state = { ...state, pid: null, status: "stopped", stoppedAt: Date.now() };
    save();
    release();
  };
  const tick = () => {
    if (finished) return;
    try {
      const control = json(file("recorder-control.json"), null);
      const installation = json(file("install.json"), null);
      if (control?.enabled !== true || installation?.active === false)
        return cleanup();
      if (generation !== control.generation) {
        generation = control.generation;
        attempts = [];
        nextAttempt = 0;
        state.lastError = null;
      }
      const daemon = json(file("daemon.json"), null);
      const healthy =
        processAlive(daemon?.pid) && Date.now() - daemon.heartbeat < 15000;
      if (healthy) {
        if (gap) {
          state.observationGaps = [
            ...(state.observationGaps || []),
            { ...gap, to: Date.now(), missingEventsReconstructed: false },
          ].slice(-20);
          gap = null;
        }
        observed = daemon;
        state.status = "running";
        state.currentError = null;
        state.openGap = null;
      } else {
        if (observed && !gap)
          gap = {
            from: observed.heartbeat,
            reason: "recorder unavailable or heartbeat stale",
          };
        state.openGap = gap;
        const owner = json(file("daemon.lock/owner.json"), null);
        if (processAlive(owner?.pid) || processAlive(daemon?.pid)) {
          state.status = "unhealthy";
          state.currentError =
            "Recorder heartbeat is stale; the live owner is preserved. Use dip stop then dip start.";
        } else {
          attempts = attempts.filter((at) => Date.now() - at < 60000);
          if (attempts.length >= 5) {
            state.status = "blocked";
            state.currentError =
              "Recorder restart limit reached (5 in 60 seconds). Inspect logs; dip start retries explicitly.";
            // Remain blocked until a new explicit start generation arrives.
            nextAttempt = Infinity;
          } else if (Date.now() >= nextAttempt) {
            attempts.push(Date.now());
            nextAttempt =
              Date.now() + Math.min(16000, 1000 * 2 ** (attempts.length - 1));
            if (observed) {
              state.restartCount = (state.restartCount || 0) + 1;
              state.lastFailure = {
                at: Date.now(),
                error: "Recorder exited unexpectedly",
              };
            }
            const result = startRecorder();
            state.status = "recovering";
            state.currentError = result.unhealthy ? result.message : null;
          }
        }
      }
      save();
    } catch (error) {
      state.currentError = redact(error.message);
      state.status = "unhealthy";
      state.lastFailure = { at: Date.now(), error: state.currentError };
      save();
    }
  };
  const timer = setInterval(tick, 1000);
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  tick();
}

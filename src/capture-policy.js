import { atomic, redactValue } from "./util.js";
import path from "node:path";

const defaults = Object.freeze({
  enabled: true,
  promptText: true,
  planText: true,
  commands: true,
  files: true,
});
export function capturePolicy(config = {}) {
  const settings = Object.hasOwn(config, "capture") ? config.capture : {};
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    throw new Error("capture must be an object of boolean settings");
  for (const [key, value] of Object.entries(settings))
    if (!Object.hasOwn(defaults, key) || typeof value !== "boolean")
      throw new Error(`Invalid capture setting: ${key}`);
  return { ...defaults, ...settings };
}
export function configureCapture(repo, patch) {
  const policy = capturePolicy({ capture: patch });
  const config = {
    ...repo.config,
    capture: { ...capturePolicy(repo.config), ...patch },
  };
  atomic(path.join(repo.dir, "config.json"), config);
  repo.config = config;
  return {
    ...policy,
    ...config.capture,
    explicitIntent: "available",
    historicalDataDeleted: false,
  };
}
export function minimizeActivity(config, value) {
  const policy = capturePolicy(config);
  if (!policy.enabled) return null;
  const data = redactValue(value);
  if (!policy.promptText) {
    delete data.prompt;
    delete data.user_prompt;
  }
  if (!policy.planText) delete data.plan;
  if (!policy.commands) {
    delete data.command;
    delete data.cmd;
    delete data.changeHash;
  }
  if (!policy.files) {
    for (const key of ["files", "path", "documents", "changeHash"])
      delete data[key];
    if (data.kind === "files.changed") return null;
  }
  return data;
}

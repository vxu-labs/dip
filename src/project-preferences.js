import fs from "node:fs";
import path from "node:path";
import { atomic, json } from "./util.js";

export const projectPreferencesPath = (directory) =>
  path.join(directory, "project-preferences.json");
export function readProjectPreferences(directory) {
  const file = projectPreferencesPath(directory);
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.isSymbolicLink()))
    throw Error("Project preferences must be a regular file");
  const data = json(file, { schemaVersion: 1, favorites: [] });
  if (
    data?.schemaVersion !== 1 ||
    !Array.isArray(data.favorites) ||
    data.favorites.some(
      (id) => typeof id !== "string" || !/^[a-f0-9]{24}$/.test(id),
    )
  )
    throw Error("Invalid project preferences; the original file was preserved");
  return { file, favorites: new Set(data.favorites) };
}

export function setProjectFavorite(runtime, id, favorite) {
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{24}$/.test(id) ||
    typeof favorite !== "boolean"
  )
    throw Error("Supply a project family ID and a boolean favorite value");
  if (!runtime.refreshProjects().projects.some((project) => project.id === id))
    throw Error("Project is not registered or is unavailable");
  // Preferences survive catalog/runtime-cache rebuilds. The same SQLite writer
  // mutex used by catalog publishers serializes read-modify-write across clients.
  runtime.db.exec("BEGIN IMMEDIATE");
  try {
    const { file, favorites } = readProjectPreferences(runtime.directory);
    if (favorites.has(id) !== favorite) {
      if (favorite) favorites.add(id);
      else favorites.delete(id);
      atomic(file, {
        schemaVersion: 1,
        favorites: [...favorites].sort(),
        updatedAt: new Date().toISOString(),
      });
    }
    runtime.db.exec("COMMIT");
  } catch (error) {
    runtime.db.exec("ROLLBACK");
    throw error;
  }
  const catalog = runtime.refreshProjects();
  return {
    id,
    favorite:
      catalog.projects.find((project) => project.id === id)?.favorite ??
      favorite,
    catalog,
  };
}

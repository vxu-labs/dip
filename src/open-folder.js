import { execFile } from "node:child_process";

// Called only after a token-protected dashboard action selects a registered
// directory. Argument arrays keep project names out of shell interpretation.
export function openProjectFolder(root) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "explorer.exe"
        : "xdg-open";
  return new Promise((resolve, reject) => {
    execFile(command, [root], { timeout: 10000, windowsHide: true }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

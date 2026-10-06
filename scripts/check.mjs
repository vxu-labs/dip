import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
for (const folder of ["src", "bin", "public", "scripts", "test"]) {
  for (const file of fs.readdirSync(folder))
    if (/\.(m?js)$/.test(file))
      execFileSync(process.execPath, ["--check", path.join(folder, file)], {
        stdio: "inherit",
        windowsHide: true,
      });
}
console.log("All JavaScript modules pass syntax checks.");

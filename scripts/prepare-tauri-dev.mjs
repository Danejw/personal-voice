import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.platform !== "win32") process.exit(0);

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const debugExe = path.join(repoRoot, "src-tauri", "target", "debug", "personal-voice-app.exe");
const escapedPath = debugExe.replaceAll("'", "''");

const command = [
  `$target = '${escapedPath}'`,
  "$matches = Get-Process -Name 'personal-voice-app' -ErrorAction SilentlyContinue |",
  "  Where-Object { $_.Path -and [System.StringComparer]::OrdinalIgnoreCase.Equals($_.Path, $target) }",
  "foreach ($process in $matches) {",
  "  Write-Host \"Stopping stale Personal Voice dev process $($process.Id)\"",
  "  Stop-Process -Id $process.Id -Force -ErrorAction Stop",
  "}",
].join("\n");

try {
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { stdio: "inherit" },
  );
} catch (error) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 1;
  console.error("Could not stop the stale Personal Voice debug process.");
  process.exit(Number.isFinite(status) && status > 0 ? status : 1);
}

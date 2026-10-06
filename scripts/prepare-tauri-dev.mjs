import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

if (process.platform !== "win32") process.exit(0);

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");
const debugExe = path.join(repoRoot, "src-tauri", "target", "debug", "personal-voice-app.exe");
const escapedPath = debugExe.replaceAll("'", "''");

const command = [
  `$target = '${escapedPath}'`,
  `$matches = @(Get-CimInstance Win32_Process -Filter "Name='personal-voice-app.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and [System.StringComparer]::OrdinalIgnoreCase.Equals($_.ExecutablePath, $target) })`,
  `foreach ($process in $matches) { Write-Host "Stopping stale Personal Voice dev process $($process.ProcessId)"; Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop }`,
].join("; ");

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
  process.stderr.write("Could not stop the stale Personal Voice debug process.\n");
  process.exit(Number.isFinite(status) && status > 0 ? status : 1);
}

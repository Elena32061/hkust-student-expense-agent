import { spawn } from "node:child_process";

export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

// Bound both time and combined stdout/stderr, and never expose receipt/model output in errors.
export async function runCommand(command, args = [], {
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  label = "External command",
} = {}) {
  if (typeof command !== "string" || !command.trim()) throw new Error(`${label}: executable is required.`);
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw new Error(`${label}: arguments must be strings.`);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) throw new Error(`${label}: timeoutMs must be an integer from 1 to 600000.`);
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024) throw new Error(`${label}: maxOutputBytes must be an integer from 1 to 16777216.`);
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { env, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let bytes = 0;
    let failure;
    let finished = false;
    let killTimer;
    const stop = signal => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch { /* The process may have already exited. */ }
    };
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (error) reject(error); else resolve(value);
    };
    const abort = message => {
      if (failure) return;
      failure = new Error(message);
      stop("SIGTERM");
      killTimer = setTimeout(() => {
        stop("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        finish(failure);
      }, 200);
    };
    const timer = setTimeout(() => abort(`${label} timed out after ${timeoutMs} ms. Increase timeoutMs if this operation normally takes longer.`), timeoutMs);
    const collect = (chunk, stdout) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) {
        abort(`${label} exceeded maxOutputBytes (${maxOutputBytes}). Reduce the input or increase the configured limit.`);
      } else if (stdout && !failure) {
        chunks.push(chunk);
      }
    };
    child.stdout.on("data", chunk => collect(chunk, true));
    child.stderr.on("data", chunk => collect(chunk, false));
    child.on("error", error => {
      finish(new Error(error.code === "ENOENT"
        ? `${label}: executable not found. Install the required tool or configure its command path.`
        : `${label}: could not start the executable (${error.code || "unknown error"}).`));
    });
    child.on("close", (code, signal) => {
      if (failure) {
        // Descendants can outlive the leader even when its output pipes close.
        stop("SIGKILL");
        finish(failure);
      } else if (code !== 0) {
        finish(new Error(`${label} failed (${signal ? `signal ${signal}` : `exit ${code}`}). Check the tool configuration; command output was omitted because it may contain receipt data.`));
      } else {
        finish(null, Buffer.concat(chunks).toString("utf8"));
      }
    });
  });
}

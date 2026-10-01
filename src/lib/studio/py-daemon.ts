import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const MISSING_PYTHON =
  "Set ALIGNER_PYTHON to the virtualenv Python that has torchaudio and demucs, for example .venv/bin/python. python3 on PATH is not used.";

export function resolveAlignerPython(): { bin: string } | { error: string } {
  const fromEnv = process.env.ALIGNER_PYTHON?.trim();
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      return { error: `ALIGNER_PYTHON is set to ${fromEnv}, but that file does not exist.` };
    }
    return { bin: fromEnv };
  }
  const candidates = [
    path.join(process.cwd(), ".venv", "bin", "python"),
    path.join(process.cwd(), ".venv", "Scripts", "python.exe"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return { bin: candidate };
  }
  return { error: MISSING_PYTHON };
}

type Spec = {
  key: string;
  script: string;
  label: string;
  timeoutMessage?: string;
};

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type State = {
  child: ChildProcessWithoutNullStreams | null;
  ready: boolean;
  buffer: string;
  stderr: string;
  nextId: number;
  pending: Map<string, Pending>;
};

// legacy name, do not rename
const POOL_KEY = "__aftercutPythonDaemons";
const globals = globalThis as typeof globalThis & { [POOL_KEY]?: Map<string, State> };
const pool = globals[POOL_KEY] ?? new Map<string, State>();
globals[POOL_KEY] = pool;

function killChild(child: ChildProcessWithoutNullStreams) {
  const hard = setTimeout(() => {
    if (child.exitCode == null && child.signalCode == null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }, 1500);
  hard.unref();
  child.once("exit", () => clearTimeout(hard));
  try {
    child.kill("SIGTERM");
  } catch {
    clearTimeout(hard);
  }
}

function rejectPending(state: State, error: Error) {
  for (const [id, job] of state.pending) {
    clearTimeout(job.timer);
    job.reject(error);
    state.pending.delete(id);
  }
}

function failAll(state: State, error: Error) {
  state.ready = false;
  const current = state.child;
  state.child = null;
  if (current) killChild(current);
  rejectPending(state, error);
}

function ensure(state: State, spec: Spec): string | null {
  if (state.child) return null;
  const resolved = resolveAlignerPython();
  if ("error" in resolved) return resolved.error;
  state.buffer = "";
  state.stderr = "";
  state.ready = false;
  console.info(`[${spec.key}] python ${resolved.bin}`);
  const child = spawn(resolved.bin, ["-u", spec.script, "--serve"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONWARNINGS: "ignore",
      TQDM_DISABLE: "1",
    },
  });
  state.child = child;
  child.unref();
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    (stream as unknown as { unref?: () => void }).unref?.();
  }
  child.stdout.on("data", (chunk) => {
    if (state.child !== child) return;
    state.buffer += String(chunk);
    let nl = state.buffer.indexOf("\n");
    while (nl >= 0) {
      const line = state.buffer.slice(0, nl).trim();
      state.buffer = state.buffer.slice(nl + 1);
      nl = state.buffer.indexOf("\n");
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (message.ready === true) {
        state.ready = true;
        continue;
      }
      const id = typeof message.id === "string" ? message.id : "";
      if (!id) continue;
      const job = state.pending.get(id);
      if (!job) continue;
      clearTimeout(job.timer);
      state.pending.delete(id);
      job.resolve(message);
    }
  });
  child.stderr.on("data", (chunk) => {
    if (state.child !== child) return;
    const text = String(chunk);
    state.stderr = (state.stderr + text).slice(-4000);
    const trimmed = text.trim();
    if (trimmed) console.info(trimmed);
  });
  child.on("exit", (code) => {
    // A worker we already replaced must not tear down the new process.
    if (state.child !== child) return;
    const detail = state.stderr.trim().split("\n").pop() || `process exited ${code ?? "unknown"}`;
    failAll(state, new Error(`${spec.label} is down. ${detail}`));
  });
  child.on("error", (err) => {
    if (state.child !== child) return;
    failAll(state, new Error(`${spec.label} is down. ${err.message}`));
  });
  return null;
}

function restart(state: State, spec: Spec, child: ChildProcessWithoutNullStreams | null) {
  if (child && state.child === child) {
    state.child = null;
    state.ready = false;
  }
  if (child) killChild(child);
  const error = ensure(state, spec);
  if (error) console.error(`[${spec.key}] restart failed: ${error}`);
}

function ask(state: State, spec: Spec, payload: Record<string, unknown>, timeoutMs: number) {
  const startError = ensure(state, spec);
  if (startError) return Promise.reject(new Error(`${spec.label} is down. ${startError}`));
  const id = String(state.nextId++);
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!state.pending.has(id)) return;
      const stuck = state.child;
      const message = spec.timeoutMessage ?? `${spec.label} is down. No result came back before the timeout.`;
      rejectPending(state, new Error(message));
      restart(state, spec, stuck);
    }, timeoutMs);
    state.pending.set(id, { resolve, reject, timer });
    const send = () => {
      if (!state.pending.has(id)) return;
      if (!state.child || !state.ready) {
        setTimeout(send, 50);
        return;
      }
      try {
        state.child.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
      } catch (err) {
        clearTimeout(timer);
        state.pending.delete(id);
        reject(err instanceof Error ? err : new Error(`${spec.label} is down.`));
      }
    };
    send();
  });
}

export function pythonDaemon(spec: Spec) {
  let state = pool.get(spec.key);
  if (!state) {
    state = { child: null, ready: false, buffer: "", stderr: "", nextId: 1, pending: new Map() };
    pool.set(spec.key, state);
  }
  return {
    start() {
      return ensure(state!, spec);
    },
    request(payload: Record<string, unknown>, timeoutMs: number) {
      return ask(state!, spec, payload, timeoutMs);
    },
  };
}

process.once("exit", () => {
  for (const state of pool.values()) state.child?.kill();
});

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pythonDaemon } from "./py-daemon.ts";

test("a timed-out job kills the worker so the next job is not queued behind it", async () => {
  // legacy name, do not rename
  const dir = mkdtempSync(path.join(tmpdir(), "aftercut-py-"));
  const script = path.join(dir, "stub.py");
  writeFileSync(
    script,
    [
      "import json, sys, time",
      "print(json.dumps({'ready': True}), flush=True)",
      "for line in sys.stdin:",
      "    job = json.loads(line)",
      "    time.sleep(float(job.get('sleep') or 0))",
      "    print(json.dumps({'id': job['id'], 'ok': True}), flush=True)",
      "",
    ].join("\n"),
  );
  const previous = process.env.ALIGNER_PYTHON;
  process.env.ALIGNER_PYTHON = "/usr/bin/python3";
  const daemon = pythonDaemon({
    key: `timeout-test-${process.pid}`,
    script,
    label: "Aligner",
    timeoutMessage: "Sync timed out, try a shorter snippet",
  });
  try {
    await assert.rejects(daemon.request({ sleep: 30 }, 500), /Sync timed out, try a shorter snippet/);
    const again = await daemon.request({ sleep: 0 }, 4000);
    assert.equal(again.ok, true);
  } finally {
    if (previous === undefined) delete process.env.ALIGNER_PYTHON;
    else process.env.ALIGNER_PYTHON = previous;
  }
});

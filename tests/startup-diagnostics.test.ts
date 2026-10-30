import test from "node:test";
import assert from "node:assert/strict";
import { startupDiagnostics } from "../src/environments/minecraft/startup-diagnostics.js";

test("startup failure reports DNS evidence using only read-only Docker commands", () => {
  const calls: string[][] = [];
  const report = startupDiagnostics("/unused-fixture", args => {
    calls.push(args);
    return args.includes("logs")
      ? "java.net.UnknownHostException: Failed to resolve 'launchermeta.mojang.com'\nQuery failed with SERVFAIL"
      : "minecraft unhealthy";
  });
  assert.match(report, /DNS failure/);
  assert.match(report, /launchermeta.mojang.com/);
  assert.match(report, /rerun the pipeline to complete installation/);
  assert.deepEqual(calls, [
    ["compose", "ps", "-a", "minecraft"],
    ["compose", "logs", "--no-color", "--tail", "100", "minecraft"],
  ]);
});

test("diagnostic collection failures do not obscure the startup failure", () => {
  const report = startupDiagnostics("/unused-fixture", () => { throw Error("Docker unavailable"); });
  assert.match(report, /health-check failure alone does not identify the cause/);
  assert.match(report, /No automatic reset retry/);
  assert.doesNotMatch(report, /encountered a DNS failure/);
});

/**
 * tests/integration/cron-resync-schedule-preserve.test.ts — batch item 9.
 *
 * Regression guard for the config-resync SCHEDULE-NULL bug (CONFIRMED moose
 * 2026-06-21, ~67% restart hit-rate on the SWL lane): on a daemon restart the
 * config → crons.json resync non-deterministically nulled the `schedule` field
 * of live config-owned crons. A nulled schedule = that cron silently stops
 * firing.
 *
 * The fix in resyncCronsFromConfig (cron-migration.ts) must PRESERVE the live
 * crons.json schedule whenever the incoming config schedule is missing/empty —
 * never overwrite a present, valid schedule with null/empty.
 *
 * These tests drive resync directly with a config.json whose entry has a
 * dropped / blank schedule while crons.json already holds a valid one, and
 * assert the live schedule survives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import type { CronDefinition } from '../../src/types/index.js';

let tmpCtxRoot: string;
let tmpFrameworkRoot: string;
const originalCtxRoot = process.env.CTX_ROOT;

let resyncCronsFromConfig: typeof import('../../src/daemon/cron-migration.js').resyncCronsFromConfig;
let readCrons: typeof import('../../src/bus/crons.js').readCrons;
let writeCrons: typeof import('../../src/bus/crons.js').writeCrons;

async function reloadModules() {
  vi.resetModules();
  const migModule = await import('../../src/daemon/cron-migration.js');
  resyncCronsFromConfig = migModule.resyncCronsFromConfig;
  const cronsModule = await import('../../src/bus/crons.js');
  readCrons = cronsModule.readCrons;
  writeCrons = cronsModule.writeCrons;
}

function writeRawConfig(agentDir: string, crons: unknown[]): string {
  mkdirSync(agentDir, { recursive: true });
  const configPath = join(agentDir, 'config.json');
  writeFileSync(
    configPath,
    JSON.stringify({ agent_name: 'test', enabled: true, crons }),
    'utf-8',
  );
  return configPath;
}

function byName(crons: CronDefinition[], name: string): CronDefinition | undefined {
  return crons.find((c) => c.name === name);
}

/** A live config-owned cron exactly as it would sit in crons.json post-migration. */
function liveCron(name: string, schedule: string): CronDefinition {
  return {
    name,
    prompt: `Read ${name}.md and run.`,
    schedule,
    enabled: true,
    created_at: '2026-04-01T00:00:00.000Z',
    metadata: { migrated_from_config: true, original_type: 'recurring' },
  };
}

beforeEach(async () => {
  tmpCtxRoot = mkdtempSync(join(tmpdir(), 'cron-resync-sched-ctx-'));
  tmpFrameworkRoot = mkdtempSync(join(tmpdir(), 'cron-resync-sched-fw-'));
  process.env.CTX_ROOT = tmpCtxRoot;
  await reloadModules();
});

afterEach(() => {
  vi.resetModules();
  if (originalCtxRoot !== undefined) {
    process.env.CTX_ROOT = originalCtxRoot;
  } else {
    delete process.env.CTX_ROOT;
  }
  try { rmSync(tmpCtxRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(tmpFrameworkRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('config-resync — schedule preservation (batch item 9)', () => {
  it('preserves the live schedule when the config entry has a BLANK interval', () => {
    const agentDir = join(tmpFrameworkRoot, 'orgs', 'testorg', 'agents', 'humpy');

    // Live crons.json already has a healthy schedule (post-migration state).
    writeCrons('humpy', [liveCron('heartbeat', '6h')]);

    // config.json entry present but schedule field blank (the resync-time hazard).
    const configPath = writeRawConfig(agentDir, [
      { name: 'heartbeat', interval: '', prompt: 'Read heartbeat.md and run.' },
    ]);

    resyncCronsFromConfig('humpy', configPath, { log: () => {} });

    // Schedule MUST NOT be nulled — preserved from live crons.json.
    expect(byName(readCrons('humpy'), 'heartbeat')?.schedule).toBe('6h');
  });

  it('preserves the live schedule when the config entry DROPS interval/cron entirely', () => {
    const agentDir = join(tmpFrameworkRoot, 'orgs', 'testorg', 'agents', 'silver');

    writeCrons('silver', [
      liveCron('experiment-pr-merge', '0 0,6,12,18 * * *'),
      liveCron('graphify-a', '4h'),
    ]);

    // Both config entries lost their schedule field — the confirmed null hazard.
    const configPath = writeRawConfig(agentDir, [
      { name: 'experiment-pr-merge', prompt: 'Run experiment PR merge.' },
      { name: 'graphify-a', prompt: 'Run graphify A.' },
    ]);

    resyncCronsFromConfig('silver', configPath, { log: () => {} });

    const after = readCrons('silver');
    expect(byName(after, 'experiment-pr-merge')?.schedule).toBe('0 0,6,12,18 * * *');
    expect(byName(after, 'graphify-a')?.schedule).toBe('4h');
    // And neither got blanked.
    expect(byName(after, 'experiment-pr-merge')?.schedule).not.toBe('');
    expect(byName(after, 'graphify-a')?.schedule).not.toBe('');
  });

  it('still applies a LEGITIMATE schedule change (guard only blocks null/empty)', () => {
    const agentDir = join(tmpFrameworkRoot, 'orgs', 'testorg', 'agents', 'sockeye');

    writeCrons('sockeye', [liveCron('preview', '4h')]);

    // A real edit: operator changed 4h -> 2h in config.json. This must win.
    const configPath = writeRawConfig(agentDir, [
      { name: 'preview', interval: '2h', prompt: 'Read preview.md and run.' },
    ]);

    const result = resyncCronsFromConfig('sockeye', configPath, { log: () => {} });

    expect(result.updated).toContain('preview');
    expect(byName(readCrons('sockeye'), 'preview')?.schedule).toBe('2h');
  });

  it('does not report the cron as updated when the schedule was preserved (no false churn)', () => {
    const agentDir = join(tmpFrameworkRoot, 'orgs', 'testorg', 'agents', 'moose');

    writeCrons('moose', [liveCron('heartbeat', '6h')]);

    // Blank schedule in config — guard preserves '6h', so nothing actually changed.
    const configPath = writeRawConfig(agentDir, [
      { name: 'heartbeat', interval: '', prompt: 'Read heartbeat.md and run.' },
    ]);

    const result = resyncCronsFromConfig('moose', configPath, { log: () => {} });

    expect(result.updated).not.toContain('heartbeat');
    expect(byName(readCrons('moose'), 'heartbeat')?.schedule).toBe('6h');
  });
});

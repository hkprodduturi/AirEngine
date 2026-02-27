/**
 * Dev Watch Mode (H10 — with Self-Heal Integration)
 *
 * Watches a .air file for changes and re-transpiles incrementally.
 * Optionally runs the self-heal loop against the live app.
 *
 * Self-heal modes:
 *   off              — No self-heal (default)
 *   shadow           — Run QA + report only
 *   propose          — QA + propose transpiler patches
 *   transpiler-patch — QA + propose + verify + apply patches
 *
 * Single-flight lock: only one heal cycle runs at a time.
 * Child process retranspile: after heal-apply, retranspile via subprocess
 * so patched transpiler source is actually used.
 */

import { watch, readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { computeIncremental, saveManifest, hashContent } from '../transpiler/cache.js';
import type { CacheManifest } from '../transpiler/cache.js';
import { generateFlowSpec } from '../self-heal/flow-generator.js';
import { runDevHealLoop, isPromotionAllowed, type HealMode, type DevHealResult } from '../self-heal/heal-loop.js';
import type { FlowSpec, QAExecutor, VisualBaselineMode } from '../self-heal/runtime-qa.js';

export interface DevOptions {
  outDir: string;
  clientPort?: number;
  serverPort?: number;
  selfHeal?: 'off' | 'shadow' | 'propose' | 'transpiler-patch';
  qaFlow?: string | 'auto';
  healApply?: 'none' | 'verified';
  healDebounceMs?: number;
  healOnStart?: boolean;
}

export class DevServer {
  private airFile: string;
  private outDir: string;
  private clientPort: number;
  private serverPort: number;
  private selfHeal: HealMode;
  private qaFlow: string | 'auto';
  private healApply: 'none' | 'verified';
  private healDebounceMs: number;
  private healOnStart: boolean;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private healDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private serverProcess: ChildProcess | null = null;
  private clientProcess: ChildProcess | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private running = false;

  // Single-flight lock for heal cycles
  private healRunning = false;
  private healQueued = false;

  // Visual baseline mode: first cycle records missing, subsequent compare
  private healCycleCount = 0;

  constructor(airFile: string, options: DevOptions) {
    this.airFile = resolve(airFile);
    this.outDir = resolve(options.outDir);
    this.clientPort = options.clientPort ?? 3000;
    this.serverPort = options.serverPort ?? 3001;
    this.selfHeal = (options.selfHeal ?? 'off') as HealMode;
    this.qaFlow = options.qaFlow ?? 'auto';
    this.healApply = options.healApply ?? 'none';
    this.healDebounceMs = options.healDebounceMs ?? 2000;
    this.healOnStart = options.healOnStart ?? true;
  }

  async start(): Promise<void> {
    this.running = true;

    console.log(`\n  ⚡ AirEngine Dev Server\n`);
    console.log(`  Watching: ${this.airFile}`);
    console.log(`  Output:   ${this.outDir}`);
    if (this.selfHeal !== 'off') {
      console.log(`  Self-heal: ${this.selfHeal} (apply: ${this.healApply})`);
    }
    console.log('');

    // Initial transpile
    const hasBackend = this.transpileAndWrite();

    // Install deps if needed
    this.installDepsIfNeeded(hasBackend);

    // Start dev servers
    this.startClient();
    if (hasBackend) {
      this.startServer();
    }

    // Watch for changes
    this.watcher = watch(this.airFile, (_event) => {
      if (!this.running) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.onChange(), 100);
    });

    // Graceful shutdown
    const shutdown = () => this.stop();
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log(`  Client: http://localhost:${this.clientPort}`);
    if (hasBackend) {
      console.log(`  Server: http://localhost:${this.serverPort}`);
    }
    console.log(`\n  Watching for changes... (Ctrl+C to stop)\n`);

    // Self-heal on start (after servers are up)
    if (this.selfHeal !== 'off' && this.healOnStart) {
      // Wait for servers to be ready (poll health check)
      await this.waitForServersReady(hasBackend);
      this.scheduleHealCycle();
    }
  }

  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.healDebounceTimer) {
      clearTimeout(this.healDebounceTimer);
      this.healDebounceTimer = null;
    }
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
    if (this.clientProcess) {
      this.clientProcess.kill('SIGTERM');
      this.clientProcess = null;
    }
    console.log('\n  Dev server stopped.\n');
    process.exit(0);
  }

  private transpileAndWrite(): boolean {
    try {
      const source = readFileSync(this.airFile, 'utf-8');
      const ast = parse(source);
      const validation = validate(ast);

      if (!validation.valid) {
        console.error('  ❌ Validation errors:');
        validation.errors.forEach(e => console.error(`     ${e.code}: ${e.message}`));
        return false;
      }

      const sourceLines = source.split('\n').length;
      const result = transpile(ast, { outDir: this.outDir, sourceLines });

      // Incremental: only write changed files
      const incremental = computeIncremental(source, result.files, this.outDir);

      // Write changed files
      for (const f of incremental.changedFiles) {
        const fullPath = join(this.outDir, f.path);
        mkdirSync(dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, f.content);
      }

      // Remove deleted files
      for (const p of incremental.removedPaths) {
        const fullPath = join(this.outDir, p);
        if (existsSync(fullPath)) unlinkSync(fullPath);
      }

      // Save manifest for next incremental
      const newFileHashes: Record<string, string> = {};
      for (const f of result.files) {
        newFileHashes[f.path] = hashContent(f.content);
      }
      const manifest: CacheManifest = {
        version: 1,
        sourceHash: hashContent(source),
        files: newFileHashes,
        timestamp: Date.now(),
      };
      saveManifest(this.outDir, manifest);

      const changed = incremental.changedFiles.length;
      const total = result.files.length;
      console.log(`  ✅ ${changed}/${total} files changed (${incremental.skipped} skipped)`);

      return result.files.some(f => f.path.startsWith('server/'));
    } catch (err) {
      console.error(`  ❌ Transpile error: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private onChange(): void {
    console.log(`\n  🔄 Change detected, re-transpiling...`);
    const hasBackend = this.transpileAndWrite();

    // Restart server on backend changes (Vite handles client HMR)
    if (hasBackend && this.serverProcess) {
      console.log('  Restarting server...');
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
      setTimeout(() => this.startServer(), 500);
    }

    // Schedule debounced heal cycle after file change
    if (this.selfHeal !== 'off') {
      if (this.healDebounceTimer) clearTimeout(this.healDebounceTimer);
      this.healDebounceTimer = setTimeout(() => this.scheduleHealCycle(), this.healDebounceMs);
    }
  }

  // ---- Self-Heal Integration ----

  private scheduleHealCycle(): void {
    if (this.healRunning) {
      this.healQueued = true;
      return;
    }
    this.runHealCycle().catch(err => {
      console.error(`  [heal] Error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async runHealCycle(): Promise<void> {
    if (this.healRunning) return;
    this.healRunning = true;
    this.healCycleCount++;

    try {
      // Generate or load flow spec
      const flowSpec = this.getFlowSpec();
      if (!flowSpec) {
        console.log('  [heal] Could not generate flow spec');
        return;
      }

      const navSteps = flowSpec.steps.filter(s => s.action === 'click' && s.label.startsWith('Click nav')).length;
      const ctaSteps = flowSpec.steps.filter(s => s.dead_cta_check).length;
      const consoleSteps = flowSpec.steps.filter(s => s.action === 'check_console').length;
      console.log(`  [heal] Auto-generated flow: ${flowSpec.steps.length} steps (${navSteps} nav, ${ctaSteps} CTA, ${consoleSteps} console)`);

      // Determine visual baseline mode (H10 adjustment 7)
      const baselineMode: VisualBaselineMode = this.healCycleCount === 1 ? 'record-missing' : 'compare';

      // Get QA executor (dynamically import Playwright-backed executeFlow from scripts)
      const executeFlow = await this.getQAExecutor();
      if (!executeFlow) {
        console.log('  [heal] No QA executor available (install playwright for browser QA)');
        return;
      }

      // Run the heal loop
      const result = await runDevHealLoop({
        flowSpec,
        mode: this.selfHeal,
        outputDir: this.outDir,
        airFilePath: this.airFile,
        executeFlow,
        healApply: this.healApply,
        baselineMode,
        headless: true,
      });

      // Structured logging (H10 Batch 5)
      this.logHealResult(result);

      // After heal-apply: retranspile via child process + restart backend (H10 adjustments 5, 6)
      if (result.promotedFiles.length > 0) {
        console.log('  [heal] Re-transpile via child process...');
        const retranspileOk = this.retranspileViaChildProcess();
        if (retranspileOk) {
          // Restart backend if server files changed (H10 adjustment 6)
          const hasServerChanges = result.promotedFiles.some(f =>
            f.includes('server') || f.includes('express') || f.includes('api')
          );
          if (hasServerChanges && this.serverProcess) {
            console.log('  [heal] Restarting server (patched source affected backend)...');
            this.serverProcess.kill('SIGTERM');
            this.serverProcess = null;
            setTimeout(() => this.startServer(), 500);
          }

          // Re-run QA once to verify
          console.log('  [heal] QA re-run after patch...');
          const rerunResult = await runDevHealLoop({
            flowSpec,
            mode: 'shadow',
            outputDir: this.outDir,
            airFilePath: this.airFile,
            executeFlow,
            headless: true,
          });
          console.log(`  [heal] QA re-run: ${rerunResult.qaVerdict}`);
        }
      }

    } finally {
      this.healRunning = false;

      // Run queued heal cycle if pending
      if (this.healQueued) {
        this.healQueued = false;
        this.scheduleHealCycle();
      }
    }
  }

  private getFlowSpec(): FlowSpec | null {
    if (this.qaFlow === 'auto') {
      try {
        const source = readFileSync(this.airFile, 'utf-8');
        return generateFlowSpec(source, {
          clientPort: this.clientPort,
          serverPort: this.serverPort,
        });
      } catch (err) {
        console.error(`  [heal] Flow generation error: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }

    // Load from file
    try {
      const raw = readFileSync(this.qaFlow, 'utf-8');
      return JSON.parse(raw) as FlowSpec;
    } catch (err) {
      console.error(`  [heal] Failed to load flow spec: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private async getQAExecutor(): Promise<QAExecutor | null> {
    // Use createRequire to get a CJS require() that works in both ESM and CJS.
    // This avoids the "require is not defined" error when tsx loads dev.ts as ESM.
    const esmRequire = createRequire(import.meta.url);

    // When running under plain Node (e.g. installed CLI via dist/cli/index.js),
    // require('.ts') fails. Register the tsx CJS hook first so Node's require()
    // can load TypeScript files. No-op if tsx is already active or not installed.
    try {
      esmRequire('tsx/cjs');
    } catch { /* tsx not available — .ts require will only work under tsx runtime */ }

    // Search directories: CWD first (development), then package root (installed CLI).
    const thisDir = dirname(fileURLToPath(import.meta.url));
    const dirs = [
      join(process.cwd(), 'scripts'),
      join(thisDir, '..', '..', 'scripts'),
    ];

    for (const dir of dirs) {
      const scriptPath = join(dir, 'runtime-qa-run.ts');
      try {
        const mod = esmRequire(scriptPath) as Record<string, unknown>;
        if (mod.executeFlow) return mod.executeFlow as QAExecutor;
      } catch { continue; }
    }
    return null;
  }

  /** Retranspile via child process so patched transpiler source is used (H10 Batch 4) */
  private retranspileViaChildProcess(): boolean {
    try {
      execSync(
        `npx tsx src/cli/index.ts transpile "${this.airFile}" -o "${this.outDir}"`,
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 30000, stdio: 'pipe' },
      );
      console.log('  [heal] Re-transpile successful');
      return true;
    } catch (err) {
      console.error(`  [heal] Re-transpile failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private logHealResult(result: DevHealResult): void {
    if (result.qaVerdict === 'pass') {
      console.log(`  [heal] QA verdict: pass`);
      return;
    }

    console.log(`  [heal] QA verdict: ${result.qaVerdict} — ${result.deadCtas} dead CTAs, ${result.failedSteps} failed steps`);

    if (result.classifications.length > 0) {
      for (const cls of result.classifications) {
        console.log(`  [heal] Classified: ${cls}`);
      }
    }

    for (const patch of result.transpilerPatches) {
      console.log(`  [heal] Traced: ${patch.trace_id} (${patch.strategy}) → ${patch.transpiler_file} [${patch.verdict}]`);
    }

    if (result.promotedFiles.length > 0) {
      for (const f of result.promotedFiles) {
        console.log(`  [heal] Patch verified, applied to framework source: ${f}`);
      }
    }

    console.log(`  [heal] Overall: ${result.verdict} (${result.durationMs}ms)`);
  }

  /** Poll health check endpoint until ready, max 10s */
  private async waitForServersReady(hasBackend: boolean): Promise<void> {
    const url = hasBackend
      ? `http://localhost:${this.serverPort}/api/health`
      : `http://localhost:${this.clientPort}/`;
    const maxWaitMs = 10000;
    const pollIntervalMs = 500;
    const start = Date.now();

    while (Date.now() - start < maxWaitMs) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {
        // Server not ready yet
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
    console.log('  [heal] Server health check timed out — proceeding anyway');
  }

  private installDepsIfNeeded(hasBackend: boolean): void {
    const clientDir = hasBackend
      ? join(this.outDir, 'client')
      : this.outDir;

    if (!existsSync(join(clientDir, 'node_modules'))) {
      console.log('  📦 Installing client dependencies...');
      try {
        execSync('npm install', { cwd: clientDir, stdio: 'pipe' });
        console.log('  ✅ Client dependencies installed');
      } catch {
        console.error('  ⚠ Failed to install client deps (run npm install manually)');
      }
    }

    if (hasBackend) {
      const serverDir = join(this.outDir, 'server');
      if (!existsSync(join(serverDir, 'node_modules'))) {
        console.log('  📦 Installing server dependencies...');
        try {
          execSync('npm install', { cwd: serverDir, stdio: 'pipe' });
          console.log('  ✅ Server dependencies installed');
        } catch {
          console.error('  ⚠ Failed to install server deps (run npm install manually)');
        }
      }
    }
  }

  private startClient(): void {
    const clientDir = existsSync(join(this.outDir, 'client'))
      ? join(this.outDir, 'client')
      : this.outDir;

    this.clientProcess = spawn('npx', ['vite', '--port', String(this.clientPort)], {
      cwd: clientDir,
      stdio: 'pipe',
      shell: true,
    });

    this.clientProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`  [client] ${line}`);
    });

    this.clientProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line && !line.includes('ExperimentalWarning')) {
        console.error(`  [client] ${line}`);
      }
    });
  }

  private startServer(): void {
    const serverDir = join(this.outDir, 'server');
    if (!existsSync(serverDir)) return;

    this.serverProcess = spawn('npx', ['tsx', 'server.ts'], {
      cwd: serverDir,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, PORT: String(this.serverPort) },
    });

    this.serverProcess.stdout?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line) console.log(`  [server] ${line}`);
    });

    this.serverProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      if (line && !line.includes('ExperimentalWarning')) {
        console.error(`  [server] ${line}`);
      }
    });
  }
}

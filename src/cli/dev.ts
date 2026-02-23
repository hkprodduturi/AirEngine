/**
 * Dev Watch Mode
 *
 * Watches a .air file for changes and re-transpiles incrementally.
 * Uses Node built-in fs.watch (no chokidar dependency).
 */

import { watch, readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { computeIncremental, saveManifest, hashContent } from '../transpiler/cache.js';
import type { CacheManifest } from '../transpiler/cache.js';

export interface DevOptions {
  outDir: string;
  clientPort?: number;
  serverPort?: number;
}

export class DevServer {
  private airFile: string;
  private outDir: string;
  private clientPort: number;
  private serverPort: number;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private serverProcess: ChildProcess | null = null;
  private clientProcess: ChildProcess | null = null;
  private watcher: ReturnType<typeof watch> | null = null;
  private running = false;

  constructor(airFile: string, options: DevOptions) {
    this.airFile = resolve(airFile);
    this.outDir = resolve(options.outDir);
    this.clientPort = options.clientPort ?? 3000;
    this.serverPort = options.serverPort ?? 3001;
  }

  async start(): Promise<void> {
    this.running = true;

    console.log(`\n  ⚡ AirEngine Dev Server\n`);
    console.log(`  Watching: ${this.airFile}`);
    console.log(`  Output:   ${this.outDir}\n`);

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

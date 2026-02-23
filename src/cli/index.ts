#!/usr/bin/env node

/**
 * AirEngine CLI
 *
 * Usage:
 *   air generate "description"    Generate .air from natural language
 *   air transpile app.air         Transpile .air to React app
 *   air validate app.air          Validate .air file
 *   air init                      Create a starter .air file
 *   air dev app.air               Watch mode with live reload
 *   air doctor [file]             Check development environment
 */

import { Command } from 'commander';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { computeIncremental } from '../transpiler/cache.js';
import { readFileSync, mkdirSync, writeFileSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';

const program = new Command();

program
  .name('air')
  .description('AirEngine — AI-native Intermediate Representation Engine')
  .version('0.1.7');

program
  .command('generate')
  .description('Generate .air file from natural language description')
  .argument('<description>', 'Natural language app description')
  .option('-o, --output <file>', 'Output file path', 'app.air')
  .action(async (description, options) => {
    console.log(`\n  ⚡ AirEngine Generate\n`);
    console.log(`  Prompt: "${description}"`);
    console.log(`  Output: ${options.output}\n`);
    // TODO: Call LLM with AIR schema constraint
    console.log('  🚧 LLM generation coming in Phase 1\n');
  });

program
  .command('transpile')
  .description('Transpile .air file to React application')
  .argument('<file>', 'Path to .air file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-f, --framework <fw>', 'Target framework (only "react" supported)', 'react')
  .option('--target <mode>', 'Generation target: all, client, server, docs', 'all')
  .option('--no-incremental', 'Skip incremental cache')
  .action((file, options) => {
    console.log(`\n  ⚡ AirEngine Transpile\n`);

    if (options.framework !== 'react') {
      console.error(`  ❌ Unsupported framework '${options.framework}'. Only 'react' is currently supported.\n`);
      process.exit(1);
    }

    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      const validation = validate(ast);

      if (!validation.valid) {
        console.log('  ❌ Validation failed:\n');
        validation.errors.forEach(e => console.log(`     ${e.code}: ${e.message}`));
        process.exit(1);
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => console.log(`  ⚠  ${w.message}`));
        console.log('');
      }

      const sourceLines = source.split('\n').length;
      const target = options.target as 'all' | 'client' | 'server' | 'docs';
      const result = transpile(ast, { outDir: options.output, sourceLines, target });

      if (options.incremental !== false) {
        // Incremental: only write changed files
        const incremental = computeIncremental(source, result.files, options.output);

        for (const f of incremental.changedFiles) {
          const fullPath = join(options.output, f.path);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, f.content);
        }

        for (const p of incremental.removedPaths) {
          const fullPath = join(options.output, p);
          if (existsSync(fullPath)) unlinkSync(fullPath);
        }

        // computeIncremental already saved the cache manifest

        console.log(`  ✅ Transpiled ${file} → ${options.output}/`);
        console.log(`     → ${incremental.changedFiles.length}/${result.files.length} files changed (${incremental.skipped} skipped)`);
      } else {
        // Non-incremental: write all files
        for (const f of result.files) {
          const fullPath = join(options.output, f.path);
          mkdirSync(dirname(fullPath), { recursive: true });
          writeFileSync(fullPath, f.content);
        }

        console.log(`  ✅ Transpiled ${file} → ${options.output}/`);
        console.log(`     → ${result.files.length} files generated`);
      }

      console.log(`     → ${result.stats.outputLines} lines from ${result.stats.inputLines} source lines (${result.stats.compressionRatio}x)`);
      console.log(`     → ${result.stats.timing.totalMs}ms total (extract: ${result.stats.timing.extractMs}ms, analyze: ${result.stats.timing.analyzeMs}ms, client: ${result.stats.timing.clientGenMs}ms, server: ${result.stats.timing.serverGenMs}ms)\n`);
    } catch (err) {
      console.error(`  ❌ ${err}\n`);
      process.exit(1);
    }
  });

program
  .command('validate')
  .description('Validate an .air file')
  .argument('<file>', 'Path to .air file')
  .action((file) => {
    console.log(`\n  ⚡ AirEngine Validate\n`);
    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      const result = validate(ast);

      if (result.valid) {
        console.log(`  ✅ ${file} is valid\n`);
      } else {
        console.log(`  ❌ ${file} has errors:\n`);
        result.errors.forEach(e => console.log(`     ${e.code}: ${e.message}`));
      }

      if (result.warnings.length > 0) {
        console.log('');
        result.warnings.forEach(w => console.log(`  ⚠  ${w.message}`));
      }
      console.log('');
    } catch (err) {
      console.error(`  ❌ ${err}\n`);
      process.exit(1);
    }
  });

// ---- air init ----

program
  .command('init')
  .description('Create a starter .air file')
  .option('-n, --name <name>', 'App name', 'myapp')
  .option('--fullstack', 'Include @db and @api blocks')
  .option('--no-interactive', 'Skip prompts')
  .action(async (options) => {
    console.log(`\n  ⚡ AirEngine Init\n`);

    let appName = options.name;
    let fullstack = options.fullstack ?? false;

    if (options.interactive !== false) {
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (q: string): Promise<string> =>
        new Promise(resolve => rl.question(q, resolve));

      const nameAnswer = await ask(`  App name (${appName}): `);
      if (nameAnswer.trim()) appName = nameAnswer.trim();

      const fsAnswer = await ask('  Include backend (@db + @api)? (y/N): ');
      fullstack = fsAnswer.trim().toLowerCase() === 'y';

      rl.close();
    }

    const { generateInitTemplate } = await import('./templates.js');
    const template = generateInitTemplate(appName, fullstack);
    const outFile = `${appName}.air`;

    if (existsSync(outFile)) {
      console.log(`  ⚠ ${outFile} already exists. Skipping.\n`);
      return;
    }

    writeFileSync(outFile, template);
    console.log(`  ✅ Created ${outFile}`);
    console.log(`\n  Next steps:`);
    console.log(`    air transpile ${outFile} -o ./${appName}`);
    console.log(`    cd ${appName} && npm install && npm run dev\n`);
  });

// ---- air dev ----

program
  .command('dev')
  .description('Watch mode — re-transpile on change with live reload')
  .argument('<file>', 'Path to .air file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-p, --port <port>', 'Client dev server port', '3000')
  .option('--server-port <port>', 'API server port', '3001')
  .action(async (file, options) => {
    const { DevServer } = await import('./dev.js');
    const server = new DevServer(file, {
      outDir: options.output,
      clientPort: parseInt(options.port, 10),
      serverPort: parseInt(options.serverPort, 10),
    });
    await server.start();
  });

// ---- air doctor ----

program
  .command('doctor')
  .description('Check development environment readiness')
  .argument('[file]', 'Optional .air file to check')
  .action(async (file) => {
    console.log(`\n  ⚡ AirEngine Doctor\n`);

    const { runDoctorChecks } = await import('./doctor.js');
    const checks = await runDoctorChecks(file);

    const icons = { pass: '✅', fail: '❌', warn: '⚠️' };
    for (const check of checks) {
      console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
    }

    const fails = checks.filter(c => c.status === 'fail').length;
    const warns = checks.filter(c => c.status === 'warn').length;
    console.log('');
    if (fails > 0) {
      console.log(`  ${fails} issue(s) found. Fix them before proceeding.\n`);
      process.exit(1);
    } else if (warns > 0) {
      console.log(`  All good, ${warns} warning(s).\n`);
    } else {
      console.log(`  All checks passed!\n`);
    }
  });

program.parse();

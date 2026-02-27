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
  .option('--strict-handlers', 'Fail if any !handler mutations remain unresolved')
  .option('--no-incremental', 'Skip incremental cache')
  .action((file, options) => {
    console.log(`\n  ⚡ AirEngine Transpile\n`);

    if (options.framework !== 'react') {
      console.error(`  ERROR: Unsupported framework '${options.framework}'. Only 'react' is currently supported.\n`);
      process.exit(1);
    }

    try {
      const source = readFileSync(file, 'utf-8');
      const ast = parse(source);
      const validation = validate(ast);

      if (!validation.valid) {
        console.log('  FAIL: Validation failed:\n');
        validation.errors.forEach(e => console.log(`     ${e.code}: ${e.message}`));
        process.exit(1);
      }

      if (validation.warnings.length > 0) {
        validation.warnings.forEach(w => console.log(`  ⚠  ${w.message}`));
        console.log('');
      }

      const sourceLines = source.split('\n').length;
      const target = options.target as 'all' | 'client' | 'server' | 'docs';
      const result = transpile(ast, { outDir: options.output, sourceLines, target, strictHandlers: options.strictHandlers });

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
      console.log(`     → ${result.stats.timing.totalMs}ms total (extract: ${result.stats.timing.extractMs}ms, analyze: ${result.stats.timing.analyzeMs}ms, client: ${result.stats.timing.clientGenMs}ms, server: ${result.stats.timing.serverGenMs}ms)`);
      if (result.warnings && result.warnings.length > 0) {
        result.warnings.forEach(w => console.log(`  ⚠  ${w}`));
      }
      console.log('');
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
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
        console.log(`  FAIL: ${file} has errors:\n`);
        result.errors.forEach(e => console.log(`     ${e.code}: ${e.message}`));
      }

      if (result.warnings.length > 0) {
        console.log('');
        result.warnings.forEach(w => console.log(`  ⚠  ${w.message}`));
      }
      console.log('');
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
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

// ---- air qa-gen ----

program
  .command('qa-gen')
  .description('Generate a QA flow spec from a .air file')
  .argument('<file>', 'Path to .air file')
  .option('-o, --output <path>', 'Output flow spec JSON path', './qa-flow.json')
  .option('--client-port <port>', 'Client dev server port', '3000')
  .option('--server-port <port>', 'API server port', '3001')
  .option('--style-lane', 'Include style assertion steps', false)
  .option('--visual-lane', 'Include visual snapshot steps', false)
  .action(async (file, options) => {
    console.log(`\n  ⚡ AirEngine QA Flow Generator\n`);
    try {
      const source = readFileSync(file, 'utf-8');
      const { generateFlowSpec } = await import('../self-heal/flow-generator.js');
      const spec = generateFlowSpec(source, {
        clientPort: parseInt(options.clientPort, 10),
        serverPort: parseInt(options.serverPort, 10),
        styleLane: options.styleLane,
        visualLane: options.visualLane,
      });

      mkdirSync(dirname(options.output), { recursive: true });
      writeFileSync(options.output, JSON.stringify(spec, null, 2));

      console.log(`  ✅ Generated flow: ${spec.flow_id}`);
      console.log(`     → ${spec.steps.length} steps`);
      console.log(`     → ${options.output}\n`);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
  });

// ---- air dev ----

program
  .command('dev')
  .description('Watch mode — re-transpile on change with live reload')
  .argument('<file>', 'Path to .air file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-p, --port <port>', 'Client dev server port', '3000')
  .option('--server-port <port>', 'API server port', '3001')
  .option('--self-heal <mode>', 'Self-heal mode: off, shadow, propose, transpiler-patch', 'off')
  .option('--qa-flow <path>', 'QA flow spec path or "auto" to generate from AST', 'auto')
  .option('--heal-apply <mode>', 'Apply verified patches: none or verified', 'none')
  .option('--heal-debounce-ms <ms>', 'Debounce heal cycle after file change', '2000')
  .action(async (file, options) => {
    const { DevServer } = await import('./dev.js');
    const server = new DevServer(file, {
      outDir: options.output,
      clientPort: parseInt(options.port, 10),
      serverPort: parseInt(options.serverPort, 10),
      selfHeal: options.selfHeal,
      qaFlow: options.qaFlow,
      healApply: options.healApply,
      healDebounceMs: parseInt(options.healDebounceMs, 10),
      healOnStart: true,
    });
    await server.start();
  });

// ---- air loop ----

program
  .command('loop')
  .description('Run the full agent loop: validate → repair → transpile → smoke → deliver')
  .argument('<file>', 'Path to .air file')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('--repair-mode <mode>', 'Repair mode: deterministic, claude, or none', 'deterministic')
  .option('--max-repair-attempts <n>', 'Maximum repair attempts (1-5)', '1')
  .option('--claude-model <model>', 'Claude model for repair (only with --repair-mode claude)')
  .action(async (file, options) => {
    console.log(`\n  ⚡ AirEngine Loop\n`);

    const repairMode = options.repairMode as 'deterministic' | 'claude' | 'none';
    const maxRepairAttempts = Math.max(1, Math.min(5, parseInt(options.maxRepairAttempts, 10) || 1));

    // Early fail if Claude mode without API key
    if (repairMode === 'claude' && !process.env.ANTHROPIC_API_KEY) {
      console.error('  ERROR: ANTHROPIC_API_KEY not set. Required for --repair-mode claude.');
      console.error('  Hint: Use --repair-mode deterministic for offline repair.\n');
      process.exit(1);
    }

    try {
      const { runLoopFromSource, formatLoopResult } = await import('./loop.js');
      const source = readFileSync(file, 'utf-8');
      const result = await runLoopFromSource(source, options.output, {
        file,
        repairMode,
        maxRepairAttempts,
        ...(repairMode === 'claude' ? {
          claudeRepairOptions: {
            model: options.claudeModel,
          },
        } : {}),
      });
      console.log(formatLoopResult(result));

      // A validate fail is compensated by a repair pass
      const repairStage = result.stages.find(s => s.name === 'repair');
      const failed = result.stages.some(s => {
        if (s.name === 'validate' && repairStage?.status === 'pass') return false;
        return s.status === 'fail';
      });
      if (failed) {
        console.log('\n  Loop completed with failures.\n');
        process.exit(1);
      } else {
        console.log(`\n  Loop completed successfully → ${options.output}/\n`);
      }
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : err}\n`);
      process.exit(1);
    }
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

    const labels = { pass: 'PASS', fail: 'FAIL', warn: 'WARN' } as const;
    for (const check of checks) {
      console.log(`  ${labels[check.status].padEnd(4)} ${check.name}: ${check.message}`);
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

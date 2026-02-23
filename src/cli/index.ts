#!/usr/bin/env node

/**
 * AirEngine CLI
 *
 * Usage:
 *   air generate "description"    Generate .air from natural language
 *   air transpile app.air         Transpile .air to React app
 *   air validate app.air          Validate .air file
 *   air decompile app.air         Generate human-readable code view
 */

import { Command } from 'commander';
import { parse } from '../parser/index.js';
import { validate } from '../validator/index.js';
import { transpile } from '../transpiler/index.js';
import { readFileSync } from 'fs';

const program = new Command();

program
  .name('air')
  .description('AirEngine — AI-native Intermediate Representation Engine')
  .version('0.1.0');

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
  .option('-f, --framework <fw>', 'Target framework', 'react')
  .action((file, options) => {
    console.log(`\n  ⚡ AirEngine Transpile\n`);
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

      const result = transpile(ast, { outDir: options.output });
      console.log(`  ✅ Transpiled ${file}`);
      console.log(`     → ${result.files.length} files generated`);
      console.log(`     → ${result.stats.outputLines} lines of output\n`);
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

program.parse();

#!/usr/bin/env node
/**
 * tests/run_all_tests.js
 * 
 * Master Automated Test Runner for the ORHIDEEA 2005 FoxPro Parity Upgrade.
 * Discovers and executes all E2E, Golden-Month, and Adversarial test suites
 * using Node.js native test runner (`node --test`).
 * 
 * Usage:
 *   node tests/run_all_tests.js [options]
 * 
 * Options:
 *   --suite <e2e|golden|adversarial>   Filter tests by directory suite
 *   --filter <regex>, -f <regex>       Filter tests by filename or pattern
 *   --list                             List all discovered test files without running
 *   --bail                             Stop execution on the first failing test file
 *   --help, -h                         Display this help message
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TESTS_ROOT = __dirname;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    suite: null,
    filter: null,
    list: false,
    bail: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--list') {
      options.list = true;
    } else if (arg === '--bail') {
      options.bail = true;
    } else if (arg.startsWith('--suite=')) {
      options.suite = arg.split('=')[1];
    } else if (arg === '--suite' && i + 1 < args.length) {
      options.suite = args[++i];
    } else if (arg.startsWith('--filter=')) {
      options.filter = arg.split('=')[1];
    } else if ((arg === '--filter' || arg === '-f') && i + 1 < args.length) {
      options.filter = args[++i];
    }
  }

  return options;
}

function findTestFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'helpers') {
        findTestFiles(fullPath, fileList);
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

function printHelp() {
  console.log(`
======================================================================
  ORHIDEEA 2005 PARITY TEST RUNNER (Node.js Test Framework)
======================================================================

Usage:
  node tests/run_all_tests.js [options]
  npm test

Options:
  --suite <name>       Filter tests by suite directory (e.g. e2e, golden)
  --filter, -f <regex> Filter tests by filename pattern
  --bail               Stop on first failure
  --list               List all discovered test files without executing
  --help, -h           Show this help message

Examples:
  node tests/run_all_tests.js
  node tests/run_all_tests.js --suite golden
  node tests/run_all_tests.js --filter schema
  node tests/run_all_tests.js --bail
`);
}

function main() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  console.log('======================================================================');
  console.log('  ORHIDEEA 2005 FOXPRO PARITY TEST RUNNER');
  console.log('======================================================================');

  let testFiles = findTestFiles(TESTS_ROOT);

  // Apply suite filter
  if (options.suite) {
    const targetDir = path.join(TESTS_ROOT, options.suite).toLowerCase();
    testFiles = testFiles.filter(f => f.toLowerCase().startsWith(targetDir));
  }

  // Apply pattern filter
  if (options.filter) {
    const regex = new RegExp(options.filter, 'i');
    testFiles = testFiles.filter(f => regex.test(path.basename(f)) || regex.test(f));
  }

  if (testFiles.length === 0) {
    console.log(`⚠️  No test files found matching criteria.`);
    process.exit(0);
  }

  if (options.list) {
    console.log(`Found ${testFiles.length} test files:`);
    for (const f of testFiles) {
      console.log(`  - ${path.relative(path.join(TESTS_ROOT, '..'), f)}`);
    }
    process.exit(0);
  }

  console.log(`Discovered ${testFiles.length} test file(s):`);
  for (const f of testFiles) {
    console.log(`  • ${path.relative(path.join(TESTS_ROOT, '..'), f)}`);
  }
  console.log('----------------------------------------------------------------------\n');

  let passedSuites = 0;
  let failedSuites = 0;
  const suiteResults = [];

  for (const file of testFiles) {
    const relPath = path.relative(path.join(TESTS_ROOT, '..'), file);
    console.log(`\n▶ Running: ${relPath}`);
    console.log('----------------------------------------------------------------------');

    const result = spawnSync(
      process.execPath,
      ['--test', file],
      { stdio: 'inherit', env: process.env }
    );

    if (result.status === 0) {
      passedSuites++;
      suiteResults.push({ file: relPath, status: 'PASS' });
      console.log(`✔ Passed: ${relPath}`);
    } else {
      failedSuites++;
      suiteResults.push({ file: relPath, status: 'FAIL', code: result.status });
      console.log(`✖ Failed: ${relPath} (exit code ${result.status})`);
      if (options.bail) {
        console.log('\n[--bail active] Aborting remaining test execution.');
        break;
      }
    }
  }

  console.log('\n======================================================================');
  console.log('  TEST EXECUTION SUMMARY');
  console.log('======================================================================');
  for (const r of suiteResults) {
    const icon = r.status === 'PASS' ? '✔' : '✖';
    console.log(`  ${icon} [${r.status}] ${r.file}`);
  }
  console.log('----------------------------------------------------------------------');
  console.log(`Total Suites: ${suiteResults.length} | Passed: ${passedSuites} | Failed: ${failedSuites}`);
  console.log('======================================================================');

  process.exit(failedSuites > 0 ? 1 : 0);
}

main();

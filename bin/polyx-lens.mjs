#!/usr/bin/env node
// The lens, from the command line. Two ways to run, and the file decides which.
//
// Installed from npm, `dist/` is present and this runs the compiled
// JavaScript: Node refuses to strip types from anything under node_modules,
// so `npx @cognitive-fab/polyx-lens` needs plain JS. In a checkout without a
// build, the TypeScript sources run directly under Node's type stripping.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const built = new URL('../dist/src/cli.js', import.meta.url);
const { run } = await import(existsSync(fileURLToPath(built)) ? built.href : '../src/cli.ts');

process.exitCode = await run(process.argv.slice(2));

#!/usr/bin/env node
// The lens, from the command line. Node strips the types in this package's own
// tree; dependents consume the built JavaScript under dist/.
import { run } from '../src/cli.ts';

process.exitCode = await run(process.argv.slice(2));

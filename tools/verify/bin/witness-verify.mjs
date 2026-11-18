#!/usr/bin/env node
// Thin launcher: the verifier is TypeScript shared with the browser build.
import { register } from 'tsx/esm/api';
register();
await import('../src/cli.ts');

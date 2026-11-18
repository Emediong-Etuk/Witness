import { execFileSync } from 'node:child_process';

const git = (args: string[], cwd: string) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

import type { FreezeStatus } from '@witness/bench-core';

export type { FreezeStatus };

/**
 * Thresholds must be frozen (tag m4-thresholds-frozen) before the held-out
 * run: the tag must exist, be an ancestor of HEAD, and the gate config must
 * be unchanged since it.
 */
export function freezeStatus(repo: string, configRel = 'packages/gate/config/gate.v1.json', tag = 'm4-thresholds-frozen'): FreezeStatus {
  let head: string | null = null;
  try {
    head = git(['rev-parse', 'HEAD'], repo);
  } catch {
    return { frozen: false, reason: 'not a git repository', tag, tagCommit: null, head };
  }
  let tagCommit: string | null = null;
  try {
    tagCommit = git(['rev-list', '-n', '1', tag], repo);
  } catch {
    return { frozen: false, reason: `tag ${tag} does not exist`, tag, tagCommit, head };
  }
  try {
    git(['merge-base', '--is-ancestor', tagCommit, 'HEAD'], repo);
  } catch {
    return { frozen: false, reason: `${tag} is not an ancestor of HEAD`, tag, tagCommit, head };
  }
  try {
    git(['diff', '--quiet', tagCommit, '--', configRel], repo);
    git(['diff', '--quiet', '--', configRel], repo);
  } catch {
    return { frozen: false, reason: `${configRel} changed since ${tag}`, tag, tagCommit, head };
  }
  return { frozen: true, reason: 'ok', tag, tagCommit, head };
}

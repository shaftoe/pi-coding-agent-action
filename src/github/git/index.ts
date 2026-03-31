/**
 * @file Git utilities barrel export.
 *
 * Re-exports all public APIs for backward compatibility and convenience.
 */

// Types and utilities
export type { FileMode } from './types.js';
export { createLogger } from './types.js';

// File scanner
export type { ChangeScanResult } from './file-scanner.js';
export { buildFileMap, scanForChanges, scanDirectory } from './file-scanner.js';

// Tree builder
export { createBlobsAndTree } from './tree-builder.js';

// Commit creator
export { createCommitAndUpdateBranch } from './commit-creator.js';

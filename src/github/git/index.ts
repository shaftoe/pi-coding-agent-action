/**
 * @file Git utilities barrel export.
 *
 * Re-exports all public APIs for backward compatibility and convenience.
 */

// Types and utilities
export type { FileMode } from './types';
export { createLogger } from './types';

// File scanner
export type { ChangeScanResult, ScanDirectoryParams } from './file-scanner';
export { buildFileMap, scanForChanges, scanDirectory } from './file-scanner';

// Tree builder
export type { CreateBlobsAndTreeParams } from './tree-builder';
export { createBlobsAndTree } from './tree-builder';

// Commit creator
export type { CreateCommitAndUpdateBranchParams } from './commit-creator';
export { createCommitAndUpdateBranch } from './commit-creator';

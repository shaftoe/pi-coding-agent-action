/**
 * @file Git utilities barrel export for the GitHub platform.
 *
 * Re-exports all public APIs including the platform-agnostic scanner
 * (via the GitHub-aware wrapper) and GitHub-specific blob/tree/commit
 * operations.
 */

// Types and utilities
export type { FileMode, TreeEntry } from './types';
export { createLogger } from './types';

// File scanner (GitHub-aware wrapper around shared scanner)
export type { ChangeScanResult, ScanDirectoryParams } from './file-scanner';
export { buildFileMap, scanForChanges, scanDirectory } from './file-scanner';

// Tree builder
export type { CreateBlobsAndTreeParams } from './tree-builder';
export { createBlobsAndTree } from './tree-builder';

// Commit creator
export type { CreateCommitAndUpdateBranchParams } from './commit-creator';
export { createCommitAndUpdateBranch } from './commit-creator';

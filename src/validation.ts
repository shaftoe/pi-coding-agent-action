// ── Input Validation Utilities ─────────────────────────────────────────────
/**
 * Input validation functions for safety and security.
 *
 * These functions validate user input and configuration values to prevent
 * injection attacks, malformed data, and other security issues.
 */

import { resolve } from 'node:path';
import { ValidationError } from './errors.js';

// ── GitHub Validation ─────────────────────────────────────────────────────
/**
 * Validates that a number is a valid GitHub issue/PR number.
 * @param num - The number to validate
 * @throws {ValidationError} If the number is invalid
 */
export function validateIssueNumber(num: number): void {
  if (!Number.isInteger(num)) {
    throw new ValidationError('Issue/PR number must be an integer', 'issueNumber', num);
  }

  if (num < 1) {
    throw new ValidationError('Issue/PR number must be positive', 'issueNumber', num);
  }

  // GitHub issue numbers are typically less than 2^31
  if (num > 2_147_483_647) {
    throw new ValidationError('Issue/PR number is too large', 'issueNumber', num);
  }
}

/**
 * Validates a GitHub username.
 * @param username - The username to validate
 * @throws {ValidationError} If the username is invalid
 */
export function validateGitHubUsername(username: string): void {
  if (!username || username.length === 0) {
    throw new ValidationError('Username cannot be empty', 'username', username);
  }

  // GitHub usernames can contain alphanumeric characters and hyphens
  // Cannot start or end with a hyphen, cannot have consecutive hyphens
  const usernamePattern = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

  if (!usernamePattern.test(username)) {
    throw new ValidationError(
      'Username can only contain alphanumeric characters and hyphens (cannot start/end with hyphen, no consecutive hyphens)',
      'username',
      username
    );
  }

  if (username.length > 39) {
    throw new ValidationError('Username is too long (max 39 characters)', 'username', username);
  }
}

/**
 * Validates a GitHub repository name.
 * @param repoName - The repository name to validate
 * @throws {ValidationError} If the repository name is invalid
 */
export function validateRepositoryName(repoName: string): void {
  if (!repoName || repoName.length === 0) {
    throw new ValidationError('Repository name cannot be empty', 'repositoryName', repoName);
  }

  // GitHub repository names follow similar rules to usernames
  const repoPattern = /^[a-zA-Z0-9._-]+$/;

  if (!repoPattern.test(repoName)) {
    throw new ValidationError(
      'Repository name can only contain alphanumeric characters, periods, hyphens, and underscores',
      'repositoryName',
      repoName
    );
  }

  if (repoName.length > 100) {
    throw new ValidationError('Repository name is too long (max 100 characters)', 'repositoryName', repoName);
  }

  // Cannot start or end with .git
  if (repoName.startsWith('.git') || repoName.endsWith('.git')) {
    throw new ValidationError('Repository name cannot start or end with ".git"', 'repositoryName', repoName);
  }
}

// ── Git Validation ───────────────────────────────────────────────────────
/**
 * Validates that a string is a valid Git branch name.
 * @param branch - The branch name to validate
 * @throws {ValidationError} If the branch name is invalid
 */
export function validateBranchName(branch: string): void {
  if (!branch || branch.length === 0) {
    throw new ValidationError('Branch name cannot be empty', 'branch', branch);
  }

  if (branch.length > 255) {
    throw new ValidationError('Branch name cannot exceed 255 characters', 'branch', branch);
  }

  // Git branch name rules per git-check-ref-format:
  // - Cannot contain ..
  // - Cannot contain @{
  // - Cannot contain a space, ~ ^ : ? * [
  // - Cannot start or end with a slash
  // - Cannot have consecutive slashes
  // - Cannot end with a dot
  // - Cannot contain .lock
  // - Cannot contain @\ anywhere
  const invalidPattern = /(^\.|^\.\.|^/$|^/|\.\.|@\{|\\)|[ \t~^:?*[\]]|\/$|\.$|\.lock|^@|\.$/;

  if (invalidPattern.test(branch)) {
    throw new ValidationError('Branch name contains invalid characters or patterns', 'branch', branch);
  }
}

/**
 * Validates that a string is a valid Git commit message.
 * @param message - The commit message to validate
 * @throws {ValidationError} If the commit message is invalid
 */
export function validateCommitMessage(message: string): void {
  if (!message || message.trim().length === 0) {
    throw new ValidationError('Commit message cannot be empty', 'message', message);
  }

  if (message.length > 72 * 1024) { // Git typically allows up to ~72KB
    throw new ValidationError('Commit message is too long (max ~72KB)', 'message', message);
  }

  // First line should ideally be under 72 characters (but we don't enforce this strictly)
  const firstLine = message.split('\n')[0];
  if (firstLine.length > 200) {
    throw new ValidationError('First line of commit message is too long (recommended < 72 chars, max 200)', 'message', message);
  }
}

// ── General Validation ───────────────────────────────────────────────────
/**
 * Validates a user prompt for the Pi agent.
 * @param prompt - The user prompt to validate
 * @throws {ValidationError} If the prompt is invalid
 */
export function validateUserPrompt(prompt: string): void {
  if (!prompt || prompt.trim().length === 0) {
    throw new ValidationError('User prompt cannot be empty', 'prompt', prompt);
  }

  if (prompt.length > 100_000) {
    throw new ValidationError('User prompt is too long (max 100,000 characters)', 'prompt', prompt);
  }

  // Check for potentially dangerous command injection patterns
  const dangerousPatterns = [
    /\$\([^)]*\)/, // Command substitution
    /`[^`]*`/, // Backtick command substitution
    /\|\s*\w+\s*\|\s*/, // Pipe chains
    /&&\s*\w+/, // Command chaining
    /;\s*\w+/, // Command chaining with semicolon
    />\s*\/dev\/.*/, // Redirections (less concerning but worth checking)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(prompt)) {
      throw new ValidationError('User prompt contains potentially dangerous patterns', 'prompt', prompt);
    }
  }
}

/**
 * Validates an email address format.
 * @param email - The email address to validate
 * @throws {ValidationError} If the email is invalid
 */
export function validateEmail(email: string): void {
  if (!email || email.length === 0) {
    throw new ValidationError('Email cannot be empty', 'email', email);
  }

  // Basic email validation (not RFC 5322 compliant, but practical)
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(email)) {
    throw new ValidationError('Invalid email format', 'email', email);
  }

  if (email.length > 254) {
    throw new ValidationError('Email is too long (max 254 characters)', 'email', email);
  }
}

/**
 * Validates a URL.
 * @param url - The URL to validate
 * @param allowedProtocols - Optional list of allowed protocols (default: ['https', 'http'])
 * @throws {ValidationError} If the URL is invalid
 */
export function validateUrl(url: string, allowedProtocols: string[] = ['https', 'http']): void {
  if (!url || url.length === 0) {
    throw new ValidationError('URL cannot be empty', 'url', url);
  }

  try {
    const parsedUrl = new URL(url);

    if (!allowedProtocols.includes(parsedUrl.protocol.replace(':', ''))) {
      throw new ValidationError(
        `URL protocol must be one of: ${allowedProtocols.join(', ')}`,
        'url',
        url
      );
    }
  } catch (error) {
    throw new ValidationError('Invalid URL format', 'url', url);
  }
}

// ── Environment Variable Validation ────────────────────────────────────────
/**
 * Validates an environment variable key.
 * @param key - The environment variable key to validate
 * @throws {ValidationError} If the key is invalid
 */
export function validateEnvVarKey(key: string): void {
  if (!key || key.length === 0) {
    throw new ValidationError('Environment variable key cannot be empty', 'key', key);
  }

  // Env var keys must be non-empty, contain only alphanumeric chars and underscores,
  // and must not start with a number (POSIX convention)
  const envVarKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  if (!envVarKeyPattern.test(key)) {
    throw new ValidationError(
      'Environment variable key must start with a letter or underscore and contain only letters, numbers, and underscores',
      'key',
      key
    );
  }

  if (key.length > 255) {
    throw new ValidationError('Environment variable key is too long (max 255 characters)', 'key', key);
  }
}

/**
 * Validates and sanitizes an environment variable value.
 * @param key - The environment variable key (for error messages)
 * @param value - The environment variable value to validate
 * @returns The sanitized value
 * @throws {ValidationError} If the value is invalid
 */
export function sanitizeEnvVarValue(key: string, value: string): string {
  if (value === undefined || value === null) {
    throw new ValidationError(`Environment variable value for '${key}' cannot be null or undefined`, 'value', value);
  }

  // Remove control characters (except newline, tab)
  const sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Limit length
  if (sanitized.length > 32_760) {
    throw new ValidationError(
      `Environment variable value for '${key}' is too long (max 32,760 characters)`,
      'value',
      value
    );
  }

  return sanitized;
}

// ── File Path Validation ─────────────────────────────────────────────────
/**
 * Validates that a file path is safe for operations.
 * @param filepath - The file path to validate
 * @param basePath - Optional base path to resolve relative paths against
 * @throws {ValidationError} If the path is dangerous
 */
export function validateSafePath(filepath: string, basePath?: string): void {
  if (!filepath || filepath.length === 0) {
    throw new ValidationError('File path cannot be empty', 'filepath', filepath);
  }

  const normalized = filepath.replace(/\\/g, '/');

  // Prevent path traversal
  if (normalized.includes('..') || normalized.startsWith('/')) {
    throw new ValidationError('File path contains path traversal or absolute path', 'filepath', filepath);
  }

  // Prevent null bytes
  if (normalized.includes('\0')) {
    throw new ValidationError('File path contains null byte', 'filepath', filepath);
  }

  // Check for suspicious patterns
  const suspiciousPatterns = [
    /~\$/, // Windows temp file
    /\.tmp$/i, // Temporary file
    /\.bak$/i, // Backup file
    /\.swp$/i, // Vim swap file
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(normalized)) {
      throw new ValidationError('File path appears to be a temporary or backup file', 'filepath', filepath);
    }
  }

  // If basePath is provided, resolve and validate the full path
  if (basePath) {
    const fullPath = resolve(basePath, normalized);
    const normalizedBase = resolve(basePath);

    if (!fullPath.startsWith(normalizedBase)) {
      throw new ValidationError('Resolved file path escapes base directory', 'filepath', filepath);
    }
  }
}

// ── Type Guards ────────────────────────────────────────────────────────────
/**
 * Checks if a value is a non-empty string.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Checks if a value is a valid number.
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * Checks if a value is a positive integer.
 */
export function isPositiveInteger(value: unknown): value is number {
  return isNumber(value) && Number.isInteger(value) && value > 0;
}

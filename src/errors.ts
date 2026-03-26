// ── Custom Error Classes ────────────────────────────────────────────────
/**
 * Custom error classes for better error handling and type safety.
 *
 * These errors provide more context about what went wrong and allow for
 * more granular error handling in the application.
 */

/**
 * Base error class for all application errors.
 * Provides a consistent structure for error handling.
 */
export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ApplicationError';

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApplicationError);
    }
  }
}

/**
 * Error thrown when GitHub API operations fail.
 */
export class GitHubError extends ApplicationError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly operation?: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'GitHubError';
  }

  /**
   * Checks if this error is a 404 Not Found error.
   */
  isNotFound(): boolean {
    return this.statusCode === 404;
  }

  /**
   * Checks if this error is a 403 Forbidden error.
   */
  isForbidden(): boolean {
    return this.statusCode === 403;
  }

  /**
   * Checks if this error is a 422 Unprocessable Entity error.
   */
  isUnprocessable(): boolean {
    return this.statusCode === 422;
  }

  /**
   * Checks if this error is a 5xx server error.
   */
  isServerError(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 500;
  }
}

/**
 * Error thrown when Git operations fail.
 */
export class GitError extends ApplicationError {
  constructor(
    message: string,
    public readonly operation: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'GitError';
  }

  /**
   * Checks if this error is an authentication error.
   */
  isAuthenticationError(): boolean {
    return this.message.toLowerCase().includes('auth') ||
           this.message.toLowerCase().includes('permission');
  }

  /**
   * Checks if this error is a network/timeout error.
   */
  isNetworkError(): boolean {
    return this.message.toLowerCase().includes('timeout') ||
           this.message.toLowerCase().includes('network') ||
           this.message.toLowerCase().includes('connection');
  }

  /**
   * Checks if this error is a merge conflict.
   */
  isMergeConflict(): boolean {
    return this.message.toLowerCase().includes('conflict');
  }
}

/**
 * Error thrown when Pi Agent operations fail.
 */
export class PiAgentError extends ApplicationError {
  constructor(
    message: string,
    public readonly exitCode?: number,
    public readonly provider?: string,
    public readonly model?: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'PiAgentError';
  }

  /**
   * Checks if this error is a timeout error.
   */
  isTimeout(): boolean {
    return this.message.toLowerCase().includes('timeout') ||
           this.exitCode === 124; // Common timeout exit code
  }

  /**
   * Checks if this error is a model availability error.
   */
  isModelUnavailable(): boolean {
    return this.message.toLowerCase().includes('model') &&
           (this.message.toLowerCase().includes('not found') ||
            this.message.toLowerCase().includes('unavailable'));
  }

  /**
   * Checks if this error is a rate limit error.
   */
  isRateLimited(): boolean {
    return this.message.toLowerCase().includes('rate limit') ||
           this.message.toLowerCase().includes('quota');
  }
}

/**
 * Error thrown when input validation fails.
 */
export class ValidationError extends ApplicationError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly value?: unknown,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when a configuration value is invalid.
 */
export class ConfigurationError extends ApplicationError {
  constructor(
    message: string,
    public readonly configKey?: string,
    cause?: Error
  ) {
    super(message, cause);
    this.name = 'ConfigurationError';
  }
}

// ── Error Factory Functions ──────────────────────────────────────────────
/**
 * Creates a GitHub error for a failed request.
 */
export function createGitHubRequestError(
  operation: string,
  statusCode: number,
  responseText?: string
): GitHubError {
  const message = `GitHub request failed for operation '${operation}' (status ${statusCode})`;
  return new GitHubError(
    responseText ? `${message}: ${responseText}` : message,
    statusCode,
    operation
  );
}

/**
 * Creates a GitHub parsing error for failed JSON parsing.
 */
export function createGitHubParseError(
  dataType: string,
  identifier: string,
  parseError: Error,
  outputPreview?: string
): GitHubError {
  const message = `Failed to parse ${dataType} for '${identifier}': ${parseError.message}`;
  return new GitHubError(
    outputPreview ? `${message}\nOutput preview: ${outputPreview}` : message,
    undefined,
    'parse',
    parseError
  );
}

/**
 * Creates a Git operation error.
 */
export function createGitOperationError(
  operation: string,
  cause: Error
): GitError {
  return new GitError(`Git operation '${operation}' failed: ${cause.message}`, operation, cause);
}

/**
 * Creates a Pi Agent execution error.
 */
export function createPiAgentError(
  exitCode: number | undefined,
  provider: string,
  model: string,
  stderr?: string
): PiAgentError {
  const message = `Pi Agent exited with code ${exitCode ?? 'unknown'}`;
  return new PiAgentError(
    stderr ? `${message}\n${stderr}` : message,
    exitCode,
    provider,
    model
  );
}

/**
 * Creates a validation error.
 */
export function createValidationError(
  field: string,
  value: unknown,
  reason: string
): ValidationError {
  const valueStr = typeof value === 'string' ? `"${value}"` : String(value);
  return new ValidationError(
    `Invalid value for field '${field}': ${reason} (got: ${valueStr})`,
    field,
    value
  );
}

// ── Error Type Guards ────────────────────────────────────────────────────
/**
 * Type guard to check if an error is a GitHubError.
 */
export function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof GitHubError;
}

/**
 * Type guard to check if an error is a GitError.
 */
export function isGitError(error: unknown): error is GitError {
  return error instanceof GitError;
}

/**
 * Type guard to check if an error is a PiAgentError.
 */
export function isPiAgentError(error: unknown): error is PiAgentError {
  return error instanceof PiAgentError;
}

/**
 * Type guard to check if an error is a ValidationError.
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Type guard to check if an error is a ConfigurationError.
 */
export function isConfigurationError(error: unknown): error is ConfigurationError {
  return error instanceof ConfigurationError;
}

/**
 * Type guard to check if an error is any ApplicationError.
 */
export function isApplicationError(error: unknown): error is ApplicationError {
  return error instanceof ApplicationError;
}

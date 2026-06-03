/**
 * Test fixture: intentionally broken extension.
 *
 * Used by unit tests to verify that extension loading errors are captured
 * and surfaced through getExtensions().errors + logger.error().
 */
throw new Error('intentional extension loading failure for testing');

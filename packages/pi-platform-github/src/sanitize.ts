/**
 * @file Content sanitization for user-provided text.
 *
 * Strips hidden content from issue/PR bodies, comments, and other
 * user-provided text before it enters the LLM prompt context. This is
 * a defense-in-depth measure against hidden instructions that are
 * invisible to human reviewers but visible to LLMs.
 *
 * Handles three categories of hidden content:
 * 1. **HTML comments** (`<!-- ... -->`) — invisible in rendered Markdown
 * 2. **Invisible Unicode characters** — zero-width spaces, joiners,
 *    directional markers, and similar characters
 * 3. **ASCII control characters** — keep newlines (`\n`), carriage returns
 *    (`\r`), and tabs (`\t`) since they carry semantic meaning in text
 */

/**
 * Sanitize user-provided content by removing hidden text and invisible characters.
 *
 * @param text - The raw text from a GitHub API response (issue body, comment, etc.)
 * @returns The cleaned text with hidden content removed.
 */
export function sanitizeContent(text: string): string {
  return (
    text
      // Remove HTML comments (may span multiple lines)
      .replace(/<!--[\s\S]*?-->/g, '')
      // Remove invisible Unicode characters:
      //   U+200B-U+200F  zero-width space, non-joiner, joiner, LTR/RTL marks
      //   U+2028-U+202F  line/paragraph separators, LTR/RTL embeds, narrow no-break space
      //   U+2060-U+206F  word joiner, invisible chars, deprecated format chars
      //   U+FEFF          byte-order mark (zero-width no-break space)
      .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/g, '')
      // Remove ASCII control characters EXCEPT:
      //   \n (0x0A), \r (0x0D), \t (0x09) — meaningful whitespace
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
  );
}

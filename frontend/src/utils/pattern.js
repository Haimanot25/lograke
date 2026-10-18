/* Pattern-template helpers shared by Dashboard and Patterns. */

export function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Convert a log pattern template ("Connection from <IP> failed") into a
 *  regex source string where placeholders become wildcards. */
export function patternToRegex(template) {
  return escapeForRegex(template).replace(/<[^>]+>/g, '.*');
}

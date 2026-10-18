/** Parse a space-delimited capability string into a stable unique set. */
export function parseScope(scope: string): Set<string> {
  return new Set(
    scope
      .trim()
      .split(/\s+/)
      .filter((c) => c.length > 0),
  );
}

export function formatScope(caps: Iterable<string>): string {
  return [...new Set(caps)].sort().join(" ");
}

/** True when every capability in `child` also appears in `parent`. */
export function isScopeSubset(child: string, parent: string): boolean {
  const parentCaps = parseScope(parent);
  for (const cap of parseScope(child)) {
    if (!parentCaps.has(cap)) return false;
  }
  return true;
}

/** True when the ticket scope includes every required capability. */
export function hasAllCapabilities(ticketScope: string, required: string): boolean {
  return isScopeSubset(required, ticketScope);
}

export function missingCapabilities(ticketScope: string, required: string): string[] {
  const have = parseScope(ticketScope);
  return [...parseScope(required)].filter((c) => !have.has(c));
}

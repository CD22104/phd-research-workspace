// A delayed snapshot must not undo a newer, successfully saved preference.
export function mergeConferences(current, incoming) {
  const existing = new Map(current.map(c => [c.key, c]));
  return incoming.map(c => {
    const previous = existing.get(c.key);
    return previous && previous.version > c.version ? previous : c;
  });
}

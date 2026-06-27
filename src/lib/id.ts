let counter = 0;

/** Short, sortable-ish unique id for messages / conversations / stream ids. */
export function newId(prefix = ''): string {
  counter = (counter + 1) % 0xffffff;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}`;
}

/** Numeric id for native stream correlation. */
export function newStreamId(): number {
  counter = (counter + 1) % 0x7fffffff;
  return (Date.now() % 100000) * 10000 + counter % 10000;
}

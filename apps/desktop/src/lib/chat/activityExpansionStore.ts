type ActivityExpansion = { opened: boolean; bodies: Set<string> };

const expansions = new Map<string, ActivityExpansion>();

export function loadActivityExpansion(key: string): ActivityExpansion {
  const stored = expansions.get(key);
  return stored ? { opened: stored.opened, bodies: new Set(stored.bodies) } : { opened: false, bodies: new Set() };
}

export function saveActivityExpansion(key: string, value: ActivityExpansion): void {
  if (!key) return;
  expansions.set(key, { opened: value.opened, bodies: new Set(value.bodies) });
  if (expansions.size > 500) expansions.delete(expansions.keys().next().value as string);
}

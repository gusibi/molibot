/** Resolve explicit Room mentions against current members, never against a global default. */
export function roomMentionIds(text: string, members: readonly { id: string; name: string }[]): string[] {
  const aliases = members.flatMap(member => [member.id, member.name].map(alias => ({ alias, id: member.id })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const ids = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)@/g)) {
    const remaining = text.slice(match.index! + match[0].length);
    const matches = aliases.filter(({ alias }) => remaining.slice(0, alias.length).toLowerCase() === alias.toLowerCase()
      && (!remaining[alias.length] || /[\s,，。.!！?？:：;；]/.test(remaining[alias.length])));
    const longest = matches[0]?.alias.length;
    const candidates = new Set(matches.filter(candidate => candidate.alias.length === longest).map(candidate => candidate.id));
    if (candidates.size > 1) throw new Error(`Ambiguous Room mention: @${matches[0].alias}; use the Agent id`);
    for (const id of candidates) ids.add(id);
  }
  return [...ids];
}

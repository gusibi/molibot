/** Only explicit installed names select this route; ordinary mentions do not. */
export function resolvePiExtensionInvocation(text: string, extensions: readonly {id: string; name: string}[]): {id: string} | null {
  const selector = /^\s*@pi\/([\w.-]+)(?=\s|$)/i.exec(text);
  if (selector) {
    const extension = extensions.find(entry => entry.id.toLowerCase() === selector[1].toLowerCase());
    if (!extension) throw new Error(`The selected native Pi extension (${selector[1]}) is unavailable or disabled. Enable it before retrying; no alternative execution was started.`);
    return {id:extension.id};
  }
  if (/(?:不要|别|禁止|不应|勿)\s*(?:使用|调用|用)|\b(?:do\s+not|don't|never)\s+(?:use|run|invoke)\b/i.test(text)) return null;
  if (/(?:是什么|有什么|为什么|是否|如何|怎么)|\b(?:why|whether)\b/i.test(text)) return null;
  const matches = extensions.filter(extension => [...new Set([extension.id, extension.name])].some(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^\\s*(?:(?:请(?:帮我)?|帮我|麻烦(?:你)?|现在|先)\\s*){0,3}(?:使用|调用|通过|用)\\s*${escaped}(?![a-zA-Z0-9_.-])|^\\s*(?:(?:please|can you|could you)\\s+)?(?:use|using|invoke|run)\\s+${escaped}(?![a-zA-Z0-9_.-])`, 'i').test(text);
  }));
  return matches.length === 1 ? {id:matches[0].id} : null;
}

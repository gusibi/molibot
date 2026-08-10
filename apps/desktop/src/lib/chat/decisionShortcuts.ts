type DecisionCardRegistration = { element: HTMLElement; enabled: () => boolean };

const cards = new Map<string, DecisionCardRegistration>();

export function registerDecisionCard(id: string, registration: DecisionCardRegistration): () => void {
  cards.set(id, registration);
  return () => cards.delete(id);
}

/** Exactly one visible card owns global digits/Escape/⌘⏎. */
export function ownsDecisionShortcuts(id: string): boolean {
  const viewportCenter = window.innerHeight / 2;
  const visible = [...cards.entries()]
    .filter(([, card]) => card.enabled())
    .map(([candidateId, card]) => ({ candidateId, rect: card.element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight)
    .sort((left, right) => {
      const leftDistance = Math.abs((left.rect.top + left.rect.bottom) / 2 - viewportCenter);
      const rightDistance = Math.abs((right.rect.top + right.rect.bottom) / 2 - viewportCenter);
      return leftDistance - rightDistance || left.rect.top - right.rect.top;
    });
  return visible[0]?.candidateId === id;
}

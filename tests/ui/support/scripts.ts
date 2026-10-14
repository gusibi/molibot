import { modelRequestMatchers, type ModelService } from './model-service';

/**
 * Background model calls the runtime makes on its own. They are declared once
 * here — shared data preparation — so every test accounts for them explicitly
 * instead of letting an unexpected request slip through unmatched.
 */
export function registerSharedScripts(model: ModelService): void {
  model.script({
    name: 'background:session-title',
    when: request =>
      request.system.includes('session title summarizer') ||
      request.system.includes('会话标题总结助手'),
    reply: request => {
      // The title prompt ends with the raw first user message after a blank line.
      const text = modelRequestMatchers(request).lastUserText.split('\n\n').at(-1)?.trim() ?? '';
      return { type: 'text', text: text.slice(0, 50) || 'UI Session' };
    }
  });
}

import fs from 'fs';
import path from 'path';

const moves = [
  // 1. core
  ['runner.ts', 'core/runner.ts'],
  ['runner.test.ts', 'core/runner.test.ts'],
  ['turnOrchestrator.ts', 'core/turnOrchestrator.ts'],
  ['turnOrchestrator.test.ts', 'core/turnOrchestrator.test.ts'],
  ['assistantStream.ts', 'core/assistantStream.ts'],
  ['runnerRetryState.ts', 'core/runnerRetryState.ts'],
  ['runnerRetryState.test.ts', 'core/runnerRetryState.test.ts'],
  ['runtimeBudget.ts', 'core/runtimeBudget.ts'],
  ['runtimeNotices.ts', 'core/runtimeNotices.ts'],
  ['runtimeOptions.ts', 'core/runtimeOptions.ts'],
  ['types.ts', 'core/types.ts'],

  // 2. routing
  ['modelRouting.ts', 'routing/modelRouting.ts'],
  ['modelRouting.test.ts', 'routing/modelRouting.test.ts'],
  ['mediaFallback.ts', 'routing/mediaFallback.ts'],
  ['vision-fallback.ts', 'routing/vision-fallback.ts'],
  ['vision-fallback.test.ts', 'routing/vision-fallback.test.ts'],
  ['stt.ts', 'routing/stt.ts'],

  // 3. prompts
  ['prompt.ts', 'prompts/prompt.ts'],
  ['prompt.test.ts', 'prompts/prompt.test.ts'],
  ['profiles.ts', 'prompts/profiles.ts'],
  ['promptInput.ts', 'prompts/promptInput.ts'],
  ['promptInput.test.ts', 'prompts/promptInput.test.ts'],
  ['prompt-channel.ts', 'prompts/prompt-channel.ts'],

  // 4. tools
  ['toolPolicy.ts', 'tools/toolPolicy.ts'],
  ['toolDisplay.ts', 'tools/toolDisplay.ts'],
  ['toolDisplay.test.ts', 'tools/toolDisplay.test.ts'],
  ['mcp.ts', 'tools/mcp.ts'],

  // 5. skills
  ['skills.ts', 'skills/skills.ts'],
  ['skills.test.ts', 'skills/skills.test.ts'],
  ['self-evolution.ts', 'skills/self-evolution.ts'],
  ['self-evolution.test.ts', 'skills/self-evolution.test.ts'],
  ['skillDraft.ts', 'skills/skillDraft.ts'],
  ['skillDraftMetadata.ts', 'skills/skillDraftMetadata.ts'],
  ['skillDraftSubagent.ts', 'skills/skillDraftSubagent.ts'],
  ['skillFrontmatter.ts', 'skills/skillFrontmatter.ts'],

  // 6. session
  ['session.ts', 'session/session.ts'],
  ['session.test.ts', 'session/session.test.ts'],
  ['store.ts', 'session/store.ts'],
  ['runSummary.ts', 'session/runSummary.ts'],
  ['runDetail.ts', 'session/runDetail.ts'],
  ['reviewData.ts', 'session/reviewData.ts'],
  ['reviewData.test.ts', 'session/reviewData.test.ts'],
  ['compaction.ts', 'session/compaction.ts'],
  ['compaction.test.ts', 'session/compaction.test.ts'],
  ['scratchArtifacts.ts', 'session/scratchArtifacts.ts'],
  ['workspace.ts', 'session/workspace.ts'],

  // 7. identity & common
  ['auth.ts', 'identity/auth.ts'],
  ['log.ts', 'common/log.ts'],
  ['log.test.ts', 'common/log.test.ts'],

  // 8. commands
  ['channelCommands.ts', 'commands/channelCommands.ts'],
  ['channelCommands.test.ts', 'commands/channelCommands.test.ts'],
  ['taskChannels.ts', 'commands/taskChannels.ts']
];

const templates = [
  'AGENTS.template.md',
  'BOOTSTRAP.template.md',
  'IDENTITY.linus.template.md',
  'IDENTITY.template.md',
  'SOUL.linus.template.md',
  'SOUL.template.md',
  'SYSTEM_PROMPT.preview.md',
  'TOOLS.template.md',
  'USER.template.md'
];

const base = 'src/lib/server/agent';

// First move prompts templates
for (const tmpl of templates) {
  const from = path.join(base, 'prompts', tmpl);
  const to = path.join(base, 'prompts', 'templates', tmpl);
  if (fs.existsSync(from)) {
    fs.renameSync(from, to);
    console.log(`Moved prompt template: ${tmpl}`);
  }
}

// Now move files
for (const [fromFile, toFile] of moves) {
  const from = path.join(base, fromFile);
  const to = path.join(base, toFile);
  if (fs.existsSync(from)) {
    fs.renameSync(from, to);
    console.log(`Moved: ${fromFile} -> ${toFile}`);
  } else {
    console.log(`Skipped (not found): ${fromFile}`);
  }
}

import fs from 'fs';
import path from 'path';

const mapping = {
  'runner.js': 'core/runner.js',
  'runner': 'core/runner',
  'runner.test.js': 'core/runner.test.js',
  'runner.test': 'core/runner.test',
  'turnOrchestrator.js': 'core/turnOrchestrator.js',
  'turnOrchestrator': 'core/turnOrchestrator',
  'turnOrchestrator.test.js': 'core/turnOrchestrator.test.js',
  'turnOrchestrator.test': 'core/turnOrchestrator.test',
  'assistantStream.js': 'core/assistantStream.js',
  'assistantStream': 'core/assistantStream',
  'runnerRetryState.js': 'core/runnerRetryState.js',
  'runnerRetryState': 'core/runnerRetryState',
  'runnerRetryState.test.js': 'core/runnerRetryState.test.js',
  'runnerRetryState.test': 'core/runnerRetryState.test',
  'runtimeBudget.js': 'core/runtimeBudget.js',
  'runtimeBudget': 'core/runtimeBudget',
  'runtimeNotices.js': 'core/runtimeNotices.js',
  'runtimeNotices': 'core/runtimeNotices',
  'runtimeOptions.js': 'core/runtimeOptions.js',
  'runtimeOptions': 'core/runtimeOptions',
  'types.js': 'core/types.js',
  'types': 'core/types',
  'modelRouting.js': 'routing/modelRouting.js',
  'modelRouting': 'routing/modelRouting',
  'modelRouting.test.js': 'routing/modelRouting.test.js',
  'modelRouting.test': 'routing/modelRouting.test',
  'mediaFallback.js': 'routing/mediaFallback.js',
  'mediaFallback': 'routing/mediaFallback',
  'vision-fallback.js': 'routing/vision-fallback.js',
  'vision-fallback': 'routing/vision-fallback',
  'vision-fallback.test.js': 'routing/vision-fallback.test.js',
  'vision-fallback.test': 'routing/vision-fallback.test',
  'stt.js': 'routing/stt.js',
  'stt': 'routing/stt',
  'prompt.js': 'prompts/prompt.js',
  'prompt': 'prompts/prompt',
  'prompt.test.js': 'prompts/prompt.test.js',
  'prompt.test': 'prompts/prompt.test',
  'profiles.js': 'prompts/profiles.js',
  'profiles': 'prompts/profiles',
  'promptInput.js': 'prompts/promptInput.js',
  'promptInput': 'prompts/promptInput',
  'promptInput.test.js': 'prompts/promptInput.test.js',
  'promptInput.test': 'prompts/promptInput.test',
  'prompt-channel.js': 'prompts/prompt-channel.js',
  'prompt-channel': 'prompts/prompt-channel',
  'toolPolicy.js': 'tools/toolPolicy.js',
  'toolPolicy': 'tools/toolPolicy',
  'toolDisplay.js': 'tools/toolDisplay.js',
  'toolDisplay': 'tools/toolDisplay',
  'toolDisplay.test.js': 'tools/toolDisplay.test.js',
  'toolDisplay.test': 'tools/toolDisplay.test',
  'mcp.js': 'tools/mcp.js',
  'mcp': 'tools/mcp',
  'skills.js': 'skills/skills.js',
  'skills': 'skills/skills',
  'skills.test.js': 'skills/skills.test.js',
  'skills.test': 'skills/skills.test',
  'self-evolution.js': 'skills/self-evolution.js',
  'self-evolution': 'skills/self-evolution',
  'self-evolution.test.js': 'skills/self-evolution.test.js',
  'self-evolution.test': 'skills/self-evolution.test',
  'skillDraft.js': 'skills/skillDraft.js',
  'skillDraft': 'skills/skillDraft',
  'skillDraftMetadata.js': 'skills/skillDraftMetadata.js',
  'skillDraftMetadata': 'skills/skillDraftMetadata',
  'skillDraftSubagent.js': 'skills/skillDraftSubagent.js',
  'skillDraftSubagent': 'skills/skillDraftSubagent',
  'skillFrontmatter.js': 'skills/skillFrontmatter.js',
  'skillFrontmatter': 'skills/skillFrontmatter',
  'session.js': 'session/session.js',
  'session': 'session/session',
  'session.test.js': 'session/session.test.js',
  'session.test': 'session/session.test',
  'store.js': 'session/store.js',
  'store': 'session/store',
  'runSummary.js': 'session/runSummary.js',
  'runSummary': 'session/runSummary',
  'runDetail.js': 'session/runDetail.js',
  'runDetail': 'session/runDetail',
  'reviewData.js': 'session/reviewData.js',
  'reviewData': 'session/reviewData',
  'reviewData.test.js': 'session/reviewData.test.js',
  'reviewData.test': 'session/reviewData.test',
  'compaction.js': 'session/compaction.js',
  'compaction': 'session/compaction',
  'compaction.test.js': 'session/compaction.test.js',
  'compaction.test': 'session/compaction.test',
  'scratchArtifacts.js': 'session/scratchArtifacts.js',
  'scratchArtifacts': 'session/scratchArtifacts',
  'workspace.js': 'session/workspace.js',
  'workspace': 'session/workspace',
  'auth.js': 'identity/auth.js',
  'auth': 'identity/auth',
  'log.js': 'common/log.js',
  'log': 'common/log',
  'log.test.js': 'common/log.test.js',
  'log.test': 'common/log.test',
  'channelCommands.js': 'commands/channelCommands.js',
  'channelCommands': 'commands/channelCommands',
  'channelCommands.test.js': 'commands/channelCommands.test.js',
  'channelCommands.test': 'commands/channelCommands.test',
  'taskChannels.js': 'commands/taskChannels.js',
  'taskChannels': 'commands/taskChannels'
};

// Root files remaining in agent/
const rootFiles = [
  'events.js', 'events', 'events.ts',
  'hostBashExec.js', 'hostBashExec', 'hostBashExec.ts',
  'hostToolExec.js', 'hostToolExec', 'hostToolExec.ts',
  'subagentProgress.js', 'subagentProgress', 'subagentProgress.ts',
  'taskScheduler.js', 'taskScheduler', 'taskScheduler.ts'
];

function updateImportPath(importStr, filePath) {
  // Normalize windows backslashes
  const normalizedFilePath = filePath.replace(/\\/g, '/');

  // 1. $lib/server/agent/XXX
  if (importStr.startsWith('$lib/server/agent/')) {
    const relativePart = importStr.substring('$lib/server/agent/'.length);
    if (mapping[relativePart]) {
      return `$lib/server/agent/${mapping[relativePart]}`;
    }
  }

  // 2. Relative imports to agent/ from outside
  // e.g. ../../agent/XXX or ../agent/XXX
  const agentMatch = importStr.match(/^(\.\.+\/)agent\/(.+)$/);
  if (agentMatch) {
    const relativePart = agentMatch[2];
    if (mapping[relativePart]) {
      return `$lib/server/agent/${mapping[relativePart]}`;
    }
    if (rootFiles.includes(relativePart)) {
      return `$lib/server/agent/${relativePart}`;
    }
  }

  // 3. Imports inside the agent/ directory itself
  const agentPathIndex = normalizedFilePath.indexOf('/src/lib/server/agent/');
  if (agentPathIndex !== -1) {
    // If it's a relative import like ./XXX or ../XXX
    if (importStr.startsWith('./') || importStr.startsWith('../')) {
      const isMovedFile = normalizedFilePath.split('/src/lib/server/agent/')[1].includes('/');
      if (isMovedFile) {
        // Resolve the import to find what file it originally referenced
        // The original directory was src/lib/server/agent/ (since it was just moved)
        // So `./XXX` originally meant `src/lib/server/agent/XXX`
        if (importStr.startsWith('./')) {
          const originalTarget = importStr.substring(2);
          if (mapping[originalTarget]) {
            return `$lib/server/agent/${mapping[originalTarget]}`;
          }
          if (rootFiles.includes(originalTarget)) {
            return `$lib/server/agent/${originalTarget}`;
          }
        }
      }
    }
  }

  return null;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  // Regex to match imports: from "..." or import "..."
  const newContent = content.replace(/from\s+['"]([^'"]+)['"]/g, (match, importStr) => {
    const replacement = updateImportPath(importStr, filePath);
    if (replacement) {
      updated = true;
      return `from "${replacement}"`;
    }
    return match;
  }).replace(/import\s+['"]([^'"]+)['"]/g, (match, importStr) => {
    const replacement = updateImportPath(importStr, filePath);
    if (replacement) {
      updated = true;
      return `import "${replacement}"`;
    }
    return match;
  });

  if (updated) {
    fs.writeFileSync(filePath, newContent, 'utf8');
  }
}

function walkDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.svelte-kit' || entry.name === '.git') continue;
      walkDir(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (ext === '.ts' || ext === '.js' || ext === '.svelte') {
        processFile(fullPath);
      }
    }
  }
}

walkDir('src');
console.log("All imports processed successfully!");

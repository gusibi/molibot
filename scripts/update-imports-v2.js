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

const relocationMap = new Map();
for (const [from, to] of moves) {
  const fromBase = from.replace(/\.ts$/, '');
  const toBase = to.replace(/\.ts$/, '');
  
  relocationMap.set(from, to);
  relocationMap.set(fromBase + '.js', toBase + '.js');
  relocationMap.set(fromBase, toBase);
}

const projectRoot = path.resolve('.');

function getOriginalDir(filePath) {
  const normalizedFilePath = filePath.replace(/\\/g, '/');
  const agentPathIndex = normalizedFilePath.indexOf('/src/lib/server/agent/');
  if (agentPathIndex === -1) {
    return path.dirname(normalizedFilePath);
  }
  
  const relPath = normalizedFilePath.substring(agentPathIndex + '/src/lib/server/agent/'.length);
  
  // If the file is one of the new destinations, it was moved from agent root
  let moved = false;
  for (const [_, to] of moves) {
    if (relPath === to) {
      moved = true;
      break;
    }
  }
  
  if (moved) {
    return normalizedFilePath.substring(0, agentPathIndex + '/src/lib/server/agent'.length);
  } else {
    return path.dirname(normalizedFilePath);
  }
}

function resolveAndMapImport(importStr, filePath) {
  // 1. If it starts with $lib/server/agent/
  if (importStr.startsWith('$lib/server/agent/')) {
    const subPath = importStr.substring('$lib/server/agent/'.length);
    if (relocationMap.has(subPath)) {
      return `$lib/server/agent/${relocationMap.get(subPath)}`;
    }
    return importStr;
  }
  
  // 2. If it starts with $lib/ (but not $lib/server/agent/)
  if (importStr.startsWith('$lib/')) {
    return importStr;
  }
  
  // 3. NPM package or external library imports
  if (!importStr.startsWith('./') && !importStr.startsWith('../')) {
    return importStr;
  }
  
  // 4. Relative imports
  const originalDir = getOriginalDir(filePath);
  const resolvedPath = path.normalize(path.resolve(originalDir, importStr)).replace(/\\/g, '/');
  
  // Check if resolvedPath is inside src/lib/server/agent/
  const agentPathIndex = resolvedPath.indexOf('/src/lib/server/agent/');
  if (agentPathIndex !== -1) {
    const subPath = resolvedPath.substring(agentPathIndex + '/src/lib/server/agent/'.length);
    let finalSubPath = subPath;
    if (relocationMap.has(subPath)) {
      finalSubPath = relocationMap.get(subPath);
    }
    return `$lib/server/agent/${finalSubPath}`;
  }
  
  // Check if resolvedPath is inside src/lib/ (outside agent/)
  const libPathIndex = resolvedPath.indexOf('/src/lib/');
  if (libPathIndex !== -1) {
    const subPath = resolvedPath.substring(libPathIndex + '/src/lib/'.length);
    return `$lib/${subPath}`;
  }
  
  return importStr;
}

function processFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let updated = false;
  let changesList = [];

  const newContent = content
    .replace(/(from\s+['"])([^'"]+)(['"])/g, (match, p1, importStr, p3) => {
      const replacement = resolveAndMapImport(importStr, filePath);
      if (replacement !== importStr) {
        updated = true;
        changesList.push(`  [from] ${importStr} -> ${replacement}`);
        return `${p1}${replacement}${p3}`;
      }
      return match;
    })
    .replace(/(import\(['"])([^'"]+)(['"]\))/g, (match, p1, importStr, p3) => {
      const replacement = resolveAndMapImport(importStr, filePath);
      if (replacement !== importStr) {
        updated = true;
        changesList.push(`  [import()] ${importStr} -> ${replacement}`);
        return `${p1}${replacement}${p3}`;
      }
      return match;
    })
    .replace(/(import\s+['"])([^'"]+)(['"])/g, (match, p1, importStr, p3) => {
      const replacement = resolveAndMapImport(importStr, filePath);
      if (replacement !== importStr) {
        updated = true;
        changesList.push(`  [import] ${importStr} -> ${replacement}`);
        return `${p1}${replacement}${p3}`;
      }
      return match;
    });

  if (updated) {
    fs.writeFileSync(filePath, newContent, 'utf8');
    console.log(`Processed: ${path.relative(projectRoot, filePath)}`);
    changesList.forEach(c => console.log(c));
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

console.log("Starting import paths update...");
walkDir(path.join(projectRoot, 'src'));
console.log("All imports processed successfully!");

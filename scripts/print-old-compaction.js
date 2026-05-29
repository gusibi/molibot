import { execSync } from 'child_process';
const output = execSync('git show HEAD:src/lib/server/agent/compaction.ts').toString();
console.log(output);

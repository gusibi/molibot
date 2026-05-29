import { execSync } from 'child_process';
import { globSync } from 'glob'; // Wait, glob might not be installed, we can use node's built-in fs or find
import fs from 'fs';
import path from 'path';

function findTests(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(findTests(file));
    } else {
      if (file.endsWith('.test.ts')) {
        results.push(file);
      }
    }
  });
  return results;
}

const tests = findTests('src/lib/server/agent');
console.log(`Found ${tests.length} test files to execute.`);

let passed = 0;
let failed = 0;
const failures = [];

tests.forEach(testFile => {
  console.log(`Running: ${testFile}...`);
  try {
    execSync(`npx node --import ./scripts/register-loader.js --import tsx --test "${testFile}"`, { stdio: 'inherit' });
    passed++;
  } catch (error) {
    console.error(`FAILED: ${testFile}`);
    failed++;
    failures.push(testFile);
  }
});

console.log('\n--- Test Run Summary ---');
console.log(`Passed: ${passed}/${tests.length}`);
console.log(`Failed: ${failed}/${tests.length}`);
if (failures.length > 0) {
  console.log('Failed tests:', failures);
  process.exit(1);
} else {
  console.log('All tests passed successfully!');
  process.exit(0);
}

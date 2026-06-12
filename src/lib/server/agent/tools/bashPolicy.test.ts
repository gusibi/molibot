import test from "node:test";
import assert from "node:assert/strict";
import { findFileToolRedirect } from "$lib/server/agent/tools/bashPolicy.js";

test("bash policy redirects standalone file readers to the read tool", () => {
  assert.match(findFileToolRedirect("cat notes.md") ?? "", /read tool/);
  assert.match(findFileToolRedirect("head -n 20 data.csv") ?? "", /read tool/);
  assert.match(findFileToolRedirect("tail -100 app.log") ?? "", /read tool/);
});

test("bash policy redirects shell file writes to the write/edit tools", () => {
  assert.match(findFileToolRedirect("echo 'hello' > out.txt") ?? "", /write tool/);
  assert.match(findFileToolRedirect("printf 'a\\n' >> out.txt") ?? "", /write tool/);
  assert.match(findFileToolRedirect("cat > config.json") ?? "", /write tool/);
  assert.match(findFileToolRedirect("cat <<EOF > script.sh") ?? "", /write tool/);
  assert.match(findFileToolRedirect("echo data | tee out.txt") ?? "", /write tool/);
});

test("bash policy redirects in-place editors to the edit tool", () => {
  assert.match(findFileToolRedirect("sed -i '' 's/a/b/' file.txt") ?? "", /edit tool/);
  assert.match(findFileToolRedirect("perl -i -pe 's/a/b/' file.txt") ?? "", /edit tool/);
});

test("bash policy allows legitimate compound shell usage", () => {
  assert.equal(findFileToolRedirect("cat a.csv b.csv > merged.csv"), null);
  assert.equal(findFileToolRedirect("cat access.log | grep 500 | wc -l"), null);
  assert.equal(findFileToolRedirect("make 2>&1 | tee build.log"), null);
  assert.equal(findFileToolRedirect("sed 's/a/b/' file.txt | sort"), null);
  assert.equal(findFileToolRedirect("npm test"), null);
  assert.equal(findFileToolRedirect("python3 process.py --input data.csv"), null);
});

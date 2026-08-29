const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('community project summaries use the owner onboarding role', () => {
  const source = fs.readFileSync('src/controllers/community.controller.js', 'utf8');
  assert.match(source, /if \(p\.owner\.toString\(\) === userId\) \{\s*role = user\.role \|\| '';/);
  assert.doesNotMatch(source, /role = 'Creator'/);
});

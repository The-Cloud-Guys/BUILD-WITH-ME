const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('community user bodies include the onboarding role', () => {
  const source = fs.readFileSync('src/controllers/community.controller.js', 'utf8');
  const userPopulationFields = [
    ...source.matchAll(
      /populate\('(author|follower|following)', '([^']+)'\)/g
    ),
  ];

  assert.ok(userPopulationFields.length > 0);
  for (const [, relation, fields] of userPopulationFields) {
    assert.match(fields, /(?:^|\s)role(?:\s|$)/, `${relation} is missing role`);
  }

  assert.match(
    source,
    /populate: \{ path: 'author', select: 'firstName lastName profilePhoto email role' \}/
  );
});

test('my applications exposes other accepted team members only after acceptance', () => {
  const source = fs.readFileSync('src/controllers/project.controller.js', 'utf8');
  const start = source.indexOf('const getMyApplications =');
  const end = source.indexOf('// ==============================\n// GET PROJECT TEAM', start);
  const handler = source.slice(start, end);

  assert.match(handler, /application\.status === 'ACCEPTED'/);
  assert.match(handler, /acceptedTeamMembers/);
  assert.match(handler, /attachAppliedProjectRoles/);
  assert.match(handler, /member\.role && member\._id\.toString\(\) !== req\.user\.id/);
  assert.match(handler, /populate: \[\s*\{ path: 'owner', select: PROJECT_PARTICIPANT_FIELDS \}/);
});

test('authentication user summaries expose the onboarding role', () => {
  const source = fs.readFileSync('src/controllers/auth.controller.js', 'utf8');
  assert.ok(
    (source.match(/role: user\.role/g) || []).length >= 4,
    'verification, login, reset, and Firebase user summaries must include role'
  );
});

test('admin embedded user selections include role', () => {
  const source = fs.readFileSync('src/controllers/admin.controller.js', 'utf8');
  const selections = [
    ...source.matchAll(
      /populate\('(reporter|reportedUser|user|addedBy|admin)', '([^']+)'\)/g
    ),
  ];
  assert.ok(selections.length > 0);
  for (const [, relation, fields] of selections) {
    assert.match(fields, /(?:^|\s)role(?:\s|$)/, `${relation} is missing role`);
  }
});

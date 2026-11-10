const test = require('node:test');
const assert = require('node:assert/strict');

const {
  combinedProfileValidation,
  normalizeSkillsInput,
} = require('../src/validation/onboarding.validation');

test('combined multipart onboarding accepts role, profile fields, and repeated skills', () => {
  const skills = normalizeSkillsInput(['Node.js', 'MongoDB']);
  const result = combinedProfileValidation({
    firstName: 'Habeeb',
    lastName: 'Olakunle',
    role: 'Developer',
    skills,
    bio: 'Backend developer',
    externalLink: 'https://example.com',
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.value.skills, ['Node.js', 'MongoDB']);
});

test('combined multipart onboarding normalizes JSON and comma-separated skills', () => {
  assert.deepEqual(normalizeSkillsInput('["Node.js","MongoDB"]'), ['Node.js', 'MongoDB']);
  assert.deepEqual(normalizeSkillsInput('Node.js, MongoDB'), ['Node.js', 'MongoDB']);
});

test('combined onboarding rejects missing role or skills', () => {
  const result = combinedProfileValidation({
    firstName: 'Habeeb',
    lastName: 'Olakunle',
  });

  assert.ok(result.error);
  const messages = result.error.details.map((detail) => detail.message).join(' ');
  assert.match(messages, /role/);
  assert.match(messages, /skills/);
});

test('partial multipart profile update validates optional role and skills', () => {
  const valid = combinedProfileValidation({
    role: 'Designer',
    skills: normalizeSkillsInput('Figma, UX Research'),
  }, { partial: true });
  assert.equal(valid.error, undefined);

  const invalid = combinedProfileValidation({ role: 'Unknown Role' }, { partial: true });
  assert.ok(invalid.error);
});

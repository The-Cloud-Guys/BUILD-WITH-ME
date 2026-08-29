const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createAvatarResolver,
  attachResolvedAvatar,
} = require('../src/services/avatar.service');

test('project participant serialization preserves complete public member details', async () => {
  const participant = {
    _id: 'user-1',
    email: 'member@example.com',
    firstName: 'John',
    lastName: 'Douglas',
    role: 'Developer',
    skills: ['Node.js', 'Flutter'],
    profilePhoto: 'users/user-1/profile.jpg',
  };
  const resolveAvatar = createAvatarResolver({
    bucket: 'avatars',
    signUrl: async (_, path) => `https://storage.example/${path}?signed=1`,
  });

  const result = await attachResolvedAvatar(participant, resolveAvatar);
  assert.deepEqual(
    {
      _id: result._id,
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      role: result.role,
      skills: result.skills,
    },
    {
      _id: 'user-1',
      email: 'member@example.com',
      firstName: 'John',
      lastName: 'Douglas',
      role: 'Developer',
      skills: ['Node.js', 'Flutter'],
    }
  );
  assert.match(result.profilePhoto, /^https:\/\/storage\.example\//);
});

test('missing populated project participants remain null', async () => {
  const resolveAvatar = createAvatarResolver({
    signUrl: async () => assert.fail('signer should not run'),
  });
  assert.equal(await attachResolvedAvatar(null, resolveAvatar), null);
});

test('every populated project owner uses the same public participant fields', () => {
  const source = fs.readFileSync('src/controllers/project.controller.js', 'utf8');
  assert.match(
    source,
    /PROJECT_PARTICIPANT_FIELDS\s*=\s*[\s\S]*firstName lastName profilePhoto email role skills/
  );

  const ownerPopulates = source.match(
    /populate\('owner', PROJECT_PARTICIPANT_FIELDS\)/g
  ) || [];
  const allOwnerPopulates = source.match(/populate\('owner',/g) || [];
  const memberPopulates = source.match(
    /populate\('teamMembers', PROJECT_PARTICIPANT_FIELDS\)/g
  ) || [];
  assert.ok(ownerPopulates.length > 0);
  assert.equal(ownerPopulates.length, allOwnerPopulates.length);
  assert.equal(memberPopulates.length, 3);
});

test('admin project owner responses include the onboarding role', () => {
  const source = fs.readFileSync('src/controllers/admin.controller.js', 'utf8');
  assert.match(
    source,
    /populate\('owner', 'firstName lastName profilePhoto email role skills'\)/
  );
});

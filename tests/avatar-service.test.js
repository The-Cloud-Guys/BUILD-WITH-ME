const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAvatarResolver,
  attachResolvedAvatar,
} = require('../src/services/avatar.service');

test('avatar paths resolve through the existing signed URL mechanism', async () => {
  const resolveAvatar = createAvatarResolver({
    bucket: 'avatars',
    signUrl: async (bucket, path) => `https://storage.example/${bucket}/${path}?signed=1`,
  });
  const member = await attachResolvedAvatar({
    _id: 'user-1',
    profilePhoto: 'users/user-1/profile.jpg',
    role: 'Developer',
  }, resolveAvatar);

  assert.match(member.profilePhoto, /^https:\/\/storage\.example\/avatars\//);
  assert.equal(member.role, 'Developer');
});

test('avatar resolver preserves null and already resolved URLs', async () => {
  const resolveAvatar = createAvatarResolver({
    signUrl: async () => assert.fail('signer should not run'),
  });
  assert.equal(await resolveAvatar(null), null);
  assert.equal(
    await resolveAvatar('https://storage.example/avatar.jpg'),
    'https://storage.example/avatar.jpg'
  );
});

test('avatar signing failure degrades to null without leaking a raw path', async () => {
  const resolveAvatar = createAvatarResolver({
    signUrl: async () => { throw new Error('storage unavailable'); },
  });
  assert.equal(await resolveAvatar('users/user-1/profile.jpg'), null);
});

test('multiple members with the same avatar path share one signing operation', async () => {
  let calls = 0;
  const resolveAvatar = createAvatarResolver({
    signUrl: async (_, path) => {
      calls += 1;
      return `https://storage.example/${path}`;
    },
  });

  const members = await Promise.all([
    attachResolvedAvatar({ _id: 'one', profilePhoto: 'users/shared.jpg' }, resolveAvatar),
    attachResolvedAvatar({ _id: 'two', profilePhoto: 'users/shared.jpg' }, resolveAvatar),
  ]);
  assert.equal(calls, 1);
  assert.equal(members[0].profilePhoto, members[1].profilePhoto);
});

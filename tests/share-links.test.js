const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeFrontendUrl,
  buildPostShare,
  buildCommentShare,
  buildProfileShare,
  buildProjectShare,
} = require('../src/services/shareLink.service');

test('normalizes only absolute HTTP frontend URLs', () => {
  assert.equal(normalizeFrontendUrl('https://app.connexd.example/'), 'https://app.connexd.example');
  assert.equal(normalizeFrontendUrl('javascript:alert(1)'), null);
  assert.equal(normalizeFrontendUrl('/relative'), null);
});

test('builds stable post and profile share paths', () => {
  const post = buildPostShare({ _id: 'post-123', content: 'A useful post' });
  const profile = buildProfileShare({
    _id: 'user-123',
    firstName: 'Ada',
    lastName: 'Lovelace',
    bio: 'Builder',
  });

  assert.equal(post.path, '/share/post/post-123');
  assert.equal(post.text, 'A useful post');
  assert.equal(profile.path, '/share/profile/user-123');
  assert.equal(profile.title, 'Ada Lovelace on Connexd');
});

test('comment share paths identify both the post and exact comment', () => {
  const share = buildCommentShare({
    _id: 'comment-123',
    post: 'post-123',
    content: 'Open this comment directly',
  });

  assert.equal(share.path, '/share/post/post-123?comment=comment-123');
  assert.equal(share.resourceId, 'comment-123');
});

test('project share links use the reusable resource convention', () => {
  const share = buildProjectShare({
    _id: 'project-123',
    title: 'Build Together',
    description: 'A collaborative project',
  });
  assert.equal(share.path, '/share/project/project-123');
  assert.equal(share.title, 'Build Together on Connexd');
});

test('share text is whitespace-normalized and safely truncated', () => {
  const share = buildPostShare({
    _id: 'post-123',
    content: `  ${'word '.repeat(50)}  `,
  });

  assert.equal(share.text.includes('\n'), false);
  assert.ok(share.text.length <= 160);
  assert.ok(share.text.endsWith('…'));
});

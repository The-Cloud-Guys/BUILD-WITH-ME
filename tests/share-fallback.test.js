const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const {
  createShareResourceResolver,
} = require('../src/services/shareResource.service');
const {
  escapeHtml,
  renderFallbackPage,
} = require('../src/controllers/share.controller');

const postId = '6a8a0835218f0138df7389fa';
const commentId = '6a8a0835218f0138df7389fb';

const makeResolver = ({ post = true, comment = true, user = true, project = true } = {}) =>
  createShareResourceResolver({
    PostModel: { exists: async () => post },
    CommentModel: {
      exists: async () => comment,
      findOne: async () => (comment ? { post: postId } : null),
    },
    UserModel: { exists: async () => user },
    ProjectModel: { exists: async () => project },
    isValidObjectId: (value) => /^[a-f\d]{24}$/i.test(value),
  });

test('share resolver accepts an existing visible post', async () => {
  const result = await makeResolver()({ resourceType: 'post', resourceId: postId });
  assert.equal(result.status, 200);
  assert.equal(result.resourceType, 'post');
});

test('share resolver rejects malformed and nonexistent post IDs', async () => {
  assert.equal(
    (await makeResolver()({ resourceType: 'post', resourceId: 'bad-id' })).status,
    400
  );
  assert.equal(
    (await makeResolver({ post: false })({ resourceType: 'post', resourceId: postId })).status,
    404
  );
});

test('share resolver treats hidden or inaccessible posts as unavailable', async () => {
  const result = await makeResolver({ post: false })({
    resourceType: 'post',
    resourceId: postId,
  });
  assert.deepEqual(result, { status: 404, reason: 'not_found' });
});

test('post comment links require a comment belonging to that post', async () => {
  const valid = await makeResolver()({
    resourceType: 'post',
    resourceId: postId,
    commentId,
  });
  const missing = await makeResolver({ comment: false })({
    resourceType: 'post',
    resourceId: postId,
    commentId,
  });

  assert.equal(valid.status, 200);
  assert.equal(valid.commentId, commentId);
  assert.equal(missing.status, 404);
});

test('direct comment links normalize to the parent post representation', async () => {
  const result = await makeResolver()({
    resourceType: 'comment',
    resourceId: commentId,
  });
  assert.equal(result.status, 200);
  assert.equal(result.canonicalPath, `/share/post/${postId}?comment=${commentId}`);
});

test('share fallback HTML escapes dynamic values and contains social metadata', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  const html = renderFallbackPage({
    title: 'Open this Connexd post',
    description: 'Shared safely',
    canonicalPath: `/share/post/${postId}`,
  });
  assert.match(html, /og:title/);
  assert.match(html, /og:description/);
  assert.match(html, /Open this Connexd post/);
});

test('public share router is mounted before the final Express 404 handler', () => {
  const source = fs.readFileSync('src/index.js', 'utf8');
  const shareMount = source.indexOf("app.use('/share', shareRoutes)");
  const final404 = source.indexOf("message: 'Route not found'");
  assert.ok(shareMount >= 0);
  assert.ok(final404 > shareMount);
});

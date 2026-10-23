const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Post = require('../src/models/post.model');
const PollVote = require('../src/models/pollVote.model');
const { Report } = require('../src/models/admin.model');
const { createPostValidation, reportValidation } = require('../src/validation/community.validation');
const { getPendingReason, getUserStatus } = require('../src/utils/userStatus');

test('post schema exposes explicit code, link, poll, and photo types', () => {
  assert.deepEqual(Post.schema.path('postType').enumValues, ['text', 'code', 'link', 'poll', 'photo']);
  assert.ok(Post.schema.path('code'));
  assert.ok(Post.schema.path('link'));
  assert.ok(Post.schema.path('poll'));
});

test('post creation validates each type-specific body', () => {
  assert.equal(createPostValidation({ postType: 'text', content: 'Hello', mediaCount: 0 }).error, undefined);
  assert.equal(createPostValidation({ postType: 'code', codeLanguage: 'javascript', codeSnippet: 'const ok = true;', mediaCount: 0 }).error, undefined);
  assert.equal(createPostValidation({ postType: 'link', linkUrl: 'https://example.com', mediaCount: 0 }).error, undefined);
  assert.equal(createPostValidation({ postType: 'poll', pollQuestion: 'Choose', pollOptions: ['A', 'B'], pollDurationHours: 24, mediaCount: 0 }).error, undefined);
  assert.equal(createPostValidation({ postType: 'photo', content: '', mediaCount: 1 }).error, undefined);
  assert.match(createPostValidation({ postType: 'photo', mediaCount: 0 }).error.details[0].message, /media file/);
});

test('poll votes enforce one vote per user and voting uses a transaction', () => {
  assert.ok(PollVote.schema.indexes().some(([keys, options]) => (
    keys.post === 1 && keys.user === 1 && options.unique === true
  )));
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'community.controller.js'), 'utf8');
  assert.match(source, /session\.withTransaction/);
  assert.match(source, /You have already voted on this poll/);
  assert.match(source, /poll\.options\.\$\.voteCount/);
});

test('reports capture offense category and related project', () => {
  assert.ok(Report.schema.path('offenseType'));
  assert.ok(Report.schema.path('relatedProject'));
  const result = reportValidation({
    reason: 'Project contains misleading information',
    offenseType: 'misinformation',
    projectId: '64b64cfa12ab34cd56ef7890',
  });
  assert.equal(result.error, undefined);
});

test('user status is mutually exclusive and explains pending accounts', () => {
  assert.equal(getUserStatus({ isActive: false, isSuspended: true, emailVerified: true, onboardingStep: 3 }), 'terminated');
  assert.equal(getUserStatus({ isActive: true, isSuspended: true, emailVerified: true, onboardingStep: 3 }), 'suspended');
  assert.equal(getUserStatus({ isActive: true, isSuspended: false, emailVerified: true, onboardingStep: 2 }), 'pending');
  assert.equal(getPendingReason({ isActive: true, isSuspended: false, emailVerified: true, onboardingStep: 2 }), 'onboarding_incomplete');
  assert.equal(getUserStatus({ isActive: true, isSuspended: false, emailVerified: true, onboardingStep: 3 }), 'active');
});

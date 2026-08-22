const test = require('node:test');
const assert = require('node:assert/strict');

const Notification = require('../src/models/notification.model');
const Post = require('../src/models/post.model');
const Project = require('../src/models/project.model');
const { Message, ChatRoom, UnreadMessage } = require('../src/models/chat.model');

test('notification schema supports emitted types and dismissal', () => {
  const types = Notification.schema.path('type').enumValues;
  assert.ok(types.includes('TEAM_REMOVED'));
  assert.ok(types.includes('SYSTEM_ANNOUNCEMENT'));
  assert.equal(new Notification().dismissed, false);
});

test('project and post moderation defaults are safe', () => {
  const project = new Project({
    title: 'Test',
    description: 'Test project',
    owner: '507f1f77bcf86cd799439011',
  });
  assert.equal(project.status, 'OPEN');
  assert.equal(project.isHidden, false);
  assert.equal(new Post().isHidden, false);
});

test('chat schemas protect message and room uniqueness contracts', () => {
  assert.deepEqual(new Message().media, []);
  assert.ok(
    UnreadMessage.schema
      .indexes()
      .some(([keys, options]) => keys.room === 1 && keys.user === 1 && options.unique)
  );
  assert.ok(
    ChatRoom.schema
      .indexes()
      .some(([keys, options]) => keys.projectId === 1 && keys.type === 1 && options.unique)
  );
});

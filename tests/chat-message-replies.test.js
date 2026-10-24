const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { Message } = require('../src/models/chat.model');
const {
  replyPopulate,
  serializeReplyTo,
  validateReplyTarget,
} = require('../src/services/chatReply.service');

const read = (file) => fs.readFileSync(file, 'utf8');

test('message schema stores an optional self-referencing reply', () => {
  const replyPath = Message.schema.path('replyTo');
  assert.equal(replyPath.options.ref, 'Message');
  assert.equal(replyPath.options.default, null);
  assert.equal(new Message().replyTo, null);
});

test('reply population is one level and includes the quoted sender summary', () => {
  assert.equal(replyPopulate.path, 'replyTo');
  assert.match(replyPopulate.select, /content/);
  assert.doesNotMatch(replyPopulate.select, /replyTo/);
  assert.equal(replyPopulate.populate.path, 'sender');
  assert.match(replyPopulate.populate.select, /firstName/);
  assert.match(replyPopulate.populate.select, /lastName/);
});

test('deleted quoted messages retain identity but redact deleted content and media', () => {
  const serialized = serializeReplyTo({
    _id: 'new-message',
    replyTo: {
      _id: 'old-message',
      content: 'secret',
      media: ['private-file'],
      mediaType: 'image',
      isDeleted: true,
      sender: { firstName: 'John', lastName: 'Doe' },
    },
  });

  assert.equal(serialized.replyTo._id, 'old-message');
  assert.equal(serialized.replyTo.content, '');
  assert.deepEqual(serialized.replyTo.media, []);
  assert.equal(serialized.replyTo.mediaType, null);
  assert.equal(serialized.replyTo.isDeleted, true);
});

test('HTTP and socket send paths both accept and validate replyTo', () => {
  const controller = read('src/controllers/chat.controller.js');
  const socket = read('src/socket/index.js');
  for (const source of [controller, socket]) {
    assert.match(source, /validateReplyTarget/);
    assert.match(source, /replyTo:\s*replyTargetId/);
    assert.match(source, /populateReplyTo/);
  }
});

test('reply validation rejects malformed, missing, and deleted targets', async (t) => {
  const originalFindOne = Message.findOne;
  t.after(() => { Message.findOne = originalFindOne; });

  await assert.rejects(
    validateReplyTarget({ replyTo: 'not-an-object-id', roomId: '507f1f77bcf86cd799439011' }),
    (error) => error.statusCode === 400 && error.message === 'Invalid replyTo message ID'
  );

  Message.findOne = () => ({
    select: () => ({ lean: async () => null }),
  });
  await assert.rejects(
    validateReplyTarget({
      replyTo: '507f1f77bcf86cd799439012',
      roomId: '507f1f77bcf86cd799439011',
    }),
    (error) => error.statusCode === 400 && error.message === 'Reply message was not found in this room'
  );

  Message.findOne = () => ({
    select: () => ({
      lean: async () => ({ _id: '507f1f77bcf86cd799439012', isDeleted: true }),
    }),
  });
  await assert.rejects(
    validateReplyTarget({
      replyTo: '507f1f77bcf86cd799439012',
      roomId: '507f1f77bcf86cd799439011',
    }),
    (error) => error.statusCode === 400 && error.message === 'You cannot reply to a deleted message'
  );
});

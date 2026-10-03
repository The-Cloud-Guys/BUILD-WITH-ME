const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('room list exposes the existing Messages screen contract', () => {
  const controller = read('src/controllers/chat.controller.js');
  assert.match(controller, /displayName/);
  assert.match(controller, /displayPhoto/);
  assert.match(controller, /otherParticipant/);
  assert.match(controller, /memberNames/);
  assert.match(controller, /memberPreview/);
  assert.match(controller, /unreadCount/);
  assert.match(controller, /isUserOnline/);
  assert.match(controller, /populate:\s*\{ path: 'sender'/);
  assert.match(controller, /createAvatarResolver/);
  assert.match(controller, /roomIcon:\s*undefined/);
});

test('chat room schema supports an icon and description', () => {
  const { ChatRoom } = require('../src/models/chat.model');
  assert.ok(ChatRoom.schema.path('roomIcon'));
  assert.ok(ChatRoom.schema.path('description'));
  assert.deepEqual(ChatRoom.schema.path('type').enumValues, [
    'direct', 'team_room', 'open_group', 'project_group',
  ]);
});

test('New Room uses one multipart endpoint with explicit supported group types', () => {
  const controller = read('src/controllers/chat.controller.js');
  const routes = read('src/routes/chat.routes.js');
  assert.match(routes, /post\('\/groups', handleGroupIconUpload, createGroup\)/);
  assert.match(controller, /single\('icon'\)/);
  assert.match(controller, /fileSize:\s*5 \* 1024 \* 1024/);
  assert.match(controller, /\['open_group', 'project_group'\]/);
  assert.match(controller, /Project groups can include only project team members/);
  assert.match(controller, /participantIds contains an invalid user ID/);
});

test('candidate discovery supports project members and open-group users', () => {
  const controller = read('src/controllers/chat.controller.js');
  const routes = read('src/routes/chat.routes.js');
  assert.match(routes, /get\('\/group-candidates', getGroupCandidates\)/);
  assert.match(controller, /onboardingStep:\s*\{ \$gte: 3 \}/);
  assert.match(controller, /status:\s*'ACCEPTED'/);
  assert.match(controller, /pages:\s*Math\.ceil\(total \/ parsedLimit\)/);
});

test('POST direct-room creation is added without removing GET compatibility', () => {
  const routes = read('src/routes/chat.routes.js');
  assert.match(routes, /get\('\/direct\/:userId', getOrCreateDirectRoom\)/);
  assert.match(routes, /post\('\/direct\/:userId', getOrCreateDirectRoom\)/);
});

test('single-instance socket presence tracks multiple connections per user', () => {
  const socket = read('src/socket/index.js');
  assert.match(socket, /this\.onlineUsers = new Map\(\)/);
  assert.match(socket, /this\.onlineUsers\.get\(socket\.userId\).*\+ 1/);
  assert.match(socket, /isUserOnline\(userId\)/);
  assert.match(socket, /presence-update/);
});

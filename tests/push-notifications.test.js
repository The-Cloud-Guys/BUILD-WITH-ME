const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('notification devices support multiple installations and token cleanup', () => {
  const model = read('src/models/notificationDevice.model.js');
  const controller = read('src/controllers/notification.controller.js');
  const routes = read('src/routes/notification.routes.js');
  assert.match(model, /user:\s*1, deviceId:\s*1.*unique:\s*true/s);
  assert.match(model, /token:[\s\S]*unique:\s*true/);
  assert.match(routes, /post\('\/devices', registerDevice\)/);
  assert.match(routes, /delete\('\/devices\/:deviceId', unregisterDevice\)/);
  assert.match(controller, /isActive:\s*false/);
});

test('push delivery uses Firebase multicast and deactivates invalid tokens', () => {
  const service = read('src/services/pushNotification.service.js');
  const firebase = read('src/services/firebase.service.js');
  assert.match(firebase, /getFirebaseMessaging/);
  assert.match(service, /sendEachForMulticast/);
  assert.match(service, /messaging\/registration-token-not-registered/);
  assert.match(service, /NotificationDevice\.updateMany/);
  assert.match(service, /type:\s*'chat_message'/);
  assert.match(service, /type:\s*eventType/);
});

test('call sessions persist lifecycle and atomically accept one recipient', () => {
  const model = read('src/models/callSession.model.js');
  const controller = read('src/controllers/chatCall.controller.js');
  const routes = read('src/routes/chat.routes.js');
  assert.match(model, /ringing.*accepted.*declined.*missed.*cancelled.*ended/s);
  assert.match(model, /expiresAt:[\s\S]*required:\s*true/);
  assert.match(controller, /findOneAndUpdate\([\s\S]*status:\s*'ringing'[\s\S]*expiresAt:\s*\{ \$gt: now \}/);
  for (const endpoint of ['accept', 'decline', 'cancel', 'end']) {
    assert.match(routes, new RegExp(`post\\('\\/calls\\/:callId\\/${endpoint}'`));
  }
  assert.match(routes, /post\('\/rooms\/:roomId\/calls', createCall\)/);
});

test('both HTTP and socket message paths send push notifications', () => {
  assert.match(read('src/controllers/chat.controller.js'), /sendChatMessagePush/);
  assert.match(read('src/socket/index.js'), /sendChatMessagePush/);
});

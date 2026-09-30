const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (path) => fs.readFileSync(path, 'utf8');

test('ICE credentials are call scoped, authenticated, and rate limited', () => {
  const routes = read('src/routes/chat.routes.js');
  const controller = read('src/controllers/iceServer.controller.js');
  const limiter = read('src/middleware/rateLimiter.js');
  assert.match(routes, /router\.use\(protect\)/);
  assert.match(routes, /get\('\/calls\/:callId\/ice-servers', iceServerLimiter, getCallIceServers\)/);
  assert.match(controller, /Not a participant in this call/);
  assert.match(controller, /\['ringing', 'accepted'\]/);
  assert.match(limiter, /iceServerLimiter[\s\S]*max:\s*10/);
});

test('Cloudflare TURN uses server credentials and returns expiring ICE servers', () => {
  const service = read('src/services/iceServer.service.js');
  assert.match(service, /CLOUDFLARE_TURN_KEY_ID/);
  assert.match(service, /CLOUDFLARE_TURN_API_TOKEN/);
  assert.match(service, /credentials\/generate-ice-servers/);
  assert.match(service, /Authorization:\s*`Bearer \$\{apiToken\}`/);
  assert.match(service, /response\.data\?\.iceServers/);
  assert.match(service, /Call connectivity service is temporarily unavailable/);
  assert.doesNotMatch(service, /console\.(log|error)\([^\n]*(apiToken|response\.data|credentials)/);
});

test('signaling targets only both participants in an accepted persisted call', () => {
  const socket = read('src/socket/index.js');
  const signalStart = socket.indexOf("socket.on('signal'");
  const disconnectStart = socket.indexOf("socket.on('disconnect'", signalStart);
  const handler = socket.slice(signalStart, disconnectStart);
  assert.match(handler, /callId, roomId, targetUserId, signal/);
  assert.match(handler, /status:\s*'accepted'/);
  assert.match(handler, /caller answeredBy/);
  assert.match(handler, /to\(`user:\$\{targetUserId\}`\)/);
  assert.doesNotMatch(handler, /socket\.to\(`room:/);
});

test('legacy socket call state no longer creates an in-memory source of truth', () => {
  const socket = read('src/socket/index.js');
  assert.doesNotMatch(socket, /activeCalls\s*=\s*new Map/);
  assert.match(socket, /PERSISTENT_CALL_REQUIRED/);
});

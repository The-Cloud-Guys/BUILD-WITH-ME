const axios = require('axios');

const credentialCache = new Map();
const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 86400;

const getTtlSeconds = () => {
  const configured = Number.parseInt(process.env.WEBRTC_ICE_TTL_SECONDS || '3600', 10);
  if (!Number.isFinite(configured)) return 3600;
  return Math.min(MAX_TTL_SECONDS, Math.max(MIN_TTL_SECONDS, configured));
};

const getCloudflareIceServers = async () => {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !apiToken) {
    const error = new Error('Call connectivity service is not configured');
    error.statusCode = 503;
    throw error;
  }

  const ttl = getTtlSeconds();
  try {
    const response = await axios.post(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      { ttl },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );
    if (!Array.isArray(response.data?.iceServers) || response.data.iceServers.length < 2) {
      throw new Error('Invalid ICE response');
    }
    return {
      iceServers: response.data.iceServers,
      expiresAt: new Date(Date.now() + ttl * 1000),
      ttl,
    };
  } catch (error) {
    if (error.statusCode) throw error;
    console.error('ICE credential generation failed:', error.code || error.name || 'provider_error');
    const unavailable = new Error('Call connectivity service is temporarily unavailable');
    unavailable.statusCode = 503;
    throw unavailable;
  }
};

const getIceServers = async ({ callId, userId }) => {
  const provider = (process.env.WEBRTC_ICE_PROVIDER || 'cloudflare').toLowerCase();
  if (provider !== 'cloudflare') {
    const error = new Error('Configured ICE provider is not supported');
    error.statusCode = 503;
    throw error;
  }

  const cacheKey = `${callId}:${userId}`;
  const cached = credentialCache.get(cacheKey);
  if (cached && cached.expiresAt.getTime() - Date.now() > 60 * 1000) return cached;
  if (cached) credentialCache.delete(cacheKey);
  if (credentialCache.size > 1000) {
    const now = Date.now();
    for (const [key, value] of credentialCache) {
      if (value.expiresAt.getTime() <= now) credentialCache.delete(key);
    }
  }

  const credentials = await getCloudflareIceServers();
  credentialCache.set(cacheKey, credentials);
  return credentials;
};

const clearIceCredentialCache = () => credentialCache.clear();

module.exports = {
  clearIceCredentialCache,
  getIceServers,
  getTtlSeconds,
};

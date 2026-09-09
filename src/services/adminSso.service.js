const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');

const PROVIDERS = Object.freeze({
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    clientIdEnv: 'ADMIN_GOOGLE_CLIENT_ID',
    clientSecretEnv: 'ADMIN_GOOGLE_CLIENT_SECRET',
    callbackEnv: 'ADMIN_GOOGLE_CALLBACK_URL',
  },
  microsoft: {
    clientIdEnv: 'ADMIN_MICROSOFT_CLIENT_ID',
    clientSecretEnv: 'ADMIN_MICROSOFT_CLIENT_SECRET',
    callbackEnv: 'ADMIN_MICROSOFT_CALLBACK_URL',
  },
});

const jwksCache = new Map();
const encode = (value) => Buffer.from(value).toString('base64url');

const getProvider = (name) => {
  const base = PROVIDERS[name];
  if (!base) {
    const error = new Error('Unsupported admin SSO provider');
    error.statusCode = 400;
    throw error;
  }
  if (name !== 'microsoft') return base;

  const tenant = process.env.ADMIN_MICROSOFT_TENANT_ID;
  if (!tenant || ['common', 'organizations', 'consumers'].includes(tenant.toLowerCase())) {
    const error = new Error('ADMIN_MICROSOFT_TENANT_ID must be a specific tenant ID');
    error.statusCode = 503;
    throw error;
  }
  const root = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`;
  return {
    ...base,
    authorizationUrl: `${root}/oauth2/v2.0/authorize`,
    tokenUrl: `${root}/oauth2/v2.0/token`,
    jwksUrl: `${root}/discovery/v2.0/keys`,
    issuer: `${root}/v2.0`,
  };
};

const getConfiguration = (providerName) => {
  const provider = getProvider(providerName);
  const clientId = process.env[provider.clientIdEnv];
  const clientSecret = process.env[provider.clientSecretEnv];
  const callbackUrl = process.env[provider.callbackEnv];
  if (!clientId || !clientSecret || !callbackUrl) {
    const error = new Error(`${providerName} admin SSO is not configured`);
    error.statusCode = 503;
    throw error;
  }
  let parsedCallback;
  try {
    parsedCallback = new URL(callbackUrl);
  } catch (_) {
    const error = new Error(`${providerName} admin SSO callback URL is invalid`);
    error.statusCode = 503;
    throw error;
  }
  if (!['https:', 'http:'].includes(parsedCallback.protocol)) {
    const error = new Error(`${providerName} admin SSO callback URL is invalid`);
    error.statusCode = 503;
    throw error;
  }
  if (process.env.NODE_ENV === 'production' && parsedCallback.protocol !== 'https:') {
    const error = new Error(`${providerName} admin SSO callback URL must use HTTPS`);
    error.statusCode = 503;
    throw error;
  }
  return { ...provider, clientId, clientSecret, callbackUrl };
};

const createSsoRequest = (providerName) => {
  const configuration = getConfiguration(providerName);
  const nonce = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = jwt.sign(
    { provider: providerName, nonce, type: 'admin_sso_state' },
    process.env.ADMIN_JWT_SECRET,
    { expiresIn: '10m', issuer: 'connexd-admin-api', audience: 'connexd-admin-sso' }
  );
  const query = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return { authorizationUrl: `${configuration.authorizationUrl}?${query}`, state, verifier };
};

const getSigningKey = async (jwksUrl, keyId) => {
  let cached = jwksCache.get(jwksUrl);
  if (!cached || cached.expiresAt <= Date.now()) {
    const response = await axios.get(jwksUrl, { timeout: 10000 });
    cached = { keys: response.data.keys || [], expiresAt: Date.now() + 60 * 60 * 1000 };
    jwksCache.set(jwksUrl, cached);
  }
  const jwk = cached.keys.find((key) => key.kid === keyId && key.kty === 'RSA');
  if (!jwk) {
    jwksCache.delete(jwksUrl);
    const error = new Error('SSO signing key is unavailable');
    error.statusCode = 401;
    throw error;
  }
  return crypto.createPublicKey({ key: jwk, format: 'jwk' });
};

const exchangeAuthorizationCode = async (providerName, code, verifier, nonce) => {
  const configuration = getConfiguration(providerName);
  const body = new URLSearchParams({
    client_id: configuration.clientId,
    client_secret: configuration.clientSecret,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: configuration.callbackUrl,
  });
  const response = await axios.post(configuration.tokenUrl, body.toString(), {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  if (!response.data.id_token) throw new Error('SSO provider did not return an ID token');

  const decoded = jwt.decode(response.data.id_token, { complete: true });
  if (!decoded?.header?.kid) throw new Error('SSO ID token is malformed');
  const signingKey = await getSigningKey(configuration.jwksUrl, decoded.header.kid);
  const claims = jwt.verify(response.data.id_token, signingKey, {
    algorithms: ['RS256'],
    audience: configuration.clientId,
    issuer: configuration.issuer,
  });
  if (!claims.sub || claims.nonce !== nonce) {
    const error = new Error('SSO identity validation failed');
    error.statusCode = 401;
    throw error;
  }
  const email = String(claims.email || claims.preferred_username || '').trim().toLowerCase();
  if (!email || (providerName === 'google' && claims.email_verified !== true)) {
    const error = new Error('A verified SSO email address is required');
    error.statusCode = 401;
    throw error;
  }
  return { subject: claims.sub, email };
};

const verifySsoState = (state) => jwt.verify(state, process.env.ADMIN_JWT_SECRET, {
  issuer: 'connexd-admin-api',
  audience: 'connexd-admin-sso',
});

module.exports = {
  createSsoRequest,
  exchangeAuthorizationCode,
  getConfiguration,
  verifySsoState,
};

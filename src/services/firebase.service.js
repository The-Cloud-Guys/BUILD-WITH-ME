const admin = require('firebase-admin');

const getFirebaseAuth = () => {
  if (!admin.apps.length) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) {
      const error = new Error('Firebase authentication is not configured');
      error.statusCode = 503;
      throw error;
    }
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin.auth();
};

/**
 * Verify Firebase ID token
 * @param {string} idToken - The Firebase ID token from client
 * @returns {Promise<Object>} Decoded token payload (uid, email, name, picture, etc.)
 */
const verifyFirebaseToken = async (idToken, { checkRevoked = false } = {}) => {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid or missing Firebase token');
  }
  try {
    const decodedToken = await getFirebaseAuth().verifyIdToken(idToken, checkRevoked);
    return decodedToken;
  } catch (error) {
    if (error.statusCode === 503) throw error;
    console.error('Firebase token verification failed:', error.message);
    const invalidToken = new Error('Invalid or expired Firebase token');
    invalidToken.statusCode = 401;
    throw invalidToken;
  }
};

const createFirebaseSessionCookie = async (idToken, expiresIn) => {
  const decoded = await verifyFirebaseToken(idToken, { checkRevoked: true });
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!decoded.auth_time || nowSeconds - decoded.auth_time > 5 * 60) {
    const error = new Error('Recent Firebase authentication is required');
    error.statusCode = 401;
    throw error;
  }
  return getFirebaseAuth().createSessionCookie(idToken, { expiresIn });
};

const verifyFirebaseSessionCookie = async (sessionCookie) => {
  if (!sessionCookie || typeof sessionCookie !== 'string') {
    const error = new Error('Admin session cookie required');
    error.statusCode = 401;
    throw error;
  }
  try {
    return await getFirebaseAuth().verifySessionCookie(sessionCookie, true);
  } catch (error) {
    if (error.statusCode === 503) throw error;
    const invalidSession = new Error('Invalid or expired admin session');
    invalidSession.statusCode = 401;
    throw invalidSession;
  }
};

const revokeFirebaseSessions = async (uid) => {
  if (uid) await getFirebaseAuth().revokeRefreshTokens(uid);
};

module.exports = {
  createFirebaseSessionCookie,
  getFirebaseAuth,
  revokeFirebaseSessions,
  verifyFirebaseSessionCookie,
  verifyFirebaseToken,
};

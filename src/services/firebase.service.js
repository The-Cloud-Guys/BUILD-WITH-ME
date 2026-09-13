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

module.exports = { getFirebaseAuth, verifyFirebaseToken };

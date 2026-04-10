const admin = require('firebase-admin');

// Load service account from the path defined in .env
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH);

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Verify Firebase ID token
 * @param {string} idToken - The Firebase ID token from client
 * @returns {Promise<admin.auth.DecodedIdToken>}
 */
const verifyFirebaseToken = async (idToken) => {
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    throw new Error('Invalid Firebase token');
  }
};

module.exports = { verifyFirebaseToken };
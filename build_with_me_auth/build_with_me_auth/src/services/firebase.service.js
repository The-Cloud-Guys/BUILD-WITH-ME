const admin = require('firebase-admin');

// Validate Firebase configuration
if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
  throw new Error('Missing Firebase credentials in environment variables');
}

// Build service account
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
};

// Initialize Firebase Admin SDK (singleton)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * Verify Firebase ID token
 * @param {string} idToken - The Firebase ID token from client
 * @returns {Promise<Object>} Decoded token payload (uid, email, name, picture, etc.)
 */
const verifyFirebaseToken = async (idToken) => {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Invalid or missing Firebase token');
  }
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Firebase token verification failed:', error.message);
    throw new Error('Invalid or expired Firebase token');
  }
};

module.exports = { verifyFirebaseToken };
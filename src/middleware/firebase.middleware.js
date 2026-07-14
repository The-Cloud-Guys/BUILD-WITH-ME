const admin = require('firebase-admin');
// Ensure you've set the path to your service account JSON in .env
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_JSON_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken; // Attach user info (e.g., req.user.uid)
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
};
module.exports = { verifyFirebaseToken };
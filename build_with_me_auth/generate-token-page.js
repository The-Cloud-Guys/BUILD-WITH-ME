const fs = require('fs');
const path = require('path');
require('dotenv').config();  // reads .env in the same folder

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const html = `<!DOCTYPE html>
<html>
<head>
    <title>Get Firebase ID Token</title>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
</head>
<body>
    <h2>Firebase Auth – Get ID Token</h2>
    <button id="googleSignIn">Sign in with Google</button>
    <pre id="tokenDisplay" style="background:#f0f0f0; padding:10px; width:90%; overflow:auto;"></pre>
    <script>
        const firebaseConfig = ${JSON.stringify(firebaseConfig, null, 2)};
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        document.getElementById('googleSignIn').onclick = async () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            try {
                const result = await auth.signInWithPopup(provider);
                const idToken = await result.user.getIdToken();
                document.getElementById('tokenDisplay').innerText = idToken;
            } catch (err) {
                document.getElementById('tokenDisplay').innerText = err.message;
            }
        };
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'firebase-token.html'), html);
console.log('✅ firebase-token.html generated from .env');
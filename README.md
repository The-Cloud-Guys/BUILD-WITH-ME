# Build With Me – Authentication Backend

A production‑ready authentication system for the **Build With Me** platform.  
Built with Node.js, Express, MongoDB, JWT, bcrypt, Nodemailer, and Firebase Admin SDK.  
Supports **local email/password** registration/login and **Google Sign‑In** via Firebase.

---

## 🚀 Features

- User registration & login (email/password)
- JWT‑based session management
- Password reset with email (Nodemailer)
- Google OAuth 2.0 (Firebase) – unified with local accounts
- Protected routes (JWT middleware)
- Request validation (Joi)
- MongoDB with Mongoose ODM
- Environment configuration (`.env`)
- Ready for production deployment

---

## 🧰 Tech Stack

| Area          | Technology                               |
|---------------|------------------------------------------|
| Runtime       | Node.js                                  |
| Framework     | Express.js                               |
| Database      | MongoDB + Mongoose ODM                   |
| Authentication| JWT, bcrypt (local) + Firebase Admin SDK |
| Validation    | Joi                                      |
| Email         | Nodemailer (SMTP)                        |
| Other         | dotenv, cors, crypto                     |

---

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/The-Cloud-Guys/BUILD-WITH-ME.git
cd BUILD-WITH-ME/build_with_me_auth

# Install dependencies
npm install

# Copy environment variables template
cp .env.example .env   # (create .env manually if no example)

# Start development server
npm run dev
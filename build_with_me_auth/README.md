# Build With Me – Authentication & Project Management System

Version 5.1 – May 2026
Complete backend for the Build With Me platform: auth, onboarding, profile management, role-based project collaboration, and notifications.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Code Structure](#code-structure)
- [Deployment](#deployment)
- [Future Enhancements](#future-enhancements)

---

## Overview

Build With Me connects developers, designers, and tech professionals on collaborative projects.
This backend handles:

- Secure email/password registration with OTP verification and Google Sign-In (Firebase)
- Step-by-step onboarding: role → skills → profile completion
- Profile management with private avatar storage (Supabase) and image processing (Sharp)
- Role-based project creation – each role tracks required headcount and manages capacity automatically
- Application system with CV upload, role selection, accept/reject flow, and team management
- Notifications for application status changes, new applicants, project matches, and filled roles

All endpoints return JSON. Errors follow `{ "message": "..." }` with appropriate HTTP status codes.

---

## Features

### Authentication and Account

- Email Registration with OTP – 6-digit numeric OTP sent to email; account created with `emailVerified=false`, `onboardingStep=0`
- Email Verification – Required before login; sets `accessToken` and `refreshToken` cookies on success
- Secure Login – HTTP-only cookies (`accessToken` 15 min, `refreshToken` 7 days) + `accessToken` returned in JSON
- Refresh Token Rotation – New token pair issued on each use; old token revoked
- Logout – Clears cookies, deletes refresh token from database
- Password Reset (3-step) – Request OTP → verify OTP → reset password (auto-login)
- Firebase Google Sign-In – Exchange Firebase ID token for app JWT; returns `token` and `isProfileCompleted`

### Onboarding

- Step 1 – Role selection (single choice from 8 roles)
- Step 2 – Skills selection (multiple, free text)
- Step 3 – Profile completion via `POST /api/profile/userProfile` (firstName, lastName, bio, externalLink, optional photo)
- Responses include `onboardingStatus` (email_verified | role_pending | skills_pending | completed) and `onboardingCompleted` boolean

Note: `POST /api/onboarding/profile` was removed in v5.1. Use `POST /api/profile/userProfile` for step 3.

### Profile Management

- Combined multipart endpoint – Create or update all profile fields and optional photo in one request
- Photo upload – Resized to max 500px, JPEG 80% quality (Sharp); stored in private Supabase `avatars` bucket; signed URL returned (1 hour)
- Photo replacement – Send a new `photo` via `PATCH /userProfile` to replace the existing one

Note: `PATCH /me`, `POST /me/photo`, and `DELETE /me/photo` were removed in v5.1.

### Project Management

- Role-based creation – Each project defines roles with `roleName` and `requiredCount`; `currentCount` is tracked automatically
- Discovery – Paginated list with filters: search, skill, tech, stage, tag
- Apply – Applicant selects a role (must be open), submits message, portfolio link, and optional CV (PDF/DOC, max 10 MB). One application per user per project
- Accept/Reject – Accepting adds applicant to `teamMembers` and increments `currentCount`; rejecting decrements it if previously accepted
- Notifications – Triggered on: project match, application status change, new application, role filled
- Team management – View team by role; owner can remove members

### Notifications

- Stored per user; latest 50 returned sorted newest first
- Types: PROJECT_MATCH, APPLICATION_STATUS, NEW_APPLICATION, ROLE_FILLED
- Mark individual or all notifications as read

---

## Tech Stack

| Layer              | Technology                                                |
|--------------------|-----------------------------------------------------------|
| Runtime            | Node.js (LTS)                                             |
| Framework          | Express.js                                                |
| Database           | MongoDB + Mongoose ODM                                    |
| Local Auth         | JSON Web Tokens (JWT), bcryptjs                           |
| Social Auth        | Firebase Admin SDK (Google Sign-In)                       |
| Email              | Brevo (Sendinblue) API via Axios                          |
| File Storage       | Supabase Storage (private buckets: avatars, resumes)      |
| Image Processing   | Sharp (resize, JPEG conversion)                           |
| Validation         | Joi                                                       |
| Security           | Helmet, express-rate-limit, CORS                          |
| Logging            | Morgan                                                    |
| Environment        | dotenv                                                    |

---

## Installation

```bash
git clone https://github.com/The-Cloud-Guys/BUILD-WITH-ME.git
cd BUILD-WITH-ME/build_with_me_auth
npm install
cp .env.example .env
npm run dev
```

For production:

```bash
npm start
```

The server runs on `http://localhost:5050` or the `PORT` defined in your `.env`.

---

## Environment Variables

Create a `.env` file in `build_with_me_auth/` with the following:

```ini
# Server
PORT=5050
NODE_ENV=development

# MongoDB
MONGODB_URI=mongodb://localhost:27017/build_with_me

# JWT
JWT_SECRET=your_super_secret_access_key
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your_super_secret_refresh_key
JWT_REFRESH_EXPIRES_IN=7d

# Frontend URL
FRONTEND_URL=http://localhost:3000

# Brevo Email API
BREVO_API_KEY=your_brevo_api_key
EMAIL_FROM=verified_sender@yourdomain.com

# Firebase Admin SDK
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvg...\n-----END PRIVATE KEY-----\n"

# Supabase Storage
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_BUCKET_AVATAR=avatars
SUPABASE_BUCKET_RESUMES=resumes
```

Important:
- `JWT_SECRET` and `JWT_REFRESH_SECRET` must be different values
- Copy `FIREBASE_PRIVATE_KEY` exactly from your service account JSON, including the `\n` characters
- Both Supabase buckets (avatars, resumes) must be set to private
- `EMAIL_FROM` must be a verified sender in Brevo under Settings → Senders
- Set `NODE_ENV=development` to print OTPs to the console and enable the `/firebase-token` helper route

---

## API Endpoints

All endpoints return JSON. Authentication uses HTTP-only cookies (`accessToken`, `refreshToken`).
Protected routes require a valid `accessToken` cookie. The `accessToken` is also returned in the JSON body for client-side use.

### Authentication (/api/auth)

| Method | Endpoint               | Auth | Description                                                      |
|--------|------------------------|------|------------------------------------------------------------------|
| POST   | /register              | –    | Register with email and password; sends 6-digit OTP             |
| POST   | /verify-email          | –    | Verify OTP; sets cookies and returns accessToken                 |
| POST   | /resend-verification   | –    | Resend OTP to unverified email                                   |
| POST   | /login                 | –    | Login; sets cookies and returns accessToken                      |
| GET    | /me                    | yes  | Get current authenticated user                                   |
| POST   | /refresh-token         | –    | Rotate refresh token; issues new cookies and returns accessToken |
| POST   | /logout                | yes  | Clear cookies and revoke refresh token                           |
| POST   | /forgot-password       | –    | Send OTP for password reset (step 1 of 3)                        |
| POST   | /verify-reset-otp      | –    | Verify reset OTP; returns short-lived reset token (step 2 of 3)  |
| POST   | /reset-password        | –    | Reset password; auto-login, returns accessToken (step 3 of 3)    |
| POST   | /firebase              | –    | Exchange Firebase ID token for app JWT cookies                   |

### Onboarding (/api/onboarding)

All endpoints require a valid `accessToken` cookie. Steps must be completed in order.

| Method | Endpoint  | Description                                        |
|--------|-----------|----------------------------------------------------|
| GET    | /status   | Get current onboarding step and onboardingStatus   |
| POST   | /role     | Set role (step 0 to 1)                             |
| POST   | /skills   | Set skills array (step 1 to 2)                     |

Step 3 (profile completion) is handled by `POST /api/profile/userProfile`.

### Profile Management (/api/profile)

All routes require a valid `accessToken` cookie.

| Method | Endpoint       | Description                                                          |
|--------|----------------|----------------------------------------------------------------------|
| GET    | /me            | Get full profile; profilePhoto returned as a signed URL (1 hour)     |
| POST   | /userProfile   | Combined: create profile and optional photo (multipart). Completes onboarding |
| PATCH  | /userProfile   | Combined: update profile fields and optional photo replacement (multipart) |

Multipart fields – Text: firstName, lastName, bio, externalLink. File: photo (optional, jpeg/png/webp, max 2 MB).

### Projects (/api/projects)

GET /, GET /:id, and GET /:id/team are public. All other routes require authentication.

| Method | Endpoint                | Auth | Description                                         |
|--------|-------------------------|------|-----------------------------------------------------|
| POST   | /                       | yes  | Create project (owner = authenticated user)         |
| GET    | /                       | –    | List projects (paginated, filterable)               |
| GET    | /:id                    | –    | Get single project                                  |
| PUT    | /:id                    | yes  | Update project (owner only)                         |
| DELETE | /:id                    | yes  | Delete project and all applications (owner only)    |
| POST   | /:id/apply              | yes  | Apply to a project role (multipart)                 |
| GET    | /:id/applications       | yes  | List all applications (owner only)                  |
| GET    | /:id/team               | –    | Get team (owner and accepted members)               |
| DELETE | /:id/team/:userId       | yes  | Remove a team member (owner only)                   |
| PUT    | /api/applications/:id   | yes  | Accept or reject an application (owner only)        |

Query parameters for GET / (all optional): page, limit, search (title/description), skill, tech, stage (IDEA|PROTOTYPE|MVP), tag.

Apply fields (multipart): message (required), role (required – must match a project roleName), portfolioLink (optional), cv (optional – PDF/DOC/DOCX, max 10 MB).

Apply errors: 400 role not found, 400 role is full, 409 already applied.

When an application is accepted, the applicant is added to teamMembers and the role's currentCount increments by 1. If currentCount reaches requiredCount, a ROLE_FILLED notification is sent to the project owner. Rejecting a previously accepted application removes the applicant and decrements currentCount.

### Notifications (/api/notifications)

All endpoints require a valid `accessToken` cookie.

| Method | Endpoint     | Description                                  |
|--------|--------------|----------------------------------------------|
| GET    | /            | Get latest 50 notifications (newest first)   |
| PATCH  | /:id/read    | Mark a single notification as read           |
| PATCH  | /read-all    | Mark all unread notifications as read        |

Notification types: PROJECT_MATCH, APPLICATION_STATUS, NEW_APPLICATION, ROLE_FILLED.

---

## Code Structure

```
build_with_me_auth/
├── .env
├── .gitignore
├── package.json
├── README.md
├── generate-token-page.js
├── src/
│   ├── index.js                       # Main Express app
│   ├── db.js                          # MongoDB connection
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── onboarding.controller.js
│   │   ├── profile.controller.js
│   │   ├── project.controller.js
│   │   └── notification.controller.js
│   ├── models/
│   │   ├── user.model.js
│   │   ├── project.model.js
│   │   ├── application.model.js
│   │   └── notification.model.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── onboarding.routes.js
│   │   ├── profile.routes.js
│   │   ├── project.routes.js
│   │   └── notification.routes.js
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── rateLimiter.js
│   │   └── upload.middleware.js
│   ├── validation/
│   │   ├── auth.validation.js
│   │   ├── onboarding.validation.js
│   │   └── project.validation.js
│   ├── services/
│   │   ├── firebase.service.js
│   │   ├── supabase.service.js
│   │   └── notification.service.js
│   └── utils/
│       ├── otp.util.js
│       └── onboardingStatus.js
└── firebase-token.html
```

---

## Deployment (Railway)

1. Push the repository to GitHub.
2. In Railway, set Root Directory to `build_with_me_auth`.
3. Add all environment variables in the Railway dashboard.
4. Railway automatically installs dependencies and runs `npm start`.
5. Your API will be live at a Railway-generated URL.

Notes:
- Brevo API uses HTTPS so there are no SMTP port issues.
- Supabase private bucket files are served via backend-generated signed URLs; no public bucket is needed.

---

## Future Enhancements

- GitHub OAuth and Verification – Link GitHub and verify ownership
- Two-Factor Authentication (2FA) – TOTP or SMS
- Predefined Skills Library – Curated list with free-text fallback
- Project Recommendation Engine – Match projects to users by skills
- Real-Time Notifications – WebSocket or Server-Sent Events
- Admin Dashboard – User, project, and report management
- API Versioning – /v1/ prefix for backward-compatible changes
- Comprehensive Logging – Winston or Pino
- Redis Rate Limiting – Distributed rate limiting for scaled deployments
- Profile Photo Optimisation – Multiple sizes (thumbnail, small, medium) via srcset
- Photo Deletion Endpoint – Dedicated DELETE /api/profile/me/photo

---

Documentation version 5.1 – May 2026
Proprietary – for internal use by The Cloud Guys


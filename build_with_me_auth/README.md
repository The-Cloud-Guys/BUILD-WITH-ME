# Build With Me Auth

A complete authentication system using Node.js, Express, MongoDB, JWT, and Joi validation.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a MongoDB database and update `.env` with your connection string.

3. Start the server:
   ```bash
   npm run dev
   ```

## API Endpoints

- `POST /api/auth/register` – Register a new user
- `POST /api/auth/login` – Login and receive a JWT token
- `GET /api/auth/me` – Get current user (protected route)

## Environment Variables

See `.env` file.

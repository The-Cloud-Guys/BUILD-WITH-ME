# Connexd API Reference

Version 6.0 working-copy reference. The source of truth is `src/routes/`; the executable collection is `build_with_me_auth.postman_collection.json`.

## Conventions

- Base URL: `http://localhost:5050` by default.
- Request and response bodies are JSON objects unless `multipart` is stated.
- Protected routes accept the HTTP-only `accessToken` cookie or `Authorization: Bearer <accessToken>`.
- Admin routes require an active admin record; super-admin routes require the `super_admin` role.
- Object identifiers are MongoDB ObjectId strings. Dates are ISO-8601 strings.
- Pagination inputs are integer query strings. List responses are JSON objects containing an array plus pagination metadata unless noted.
- Standard failure response: `{ "message": string }`; validation failures may also contain `errors: object|array`.

## Shared input types

| Type | Shape |
|---|---|
| Credentials | `{ email: string(email), password: string }` |
| ProjectInput | `{ title: string, description: string, requiredSkills?: string[], techStack?: string[], stage?: "IDEA"|"PROTOTYPE"|"MVP", status?: "OPEN"|"IN_PROGRESS"|"COMPLETED"|"CANCELLED", roles: Array<{ roleName: string, requiredCount: integer, description?: string }> }` |
| ProjectPatch | Partial `ProjectInput`; owner-only |
| ApplicationInput | multipart: `role: string`, `message: string`, `portfolioLink?: string(url)`, `cv?: File(PDF|DOC|DOCX|TXT, <=10MB)` |
| ProfileInput | multipart or JSON: `firstName?: string`, `lastName?: string`, `bio?: string`, `externalLink?: string(url)`, `location?: string`, `availability?: string`, `experienceLevel?: string`, `photo?: File(image)` |
| PostInput | multipart: `content: string`, `media?: File[]` (up to 10), optional post metadata accepted by the model |
| MessageInput | `{ content: string, replyTo?: ObjectId }` |

## System and authentication

The Postman journey orders authentication as registration → resend verification → verify email → one-time applicant/admin/owner logins → password recovery → Firebase → current user → cookie refresh → JSON refresh. Onboarding follows immediately afterward. The three login variants share the same endpoint but save separate role tokens required by later authorization scenarios.

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/` | public | none | object: service message |
| GET | `/api/health` | public | none | object: health/status |
| POST | `/api/auth/register` | public/rate-limited | `{ firstName:string, lastName:string, email:string, password:string }` | 201 object: message/user summary |
| POST | `/api/auth/verify-email` | public/rate-limited | `{ email:string, otp:string }` | object: tokens, user; sets cookies |
| POST | `/api/auth/resend-verification` | public/rate-limited | `{ email:string }` | object: message |
| POST | `/api/auth/resend-reset-otp` | public/rate-limited | `{ email:string }` | object: message |
| POST | `/api/auth/login` | public/rate-limited | `Credentials` | object: accessToken, refreshToken, user; sets cookies |
| POST | `/api/auth/refresh-token` | refresh cookie/body | `{ refreshToken?:string }` | object: rotated tokens; sets cookies |
| POST | `/api/auth/logout` | session | none | object: message; clears cookies |
| POST | `/api/auth/forgot-password` | public/rate-limited | `{ email:string }` | object: message |
| POST | `/api/auth/verify-reset-otp` | public/rate-limited | `{ email:string, otp:string }` | object: resetToken |
| POST | `/api/auth/reset-password` | public/rate-limited | `{ resetToken:string, password:string }` | object: tokens/user; sets cookies |
| POST | `/api/auth/firebase` | public/rate-limited | `{ idToken:string }` | object: tokens/user/profile state |
| GET | `/api/auth/me` | user | none | object: user |

## Onboarding and profile

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/api/onboarding/status` | user | none | object: step/status/completion |
| POST | `/api/onboarding/role` | user | `{ role:string }` | object: message, onboarding state |
| POST | `/api/onboarding/skills` | user | `{ skills:string[] }` | object: message, onboarding state |
| POST | `/api/onboarding/profile` | user | `ProfileInput` JSON | object: message, user/profile state |
| GET | `/api/profile/me` | user | none | object: profile/user |
| DELETE | `/api/profile/me/photo` | user | none | object: message |
| POST | `/api/profile/userProfile` | user | multipart `ProfileInput` | object: message, profile/user |
| PATCH | `/api/profile/userProfile` | user | multipart partial `ProfileInput` | object: message, profile/user |

## Projects and applications

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/api/projects` | public | query `page?:integer, limit?:integer, search?:string, stage?:string, status?:string, techStack?:string` | object: `projects:Project[]`, pagination |
| GET | `/api/projects/stats` | public | none | object: project statistics |
| GET | `/api/projects/featured` | public | optional list query | array: `Project[]` |
| GET | `/api/projects/my` | user | optional pagination query | array: owned projects with statistics |
| GET | `/api/projects/recommended` | user | optional pagination query | array: recommended `Project[]` |
| POST | `/api/projects` | user | `ProjectInput` | 201 object: `project:Project` |
| POST | `/api/projects/:id/apply` | user | `ApplicationInput` | 201 object: message, application |
| GET | `/api/projects/:id/applications` | owner | optional pagination/status/role query | object: `applications:Application[]` |
| GET | `/api/projects/:id/applications/filtered` | owner | query filters | object: `applications:Application[]` |
| GET | `/api/projects/:id/team` | public | none | object: owner/team grouped by role |
| DELETE | `/api/projects/:id/team/:userId` | owner | none | object: message, project/team |
| PUT | `/api/projects/:id` | owner | `ProjectPatch` | object: project |
| DELETE | `/api/projects/:id` | owner | none | object: message |
| GET | `/api/projects/:id` | public | none | object: project |
| GET | `/api/applications/me` | user | optional query filters | array: `Application[]` |
| GET | `/api/applications/:id` | user/participant | none | object: application |
| PUT | `/api/applications/:id` | project owner | `{ status:"accepted"|"rejected" }` | object: application, project/team state |

Accepting an application atomically updates the application, project role capacity and team membership, then synchronizes one private `team_room` chat for the project. Its deterministic name is `<project title> Team`; the owner is an admin member and accepted applicants receive their project role. Rejecting an accepted application or removing a member synchronizes the room membership again.

## Chat

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/api/chat/rooms` | user | none | object/array: rooms visible to user |
| GET | `/api/chat/direct/:userId` | user | none | object: existing or newly created direct room |
| POST | `/api/chat/groups` | user | `{ name:string, memberIds:ObjectId[], description?:string }` | 201 object: group room |
| GET | `/api/chat/rooms/:roomId/messages` | room member | query `page?:integer, limit?:integer` | object: messages, pagination |
| POST | `/api/chat/rooms/:roomId/messages` | room member | `MessageInput` | 201 object: message |
| GET | `/api/chat/rooms/:roomId/call` | room member | none | object: authorized call-room data |

## Community

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| POST | `/api/community/posts` | user | multipart `PostInput` | 201 object: post |
| GET | `/api/community/feed` | user | query `page?:integer, limit?:integer` | object: posts, pagination |
| GET | `/api/community/posts/:id` | user | none | object: post |
| PUT | `/api/community/posts/:id` | author | partial post JSON | object: post |
| DELETE | `/api/community/posts/:id` | author/admin | none | object: message |
| POST | `/api/community/like` | user | `{ postId:ObjectId }` | object: liked:boolean/count |
| POST | `/api/community/comments` | user | `{ postId:ObjectId, content:string, parentCommentId?:ObjectId }` | 201 object: comment |
| GET | `/api/community/posts/:postId/comments` | user | optional pagination query | object: comments |
| DELETE | `/api/community/comments/:id` | author/admin | none | object: message |
| POST | `/api/community/save/:postId` | user | none | object: saved:boolean |
| GET | `/api/community/saved` | user | optional pagination query | array: saved posts |
| POST | `/api/community/follow/:userId` | user | none | object: following:boolean |
| GET | `/api/community/followers/:userId` | user | optional pagination query | array: follower users |
| GET | `/api/community/following/:userId` | user | optional pagination query | array: followed users |
| POST | `/api/community/mute/:postId` | user | none | object: muted:boolean |
| POST | `/api/community/report/:postId` | user | `{ reason:string, description?:string }` | object: message/report |
| POST | `/api/community/report/comment/:commentId` | user | `{ reason:string, description?:string }` | object: message/report |
| GET | `/api/community/profile/:userId` | user | none | object: public profile/community counts |

Persisted community media is a stable storage path, not an expiring signed URL. Read responses generate fresh signed URLs.

### Share links

Post, comment, and community-profile responses include a `share` object. No separate copy-link API call is required.

```json
{
  "share": {
    "type": "post | comment | profile | project",
    "resourceId": "string",
    "path": "/share/post/:postId",
    "url": "https://frontend.example/share/post/:postId",
    "title": "string",
    "text": "string",
    "configured": true
  }
}
```

- Post: `/share/post/:postId`
- Comment: `/share/post/:postId?comment=:commentId`
- Profile: `/share/profile/:userId`
- Project: `/share/project/:projectId`
- Compatibility resolver: `/share/comment/:commentId` normalizes to the parent post representation.
- `url` is `null` and `configured` is `false` when `FRONTEND_URL` is absent or invalid; `path` remains available.
- The frontend must register the corresponding `/share/...` routes. After authentication, preserve the complete requested path and query string, fetch the existing API resource, and scroll to or highlight the requested comment when `comment` is present.
- Use `navigator.share({ title, text, url })` where supported and `navigator.clipboard.writeText(url)` for copy-link behavior and as the fallback.

The backend publicly resolves `GET /share/:resourceType/:resourceId` before the final API 404 handler. It returns a privacy-safe HTML fallback for browsers and social crawlers, never the protected API payload. Supported resource types are `post`, `comment`, `profile`, and `project`. Invalid identifiers return an HTML `400`; missing, hidden, suspended, or unavailable resources return an HTML `404`. Verified Android App Links or iOS Universal Links may intercept the same HTTPS path before the browser reaches this fallback.

For `GET /api/projects/:id/applications`, `projectDetails.teamMembers[].profilePhoto` follows the established avatar response convention: a signed HTTPS URL when signing succeeds, an existing HTTPS URL unchanged, or `null` when no photo exists or signing fails. The stored Supabase path is not returned.

## Notifications

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/api/notifications` | user | query `page?:integer, limit?:integer, category?:"projects"|"applications"|"system"` | object: notifications, unread count, pagination |
| PATCH | `/api/notifications/:id/read` | owner | none | object: notification |
| PATCH | `/api/notifications/read-all` | user | none | object: message/count |
| PATCH | `/api/notifications/:id/dismiss` | owner | none | object: notification/message |

## Administration

All routes below use `/api/admin` and require admin authentication; those marked super-admin require the stronger role.

| Method | Endpoint | Access | Input | Success response |
|---|---|---|---|---|
| GET | `/dashboard` | admin | query `timeRange?:string` | object: totals, trends and chart series |
| GET | `/users` | admin | pagination/search/filter query | object: users, pagination |
| GET | `/users/:userId` | admin | none | object: user details |
| GET | `/projects` | admin | pagination/search/filter query | object: projects, pagination |
| GET | `/reports` | admin | pagination/status/type query | object: reports, pagination |
| PUT | `/reports/:reportId` | admin | `{ status:string, resolution?:string }` | object: report/message |
| GET | `/activities` | admin | pagination/type query | object: activities, pagination |
| GET | `/admins` | super-admin | none | object/array: admins |
| POST | `/admins` | super-admin | `{ userId:ObjectId, role?:"admin"|"super_admin", permissions?:string[] }` | 201 object: admin |
| DELETE | `/admins/:userId` | super-admin | none | object: message |
| GET | `/actions` | admin | pagination/action query | object: audit actions, pagination |
| POST | `/action` | admin | `{ action:string, targetType:string, targetId:ObjectId, reason?:string, duration?:number }` | object: action result |
| GET | `/permissions` | admin | none | object: permission presets |

## Socket events

Socket.IO uses the same access token during the handshake. Membership is checked before joining a room or sending room-scoped events. Client events include room join/leave, message send, typing and call signaling; server events acknowledge or broadcast only to authorized room members.

## Verification and migrations

```powershell
npm test
npm run test:syntax
node scripts/audit-postman-coverage.js
node scripts/verify-mongodb-transactions.js
node scripts/migrate-community-media-paths.js
node scripts/migrate-community-media-paths.js --apply
```

The database scripts require `MONGODB_URI` already present in the process environment and deliberately do not load `.env`. The media migration is dry-run by default and additionally requires `SUPABASE_BUCKET_COMMUNITY`; it reports counts without printing signed URLs or tokens.

## Route changes since commit `be5fdd0`

| Change | Route | Effect |
|---|---|---|
| Added | `GET /api/projects/stats` | Public aggregate project statistics. |
| Added | `GET /api/projects/:id/applications/filtered` | Owner application listing using the same validated filter implementation as the canonical list route. |
| Added | `GET /api/applications/me` | Current user's applications. |
| Added | `GET /api/applications/:id` | Authorized application detail. |
| Relocated | `PUT /api/projects/applications/:id` -> `PUT /api/applications/:id` | Removes route ambiguity with `/:id`; keeps application state changes in the application router. |
| Relocated | `GET /api/projects/applications/:id` -> `GET /api/applications/:id` | Same separation for application detail. |
| Added | `PATCH /api/notifications/:id/dismiss` | Soft-dismisses a notification; replaces the obsolete DELETE request formerly present only in Postman. |
| Added | Admin user/project detail/list routes | Canonical `admin.controller.js` now serves users and projects without the removed duplicate dashboard controller. |
| Changed | `GET|POST|DELETE /api/admin/admins...` | Super-admin middleware is now required for admin-account management. |
| Changed | Auth verification/resend/Firebase routes | Rate limiting now covers sensitive verification and token-exchange operations. |
| Changed | `GET /api/auth/me` | Removed cookie-logging middleware; authentication behavior is otherwise unchanged. |
| Changed | `POST /api/chat/rooms/:roomId/messages` | Removed inactive multipart middleware; request is JSON `MessageInput`. |
| Changed | Project route protection | Protection is declared per route so public detail/team/stat routes remain reachable and static paths are registered before `/:id`. |

The working copy also keeps previously active focused profile routes and `POST /api/onboarding/profile`; the older README incorrectly described them as removed.

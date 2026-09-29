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
| PostInput | multipart form-data. Common: `postType: "text"|"code"|"link"|"poll"|"photo"`, `content?: string`, `tags?: string[]` (send arrays as JSON text in multipart). Code: `codeLanguage`, `codeSnippet`. Link: `linkUrl`, `linkTitle?`, `linkDescription?`, `linkPreviewImage?`. Poll: `pollQuestion`, `pollOptions` (2–10 strings), `pollDurationHours` (1–720). Photo/media: `media` file field, at most 10 files, 10 MB per file. |
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
| GET | `/api/applications/me` | user | none | array: applications with status, applied `role`, project/owner details, and `acceptedTeamMembers:User[]` when accepted |
| GET | `/api/applications/:id` | user/participant | none | object: application |
| PUT | `/api/applications/:id` | project owner | `{ status:"accepted"|"rejected" }` | object: application, project/team state |

Accepting an application atomically updates the application, project role capacity and team membership, then synchronizes one private `team_room` chat for the project. Its deterministic name is `<project title> Team`; the owner is an admin member and accepted applicants receive their project role. Rejecting an accepted application or removing a member synchronizes the room membership again.

`GET /api/applications/me` is the current-user application-history endpoint. Every entry retains its top-level `status` (`PENDING`, `ACCEPTED`, or `REJECTED`) and applied project `role`. `project.owner.role` is the owner's onboarding role. `acceptedTeamMembers` is empty until the application is accepted; once accepted, it contains the other accepted members, and each member's `role` is taken from that member's accepted project application rather than their onboarding role.

## Chat

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| GET | `/api/chat/rooms` | user | none | object/array: rooms visible to user |
| GET | `/api/chat/direct/:userId` | user | none | object: existing or newly created direct room |
| POST | `/api/chat/groups` | user | `{ name:string, memberIds:ObjectId[], description?:string }` | 201 object: group room |
| GET | `/api/chat/rooms/:roomId/messages` | room member | query `page?:integer, limit?:integer` | object: messages, pagination |
| POST | `/api/chat/rooms/:roomId/messages` | room member | `MessageInput` | 201 object: message |
| GET | `/api/chat/rooms/:roomId/call` | room member | none | object: authorized call-room data |
| POST | `/api/chat/rooms/:roomId/calls` | room member | `{ callType:"audio"|"video" }` | 201 object: persistent ringing call; emits socket and FCM events |
| GET | `/api/chat/calls/:callId` | call participant | none | object: current call lifecycle state |
| POST | `/api/chat/calls/:callId/accept` | recipient | none | object: atomically accepted call |
| POST | `/api/chat/calls/:callId/decline` | recipient | none | object: recipient response/current call |
| POST | `/api/chat/calls/:callId/cancel` | caller | none | object: cancelled ringing call |
| POST | `/api/chat/calls/:callId/end` | call participant | none | object: ended accepted call |

Call statuses are `ringing`, `accepted`, `declined`, `missed`, `cancelled`, and `ended`. Ringing invitations expire after 60 seconds. In group rooms, each recipient has an independent `recipientResponses` entry; the first valid acceptance wins. Use these REST endpoints to establish authoritative call state, then use Socket.IO `signal` events for WebRTC negotiation.

## Community

| Method | Endpoint | Auth | Input | Success response |
|---|---|---|---|---|
| POST | `/api/community/posts` | user | multipart `PostInput` | 201 object: post |
| POST | `/api/community/posts/:postId/poll/vote` | user | `{ optionId:ObjectId }` | object: current poll counts and the caller's selected option |
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
| POST | `/api/community/report/:postId` | user | `ReportInput` | 201 object: message/report category and optional project |
| POST | `/api/community/report/comment/:commentId` | user | `ReportInput` | 201 object: message/report category and optional project |
| POST | `/api/community/report/project/:projectId` | user | `ReportInput` without `projectId` | 201 object: project report |
| GET | `/api/community/profile/:userId` | user | none | object: public profile/community counts |

Persisted community media is a stable storage path, not an expiring signed URL. Read responses generate fresh signed URLs.

`ReportInput` is `{ offenseType, reason, description?, projectId? }`. `offenseType` is one of `spam`, `harassment`, `hate_speech`, `inappropriate_content`, `misinformation`, `intellectual_property`, `scam`, `violence`, `privacy`, or `other`. For a post or comment report, `projectId` optionally identifies the project concerned; the project-report route derives it from the URL.

### Create-post multipart examples

All post types use the same `POST /api/community/posts` multipart endpoint. Do not manually set the `Content-Type` header; the client must include the generated multipart boundary.

```text
# Code post
postType=code
content=Optional caption
codeLanguage=JavaScript
codeSnippet=const connected = true;
tags=["javascript","backend"]

# Link post
postType=link
content=Optional caption
linkUrl=https://example.com/article
linkTitle=Article title
linkDescription=Preview description
linkPreviewImage=https://example.com/preview.jpg

# Poll post
postType=poll
content=Optional caption
pollQuestion=Which feature should we build next?
pollOptions=["Chat","Analytics","Code review"]
pollDurationHours=24

# Photo post
postType=photo
content=Optional caption
media=<binary file>       # repeat the `media` key for each file
```

The created/read post contains the matching nested `code`, `link`, or `poll` object. Poll responses include option `voteCount`, `totalVotes`, `expiresAt`, `isExpired`, `hasVoted`, and `selectedOptionId`. One vote per user is enforced by a unique database index and an atomic transaction. Counts are current in the vote response and subsequent GET responses; no push/WebSocket poll-count event is emitted.

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
| POST | `/api/notifications/devices` | user | `{ token:string, platform:"android"|"ios"|"web", deviceId:string, appVersion?:string }` | 201 object: registered installation without exposing its token |
| DELETE | `/api/notifications/devices/:deviceId` | owner | none | object: device deactivated |
| GET | `/api/notifications` | user | query `page?:integer, limit?:integer, category?:"projects"|"applications"|"system"` | object: notifications, unread count, pagination |
| PATCH | `/api/notifications/:id/read` | owner | none | object: notification |
| PATCH | `/api/notifications/read-all` | user | none | object: message/count |
| PATCH | `/api/notifications/:id/dismiss` | owner | none | object: notification/message |

Each installation registers its FCM token after login and again whenever Firebase invokes token refresh. Unregister the installation during logout. Invalid or unregistered Firebase tokens are automatically deactivated after a failed multicast send. Chat messages use visible notification-plus-data delivery on the `messages` Android channel. Calls use high-priority data-only FCM so Flutter's background handler can display/dismiss the native `incoming_calls` UI; incoming invitations have a 60-second TTL. Push data includes stable `messageId` or `callId`, `roomId`, event `type`, and deep-link `route`, allowing the client to deduplicate socket and push delivery.

The mobile client must configure Firebase Messaging background handling, `getInitialMessage`, `onMessageOpenedApp`, notification permission, the two Android channels, and a native incoming-call UI. FCM wakes/notifies the app; WebRTC or the selected media provider still carries audio/video. A force-stopped Android app cannot generally be awakened until the user opens it again.

## Administration

Admin identity is Firebase-only. The backend exchanges a recently issued Firebase ID token for an HttpOnly `adminSession` Firebase session cookie. MongoDB `AdminAccount` records remain the authority for activation, roles and permissions. There is no public admin registration or password-login endpoint.

### Admin authentication (`/api/admin/auth`)

| Method | Endpoint | Access | Input | Success response |
|---|---|---|---|---|
| POST | `/bootstrap/firebase` | one-time bootstrap secret | `{ idToken:string, firstName:string, lastName:string }` | 201 object: super-admin; sets `adminSession` |
| POST | `/firebase` | activated admin | `{ idToken:string }` | object: admin; sets `adminSession` |
| POST | `/invitations/verify` | public invitation token | `{ token:string }` | object: validity and safe invitation metadata |
| POST | `/firebase/accept-invitation` | invitation + Firebase | `{ token:string, idToken:string }` | 201 object: activated admin; sets `adminSession` |
| POST | `/logout` | session if available | none | object: message; revokes Firebase sessions and clears cookie |
| GET | `/me` | Firebase admin session | none | object: admin |

### Admin operations (`/api/admin`)

All routes below require the Firebase `adminSession` cookie and their assigned MongoDB permission.

| Method | Endpoint | Access | Input | Success response |
|---|---|---|---|---|
| GET | `/dashboard` | admin | query `timeRange?:string` | object: totals, trends and chart series |
| GET | `/users` | admin | query `page?, limit?, search?, status?:active|pending|suspended|terminated` | object: users with `status`/`pendingReason`, global `counts`, pagination |
| GET | `/users/:userId` | admin | none | object: user details |
| GET | `/projects` | admin | pagination/search/filter query | object: projects, pagination |
| GET | `/reports` | admin | query `page?, limit?, status?, type?, offenseType?` | object: reports with `targetType`, `offenseType`, populated `target`, populated `project`, reporter/reported user, and pagination |
| PUT | `/reports/:reportId` | admin | `{ status:string, resolution?:string }` | object: report/message |
| GET | `/activities` | admin | pagination/type query | object: activities, pagination |
| GET | `/admins` | `manage_admins` | none | object: dedicated admins |
| POST | `/admins/invitations` | `manage_admins` | `{ email:string, firstName:string, lastName:string, role:string, permissions?:string[] }` | 201 object: emailed invitation metadata |
| GET | `/admins/invitations` | `manage_admins` | none | object: invitations |
| DELETE | `/admins/invitations/:inviteId` | `manage_admins` | none | object: message |
| PATCH | `/admins/:adminId` | `manage_admins` | `{ role?:string, permissions?:string[], isActive?:boolean }` | object: admin |
| DELETE | `/admins/:adminId` | `manage_admins` | none | object: deactivation message |
| GET | `/actions` | admin | pagination/action query | object: audit actions, pagination |
| POST | `/action` | admin | `{ action:string, targetType:string, targetId:ObjectId, reason?:string, duration?:number }` | object: action result |
| GET | `/permissions` | admin | none | object: permission presets |

User status is explicit and mutually exclusive: `terminated` means `isActive === false`; `suspended` means the account is active but `isSuspended === true`; `pending` means the account is neither terminated nor suspended but email verification or onboarding step 3 is incomplete; otherwise it is `active`. `pendingReason` is `email_verification_required`, `onboarding_incomplete`, or `null`. Both `/users` and `/dashboard` expose pending counts using this same definition; `/users.counts` also includes active, suspended, terminated, and total counts.

## Socket events

Socket.IO uses the same access token during the handshake. Membership is checked before joining a room or sending room-scoped events. Client events include room join/leave, message send, typing and call signaling; server events acknowledge or broadcast only to authorized room members. Both REST and socket message sends also issue FCM pushes to the other room members. Clients must deduplicate `new-message`/FCM events by `messageId` and call events by `callId`.

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

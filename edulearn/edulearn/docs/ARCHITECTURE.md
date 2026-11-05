# Architecture

## Shape
One codebase, split into route groups that can run together or apart with `SERVICES`:
`identity` (auth, schools, classes), `content`, `assess`, `proctor`, `social`, `admin`, `realtime` (WebSocket hub).
`SERVICES=all` runs everything (default). To split, start several instances with different `SERVICES` values behind a gateway that routes by path prefix (`/api/auth`, `/api/courses`, `/api/assessments`, `/api/proctor`, `/api/social`, `/api/admin`, `/ws`). Each exposes `/healthz`, `/readyz`, `/metrics`.

## Security
- Passwords: scrypt. Sessions: HS256 signed tokens (12 h). Face step-up login uses a short pending token.
- Encryption at rest: AES-256-GCM per field (face templates, proctor snapshots, guardian contact) with `DATA_KEY`. TLS in transit is terminated by nginx or a cloud load balancer. This is not end-to-end encryption between users; the server must read content to grade and moderate it.
- SCORM and uploads are third-party code: served with a sandbox CSP (opaque origin), and SCORM uses a lesson-scoped token that cannot call the main API. Zip entries are checked against path traversal.
- Rate limits, audit log, CSP, no API responses in the service worker cache.

## Privacy
Photos never leave the browser except proctor snapshots, which are encrypted and purged after `PROCTOR_RETENTION_DAYS`. Learners can export and delete their data from Settings. Under-18 users need guardian consent before face enrolment or proctored exams. Leaderboards show first name and initial and can be switched off.

## Scaling path (not implemented)
1. **Database:** SQLite (WAL) handles one node. Move to PostgreSQL by replacing `server/db.js` (all SQL goes through the `q` helper; the schema is plain SQL).
2. **Files:** move `DATA_DIR/uploads` and `scorm` to object storage (S3 compatible) with a CDN.
3. **Realtime:** the WebSocket hub is in memory per process. For more than one node, publish chat events through Redis pub/sub and keep sockets sticky at the load balancer.
4. **Stateless app nodes:** tokens are signed, so nodes only need the same `JWT_SECRET` and `DATA_KEY`.
5. **Multi-region:** put app nodes and a read replica in each region, route learners to the nearest, keep writes in the primary region, serve static files and models from a CDN. Biometric data may have residency limits: check before replicating it.
6. **Load testing** (k6 or similar) is required before any claim about capacity.

## Adaptive engine
Each learner has a rating per topic; each question has a difficulty. After an answer the rating moves like Elo. The next question is the unanswered one whose difficulty is closest to the learner's rating plus a small stretch.

## Proctoring flow
Pre-check (consent, face match against the enrolled template, hands, room pan) issues a short-lived token. During the exam the browser posts events and periodic descriptors; the server recomputes identity mismatch itself, weighs events into a risk score (review at 25, flagged at 60), and keeps the proctor heartbeat separate so a killed camera cannot be hidden. Teachers review and clear or confirm; learners can appeal.

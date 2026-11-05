# EduLearn: educational content and adaptive learning platform

A full-stack web app (Node 22, Express, SQLite, WebSocket, vanilla ES-module front end, no build step) for learners from Pre-Nursery to A-Level, plus vocational, language and regional-curriculum courses.

## Run it
```bash
npm install
SEED_DEMO=1 npm run seed      # demo users and courses (skip in production)
npm start                     # http://localhost:3000
npm test                      # 15 API tests
```
Demo logins (password `Demo1234`): `student@`, `adult@`, `kid@`, `teacher@`, `creator@`, `moderator@`, `admin@edulearn.demo`. Class code `DEMO23`.
Requires Node 22 or newer (uses the built-in `node:sqlite`).

## What is in it
| Area | What it does |
|---|---|
| Onboarding | Email/password, optional on-device face enrolment (face-api.js; only a 128-number template reaches the server, encrypted), head-turn liveness, optional ID-photo match, guardian consent for under-18s, educators pick or create a school and generate class codes |
| Content | Courses by grade and subject; text, video, PDF, SCORM 1.2/2004, 3D/AR (model-viewer) and VR (A-Frame) lessons; creator studio with moderator review |
| Assessment | Practice, adaptive, test and exam; MCQ, multi-select (partial credit), true/false, short answer; auto-grading; compulsory tests enforced server-side; deadlines auto-submit |
| Adaptive engine | Per-topic mastery ratings (Elo style); next question chosen by difficulty gap |
| AI feedback | Study Buddy chat after a result. Uses Claude if `ANTHROPIC_API_KEY` is set, otherwise a rule-based tutor. Never reveals hidden answers. Detects distress and alerts staff |
| Proctoring | Pre-exam check (face, hands, surroundings with motion and object detection), then continuous monitoring (second face, identity mismatch, objects, tab leaving). The system flags; a teacher reviews every flag; learners can appeal; snapshots deleted after 30 days |
| Gamification | XP, levels, daily streaks, 15 badges, leaderboards (opt-out) |
| Community | Class chat rooms (WebSocket), forums, moderation (profanity, personal-info blocking for minors, reports, mutes), under-13s limited to class rooms |
| Platform | Accessibility settings, dark theme, en/fr/rw/sw interface, installable PWA, audit log, rate limiting, CSP, health and metrics endpoints |

## Deploy
See `.env.example`, `Dockerfile` and `deploy/` (docker compose and nginx). Read `docs/ARCHITECTURE.md` before relying on it at scale.

## What you must know before real use
- **Scale is designed for, not proven.** The code runs as one process on SQLite. Multi-region, millions of concurrent users and a managed database are an architecture path (documented), not something tested here.
- **Object detection** (phones, books in the room scan) needs the COCO-SSD model. Set `COCO_MODEL_URL` to a copy you host; otherwise the room scan runs in motion-only mode and says so.
- **Face recognition is probabilistic.** It will have false matches and false rejects, worse for some lighting and skin tones. That is why it flags for human review and never fails a learner automatically.
- **Children and biometrics.** Face data of minors needs a lawful basis and guardian consent. Rwanda's data-protection law (Law No. 058/2021) and your school's policies apply. Have them reviewed before launch.
- **Camera proctoring is deterrence, not proof.** A determined cheater can use a second device out of frame.

'use strict';
const { q } = require('./db');
const C = require('./crypto');
const G = require('./gamification');
const { HttpError, json } = require('./util');

const ageOf = u => (u.birth_year ? new Date().getFullYear() - u.birth_year : null);

function publicUser(u) {
  const age = ageOf(u);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role,
    school: u.school_id ? q.get('SELECT id,name,verified FROM schools WHERE id=?', u.school_id) || null : null,
    grade_level: u.grade_level, age, minor: age !== null && age < 18,
    face_enrolled: !!u.face_enc, identity_verified: !!u.identity_verified, face_login: !!u.face_login,
    consent_biometric: !!u.consent_biometric, guardian_consent: !!u.guardian_consent,
    xp: u.xp, level: G.levelFor(u.xp), streak: u.streak, lang: u.lang, settings: json(u.settings, {}),
    show_on_leaderboard: !!u.show_on_leaderboard, created_at: u.created_at,
  };
}

function authenticate(opts = {}) {
  return (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const p = h.startsWith('Bearer ') ? C.verify(h.slice(7)) : null;
      if (!p || p.typ !== 'session') throw new HttpError(401, 'Please sign in', 'unauthenticated');
      if (p.pend && !opts.partial) throw new HttpError(403, 'Face verification is required to finish signing in', 'face_verification_required');
      const u = q.get('SELECT * FROM users WHERE id=?', p.uid);
      if (!u) throw new HttpError(401, 'Please sign in again', 'unauthenticated');
      if (u.status !== 'active') throw new HttpError(403, 'This account is suspended. Contact your school administrator.', 'suspended');
      req.user = u; req.token = p;
      next();
    } catch (e) { next(e); }
  };
}
const auth = authenticate();
const authPartial = authenticate({ partial: true });
const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'You do not have access to this', 'forbidden'));
const isStaff = u => ['admin', 'moderator'].includes(u.role);

const issueSession = (u, extra = {}) => C.sign({ typ: 'session', uid: u.id, role: u.role, ...extra }, extra.pend ? 10 * 60e3 : undefined);

module.exports = { ageOf, publicUser, auth, authPartial, requireRole, isStaff, issueSession };

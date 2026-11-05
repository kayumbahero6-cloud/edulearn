'use strict';
const { q } = require('./db');
const cfg = require('./config');
const { notify } = require('./util');

const levelFor = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 40)) + 1;      // level n starts at 40*(n-1)^2 XP
const xpForLevel = n => 40 * (n - 1) ** 2;
const dayStr = (offsetDays = 0) => new Date(Date.now() + cfg.TZ_OFFSET_HOURS * 3600e3 + offsetDays * 86400e3).toISOString().slice(0, 10);

function awardXp(userId, amount, reason) {
  amount = Math.round(amount);
  if (!amount) return;
  q.run('UPDATE users SET xp = xp + ? WHERE id = ?', amount, userId);
  q.run('INSERT INTO xp_log(user_id,amount,reason,created_at) VALUES(?,?,?,?)', userId, amount, reason || '', Date.now());
}

// Call whenever a learner does something meaningful. Maintains the daily streak.
function touch(userId) {
  const u = q.get('SELECT last_active_day, streak, best_streak FROM users WHERE id=?', userId);
  if (!u) return;
  const today = dayStr();
  if (u.last_active_day === today) return;
  const streak = u.last_active_day === dayStr(-1) ? u.streak + 1 : 1;
  q.run('UPDATE users SET last_active_day=?, streak=?, best_streak=MAX(best_streak,?) WHERE id=?', today, streak, streak, userId);
  if (streak > 1) awardXp(userId, Math.min(5 * streak, 25), `${streak}-day streak`);
}

const BADGES = [
  { key: 'first-lesson', name: 'First Steps', icon: '🌱', desc: 'Complete your first lesson', test: s => s.lessons >= 1 },
  { key: 'ten-lessons', name: 'Curious Mind', icon: '📚', desc: 'Complete 10 lessons', test: s => s.lessons >= 10 },
  { key: 'fifty-lessons', name: 'Knowledge Seeker', icon: '🧭', desc: 'Complete 50 lessons', test: s => s.lessons >= 50 },
  { key: 'course-done', name: 'Course Complete', icon: '🎓', desc: 'Finish every lesson in a course', test: s => s.courses >= 1 },
  { key: 'three-courses', name: 'Explorer', icon: '🗺️', desc: 'Finish 3 courses', test: s => s.courses >= 3 },
  { key: 'first-quiz', name: 'Quiz Starter', icon: '✏️', desc: 'Submit your first assessment', test: s => s.attempts >= 1 },
  { key: 'perfect', name: 'Perfect Score', icon: '💯', desc: 'Score 100% on an assessment', test: s => s.perfect >= 1 },
  { key: 'test-ace', name: 'Test Ace', icon: '🏅', desc: 'Pass 5 tests or exams', test: s => s.passed >= 5 },
  { key: 'streak-3', name: 'On a Roll', icon: '🔥', desc: 'Learn 3 days in a row', test: s => s.best_streak >= 3 },
  { key: 'streak-7', name: 'Week Warrior', icon: '⚡', desc: 'Learn 7 days in a row', test: s => s.best_streak >= 7 },
  { key: 'streak-30', name: 'Unstoppable', icon: '🚀', desc: 'Learn 30 days in a row', test: s => s.best_streak >= 30 },
  { key: 'xp-500', name: 'Rising Star', icon: '⭐', desc: 'Earn 500 XP', test: s => s.xp >= 500 },
  { key: 'xp-2000', name: 'Scholar', icon: '🌟', desc: 'Earn 2,000 XP', test: s => s.xp >= 2000 },
  { key: 'helper', name: 'Helpful Peer', icon: '🤝', desc: 'Write 10 forum replies or chat messages', test: s => s.posts >= 10 },
  { key: 'verified', name: 'Verified Learner', icon: '✅', desc: 'Complete face-based identity verification', test: s => s.verified >= 1 },
];

function stats(userId) {
  const one = (sql, ...p) => q.get(sql, ...p).c;
  const u = q.get('SELECT xp, best_streak, face_enc FROM users WHERE id=?', userId);
  return {
    xp: u.xp, best_streak: u.best_streak, verified: u.face_enc ? 1 : 0,
    lessons: one('SELECT COUNT(*) c FROM progress WHERE user_id=? AND completed=1', userId),
    courses: one(`SELECT COUNT(*) c FROM (SELECT l.course_id, COUNT(*) total, SUM(CASE WHEN p.completed=1 THEN 1 ELSE 0 END) done
                  FROM lessons l LEFT JOIN progress p ON p.lesson_id=l.id AND p.user_id=? GROUP BY l.course_id) WHERE total>0 AND total=done`, userId),
    attempts: one(`SELECT COUNT(*) c FROM attempts WHERE user_id=? AND status='submitted'`, userId),
    perfect: one(`SELECT COUNT(*) c FROM attempts WHERE user_id=? AND status='submitted' AND max_score>0 AND score>=max_score`, userId),
    passed: one(`SELECT COUNT(*) c FROM attempts a JOIN assessments s ON s.id=a.assessment_id WHERE a.user_id=? AND a.passed=1 AND s.kind IN ('test','exam')`, userId),
    posts: one(`SELECT (SELECT COUNT(*) FROM posts WHERE author_id=? AND deleted=0) + (SELECT COUNT(*) FROM chat_messages WHERE user_id=? AND deleted=0) c`, userId, userId),
  };
}

function checkBadges(userId) {
  const s = stats(userId);
  const have = new Set(q.all('SELECT badge FROM user_badges WHERE user_id=?', userId).map(r => r.badge));
  const fresh = [];
  for (const b of BADGES) {
    if (!have.has(b.key) && b.test(s)) {
      q.run('INSERT OR IGNORE INTO user_badges(user_id,badge,earned_at) VALUES(?,?,?)', userId, b.key, Date.now());
      notify(userId, `New badge: ${b.name} ${b.icon}`, b.desc, '#/profile');
      fresh.push({ key: b.key, name: b.name, icon: b.icon });
    }
  }
  return fresh;
}

const publicBadges = () => BADGES.map(({ test, ...b }) => b);

module.exports = { levelFor, xpForLevel, awardXp, touch, checkBadges, publicBadges, BADGES, dayStr };

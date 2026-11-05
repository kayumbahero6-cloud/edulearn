'use strict';
// Demo data so the platform is explorable on first launch. Disabled in production unless SEED_DEMO=1.
// All demo accounts use the password  Demo1234
const { q, tx } = require('./db');
const C = require('./crypto');
const G = require('./gamification');

const PASSWORD = 'Demo1234';

function run() {
  const now = Date.now();
  const hash = C.hashPasswordSync(PASSWORD);
  const user = (email, name, role, extra = {}) => q.run(
    `INSERT INTO users(email,name,role,password_hash,school_id,grade_level,birth_year,guardian_contact_enc,guardian_consent,consent_biometric,consent_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    email, name, role, hash, extra.school || null, extra.grade || null, extra.birth || null,
    extra.guardian ? C.encrypt(extra.guardian) : null, extra.guardianOk ? 1 : 0, extra.consent ? 1 : 0, extra.consent ? now : null, now).id;

  tx(() => {
    const school = q.run('INSERT INTO schools(name,country,district,type,verified,created_at) VALUES(?,?,?,?,1,?)', 'Green Hills Academy (Demo)', 'Rwanda', 'Gasabo', 'school', now).id;
    q.run('INSERT INTO schools(name,country,district,type,verified,created_at) VALUES(?,?,?,?,1,?)', 'Lycée de Kigali (Demo)', 'Rwanda', 'Nyarugenge', 'school', now);
    q.run('INSERT INTO schools(name,country,district,type,verified,created_at) VALUES(?,?,?,?,0,?)', 'IPRC Kigali (Demo TVET)', 'Rwanda', 'Kicukiro', 'training-centre', now);

    const admin = user('admin@edulearn.demo', 'Alice Admin', 'admin');
    user('moderator@edulearn.demo', 'Moses Moderator', 'moderator');
    const teacher = user('teacher@edulearn.demo', 'Grace Uwase', 'educator', { school });
    const creator = user('creator@edulearn.demo', 'Chris Creator', 'creator');
    const y = new Date().getFullYear();
    const s1 = user('student@edulearn.demo', 'Jean Mugisha', 'student', { school, grade: 's3', birth: y - 14, guardian: 'parent@example.com', guardianOk: 1, consent: 1 });
    const s2 = user('adult@edulearn.demo', 'Diane Ingabire', 'student', { school, grade: 'a-level', birth: y - 20, consent: 1 });
    const s3 = user('kid@edulearn.demo', 'Eric Niyonzima', 'student', { school, grade: 'p4', birth: y - 9, guardian: 'mum@example.com' });
    q.run('UPDATE users SET xp=420, streak=3, best_streak=3, last_active_day=? WHERE id=?', G.dayStr(), s1);
    q.run('UPDATE users SET xp=980, streak=5, best_streak=9, last_active_day=? WHERE id=?', G.dayStr(), s2);
    q.run('UPDATE users SET xp=120 WHERE id=?', s3);

    const cl = q.run('INSERT INTO classrooms(school_id,teacher_id,name,grade,subject,code,created_at) VALUES(?,?,?,?,?,?,?)', school, teacher, 'S3 Science A', 's3', 'Science', 'DEMO23', now).id;
    for (const s of [s1, s2, s3]) q.run('INSERT INTO enrollments(classroom_id,student_id,joined_at) VALUES(?,?,?)', cl, s, now);

    const course = (owner, d) => q.run(
      `INSERT INTO courses(creator_id,title,summary,description,grade_level,track,subject,curriculum,language,cover_color,status,created_at,updated_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?, 'published', ?,?,?)`,
      owner, d.title, d.summary, d.description || d.summary, d.grade, d.track || 'academic', d.subject, d.curriculum || 'Rwanda CBC', d.lang || 'en', d.color || '#0f766e', now, now, now).id;
    const lesson = (cid, pos, title, type, body, extra = {}) => q.run(
      'INSERT INTO lessons(course_id,position,title,type,body,media_url,ar_config,duration_min,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      cid, pos, title, type, body || '', extra.media || '', extra.ar ? JSON.stringify(extra.ar) : null, extra.min || 6, now).id;

    /* ---- Pre-nursery ---- */
    const c0 = course(creator, { title: 'Colours and Shapes', summary: 'Play and learn the colours and the basic shapes.', grade: 'pre-nursery', subject: 'Life Skills', color: '#f59e0b' });
    lesson(c0, 1, 'Red, blue and yellow', 'text', '## Colours around us\n\nLook around the room. What is **red**? What is **blue**? What is **yellow**?\n\n- The apple is red 🍎\n- The sky is blue ☁️\n- The sun is yellow ☀️\n\nPoint to something red!', { min: 3 });
    lesson(c0, 2, 'Circles, squares and triangles', 'text', '## Shapes\n\n- A ball is a **circle** ⚪\n- A window is a **square** ⬜\n- A roof can be a **triangle** 🔺\n\nCan you draw each one in the air with your finger?', { min: 4 });

    /* ---- Primary: maths + Kinyarwanda ---- */
    const c1 = course(teacher, { title: 'Fractions Made Easy', summary: 'Halves, quarters and thirds with pictures and games.', grade: 'p4', subject: 'Mathematics', color: '#2563eb' });
    lesson(c1, 1, 'What is a fraction?', 'text', '## Parts of a whole\n\nA fraction tells us **how many equal parts** we have.\n\nIf a pizza is cut into 4 equal slices and you eat 1 slice, you ate **1/4** (one quarter).\n\n- The top number is the **numerator** (parts we have)\n- The bottom number is the **denominator** (parts in the whole)', { min: 6 });
    lesson(c1, 2, 'Comparing fractions', 'text', '## Which is bigger?\n\nWhen the denominators are the same, compare the numerators: **3/8 > 2/8**.\n\nWhen the numerators are the same, the **smaller denominator** gives the bigger piece: **1/2 > 1/4**.', { min: 7 });
    const c2 = course(creator, { title: 'Kinyarwanda: Amagambo n’Interuro', summary: 'Learn everyday Kinyarwanda words and simple sentences.', grade: 'p2', track: 'language', subject: 'Kinyarwanda', curriculum: 'Rwanda CBC', lang: 'rw', color: '#16a34a' });
    lesson(c2, 1, 'Indamutso (Greetings)', 'text', '## Indamutso\n\n- **Muraho** — Hello\n- **Mwiriwe** — Good afternoon / evening\n- **Murakoze** — Thank you\n- **Murabeho** — Goodbye\n\nSay each greeting out loud three times.', { min: 5 });

    /* ---- Secondary: sciences with AR + VR ---- */
    const c3 = course(teacher, { title: 'The Solar System in 3D', summary: 'Explore planets, orbits and scale — in augmented and virtual reality.', grade: 's3', subject: 'Physics', color: '#7c3aed',
      description: 'Interactive lessons with an AR model viewer and a walk-around VR solar system.' });
    lesson(c3, 1, 'Planets and orbits', 'text', '## Our solar system\n\nThe **Sun** holds eight planets in orbit by gravity. The inner rocky planets are **Mercury, Venus, Earth and Mars**. The outer planets are **Jupiter, Saturn, Uranus and Neptune**.\n\n> Earth takes **365.25 days** to orbit the Sun once — that is one year.\n\n### Remember\n1. Closer planets orbit faster.\n2. Gravity gets weaker with distance.', { min: 8 });
    lesson(c3, 2, 'VR: walk through the solar system', 'vr', 'Look around, then drag to turn. On a phone, tap the VR goggles to use a headset. Planet sizes are not to scale.', { min: 6, ar: { sky: '#050816', ground: '#0b1020', entities: [
      { shape: 'sphere', color: '#fcd34d', position: '0 1.6 -6', scale: '1.6 1.6 1.6', label: 'Sun', animate: 'spin' },
      { shape: 'sphere', color: '#94a3b8', position: '-2.2 1.6 -4', scale: '0.2 0.2 0.2', label: 'Mercury' },
      { shape: 'sphere', color: '#fb923c', position: '-1.2 1.6 -3.2', scale: '0.32 0.32 0.32', label: 'Venus' },
      { shape: 'sphere', color: '#38bdf8', position: '0.4 1.6 -2.6', scale: '0.34 0.34 0.34', label: 'Earth', animate: 'spin' },
      { shape: 'sphere', color: '#ef4444', position: '1.6 1.6 -3', scale: '0.26 0.26 0.26', label: 'Mars' },
      { shape: 'sphere', color: '#d6a35c', position: '3 1.6 -4.2', scale: '0.8 0.8 0.8', label: 'Jupiter', animate: 'spin' },
      { shape: 'torus', color: '#e8d5a3', position: '4.8 1.6 -5.4', scale: '0.7 0.7 0.7', label: 'Saturn (rings)' } ] } });
    lesson(c3, 3, 'AR: an astronaut on your desk', 'ar', 'Rotate the model with your finger. On a supported phone tap the AR button to place it in your room.', { min: 5, ar: {
      model_url: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb', alt: 'A 3D astronaut', auto_rotate: true, ar: true, scale: '1 1 1' } });
    const c4 = course(creator, { title: 'Cells: The Building Blocks of Life', summary: 'Plant and animal cells, organelles and what they do.', grade: 's2', subject: 'Biology', color: '#059669' });
    lesson(c4, 1, 'Inside a cell', 'text', '## Organelles\n\n| Part | Job |\n|---|---|\n| Nucleus | Controls the cell |\n| Mitochondria | Releases energy |\n| Cell membrane | Controls what enters and leaves |\n| Chloroplast (plants) | Makes food by photosynthesis |', { min: 7 });
    lesson(c4, 2, 'Watch: a cell divides', 'video', 'A short video on mitosis. After watching, write two sentences about why cells divide.', { media: 'https://www.youtube-nocookie.com/embed/f-ldPgEfAHI', min: 9 });

    /* ---- A-Level, vocational, regional ---- */
    const c5 = course(teacher, { title: 'Differentiation from First Principles', summary: 'Limits, the derivative and rules for polynomials.', grade: 'a-level', subject: 'Mathematics', curriculum: 'Cambridge (IGCSE / A-Level)', color: '#dc2626' });
    lesson(c5, 1, 'The derivative as a limit', 'text', '## Gradient of a curve\n\nThe derivative of f at x is\n\n`f\'(x) = lim (h→0) [f(x+h) − f(x)] / h`\n\n### Power rule\nIf `f(x) = x^n` then `f\'(x) = n·x^(n−1)`.\n\n**Example:** d/dx (3x^4) = 12x^3', { min: 12 });
    const c6 = course(creator, { title: 'Basic Electrical Installation Safety', summary: 'Tools, protective equipment and safe wiring practice for TVET learners.', grade: 's4', track: 'vocational', subject: 'Electrical Installation', curriculum: 'Rwanda CBC', color: '#ea580c' });
    lesson(c6, 1, 'Personal protective equipment', 'text', '## Before you touch anything\n\n1. **Isolate** the supply and lock it off.\n2. **Test** that the circuit is dead.\n3. Wear insulated gloves, safety boots and eye protection.\n4. Never work alone on live equipment.', { min: 8 });
    const c7 = course(creator, { title: 'Swahili Greetings (Kiswahili)', summary: 'Start speaking Kiswahili for East-African travel and trade.', grade: 's1', track: 'regional', subject: 'Kiswahili', curriculum: 'Tanzania NECTA', lang: 'sw', color: '#0891b2' });
    lesson(c7, 1, 'Salamu', 'text', '## Salamu\n\n- **Jambo / Hujambo** — Hello\n- **Habari yako?** — How are you?\n- **Nzuri** — Fine\n- **Asante** — Thank you', { min: 4 });
    q.run(`INSERT INTO courses(creator_id,title,summary,description,grade_level,track,subject,curriculum,language,cover_color,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?, 'pending', ?,?)`,
      creator, 'Intro to Python (awaiting review)', 'Your first programs.', 'Draft for moderator review demo.', 's5', 'academic', 'ICT / Computer Science', 'Rwanda CBC', 'en', '#4f46e5', now, now);
    lesson(q.get('SELECT id FROM courses ORDER BY id DESC').id, 1, 'Hello, world', 'text', 'Run `print("Hello")`.');

    /* ---- assessments ---- */
    const assess = (cid, owner, d, qs, classroomId = null) => {
      const id = q.run(`INSERT INTO assessments(course_id,classroom_id,creator_id,title,description,kind,compulsory,time_limit_min,proctored,pass_mark,shuffle,max_attempts,show_answers,adaptive_length,published,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
        cid, classroomId, owner, d.title, d.description || '', d.kind, d.compulsory ? 1 : 0, d.time || null, d.proctored ? 1 : 0, d.pass || 50, 1, d.attempts || 0, d.show === undefined ? 1 : d.show, d.len || 8, now).id;
      qs.forEach((x, i) => q.run('INSERT INTO questions(assessment_id,position,type,prompt,options,answer,explanation,topic,difficulty,points) VALUES(?,?,?,?,?,?,?,?,?,?)',
        id, i + 1, x.t, x.p, x.o ? JSON.stringify(x.o) : null, JSON.stringify(x.a), x.e || '', x.topic || 'general', x.d || 3, x.pts || 1));
      return id;
    };
    const mcq = (p, o, a, e, topic, d) => ({ t: 'mcq', p, o, a, e, topic, d });
    const tf = (p, a, e, topic, d) => ({ t: 'truefalse', p, a, e, topic, d });
    const sa = (p, a, e, topic, d) => ({ t: 'short', p, a: Array.isArray(a) ? a : [a], e, topic, d });
    const multi = (p, o, a, e, topic, d) => ({ t: 'multi', p, o, a, e, topic, d });

    assess(c1, teacher, { title: 'Fractions practice quiz', kind: 'practice', description: 'Instant feedback after every question.' }, [
      mcq('What fraction of a pizza is left if 1 of 4 equal slices is eaten?', ['1/4', '3/4', '1/2', '4/1'], 1, 'There are 4 equal parts and you still have 3 of them: 3/4.', 'fractions', 1),
      mcq('Which fraction is the biggest?', ['1/8', '1/4', '1/2', '1/16'], 2, 'With equal numerators, the smaller denominator gives the larger piece.', 'fractions', 2),
      tf('3/8 is greater than 2/8.', true, 'Same denominator, so compare numerators: 3 > 2.', 'fractions', 1),
      sa('What is the top number of a fraction called?', ['numerator'], 'The numerator counts the parts we have.', 'vocabulary', 2),
      sa('What is 1/2 + 1/2?', ['1', 'one', '2/2'], 'Two halves make one whole.', 'fractions', 2),
    ]);
    assess(c3, teacher, { title: 'Solar system adaptive quiz', kind: 'adaptive', len: 6, description: 'Questions get harder or easier to match you.' }, [
      mcq('Which planet is closest to the Sun?', ['Venus', 'Mercury', 'Earth', 'Mars'], 1, 'Mercury is the innermost planet.', 'planets', 1),
      mcq('Which planet is known for its rings?', ['Mars', 'Jupiter', 'Saturn', 'Earth'], 2, 'Saturn’s ring system is the largest and brightest.', 'planets', 1),
      tf('Earth takes about 365 days to orbit the Sun.', true, 'That is one year.', 'orbits', 1),
      mcq('What force keeps planets in orbit?', ['Magnetism', 'Friction', 'Gravity', 'Wind'], 2, 'The Sun’s gravity pulls planets into curved paths.', 'orbits', 2),
      sa('Name the largest planet in our solar system.', ['jupiter'], 'Jupiter is more than 11 times wider than Earth.', 'planets', 2),
      multi('Select all the INNER rocky planets.', ['Mercury', 'Jupiter', 'Earth', 'Neptune', 'Mars'], [0, 2, 4], 'The four rocky planets are Mercury, Venus, Earth and Mars.', 'planets', 3),
      mcq('If a planet is twice as far from the Sun, its gravity pull from the Sun is…', ['Half', 'The same', 'A quarter', 'Double'], 2, 'Gravity follows an inverse-square law: 2² = 4, so one quarter.', 'orbits', 4),
      sa('How many seconds are in 2 minutes?', ['120'], 'Used to practise numerical entry: 2 × 60.', 'orbits', 4),
    ]);
    assess(c3, teacher, { title: 'Science compulsory test', kind: 'test', compulsory: true, time: 15, pass: 50, show: 1, description: 'Compulsory: every question must be answered.' }, [
      mcq('Which is NOT a rocky planet?', ['Mars', 'Venus', 'Saturn', 'Mercury'], 2, 'Saturn is a gas giant.', 'planets', 2),
      tf('Planets closer to the Sun orbit faster.', true, 'They feel stronger gravity and have shorter paths.', 'orbits', 2),
      mcq('How long is one Earth year?', ['30 days', '365 days', '12 days', '100 days'], 1, 'About 365.25 days.', 'orbits', 1),
      multi('Which are gas giants?', ['Jupiter', 'Earth', 'Saturn', 'Mars'], [0, 2], 'Jupiter and Saturn are gas giants.', 'planets', 3),
      sa('What star is at the centre of our solar system?', ['sun', 'the sun'], 'The Sun contains 99.8% of the system’s mass.', 'planets', 1),
    ], cl);
    assess(c3, teacher, { title: 'Term 3 Physics Exam (proctored)', kind: 'exam', compulsory: true, proctored: true, time: 20, pass: 50, show: 0, attempts: 1, description: 'Camera-proctored exam. You will complete a short pre-exam check first.' }, [
      mcq('The unit of force is the…', ['Joule', 'Newton', 'Watt', 'Pascal'], 1, 'Force is measured in newtons (N).', 'mechanics', 1),
      mcq('Speed equals…', ['distance ÷ time', 'time ÷ distance', 'mass × time', 'force × distance'], 0, 'Speed = distance / time.', 'mechanics', 1),
      tf('An object in motion stays in motion unless acted on by a net force.', true, 'Newton’s first law.', 'mechanics', 2),
      sa('A car travels 150 km in 3 hours. What is its average speed in km/h?', ['50'], '150 ÷ 3 = 50.', 'mechanics', 2),
      mcq('Which energy does a stretched spring store?', ['Kinetic', 'Elastic potential', 'Thermal', 'Sound'], 1, 'Stretching stores elastic potential energy.', 'energy', 2),
    ], cl);
    assess(c5, teacher, { title: 'Differentiation drill', kind: 'practice' }, [
      sa('Differentiate 3x^4. Give the coefficient of x^3.', ['12'], 'n·a = 4 × 3 = 12.', 'calculus', 3),
      mcq('d/dx of x^5 is…', ['5x^4', 'x^4', '5x^5', '4x^5'], 0, 'Power rule: n x^(n−1).', 'calculus', 2),
      tf('The derivative of a constant is zero.', true, 'A constant has zero gradient.', 'calculus', 1),
    ]);

    /* ---- community content so the boards are not empty ---- */
    const t1 = q.run('INSERT INTO threads(scope_type,scope_id,author_id,title,body,pinned,created_at,last_post_at) VALUES(?,?,?,?,?,1,?,?)', 'classroom', cl, teacher, 'Welcome to S3 Science A', 'Use this board to ask questions and help each other. Be kind, be curious!', now, now).id;
    q.run('INSERT INTO threads(scope_type,scope_id,author_id,title,body,created_at,last_post_at) VALUES(?,?,?,?,?,?,?)', 'classroom', cl, s2, 'Tips for remembering the order of the planets?', 'Does anyone have a trick for the order of the planets?', now, now);
    q.run('INSERT INTO posts(thread_id,author_id,body,created_at) VALUES(?,?,?,?)', t1, s1, 'Thanks Madam Grace! Looking forward to the VR lesson.', now);
    q.run('INSERT INTO chat_messages(room,user_id,body,created_at) VALUES(?,?,?,?)', 'class:' + cl, teacher, 'Welcome everyone! The Science test opens this week. Ask questions here.', now);
    q.run('INSERT INTO user_badges(user_id,badge,earned_at) VALUES(?,?,?)', s2, 'first-lesson', now);
    q.run('INSERT INTO user_badges(user_id,badge,earned_at) VALUES(?,?,?)', s2, 'streak-3', now);
    q.run('INSERT INTO notifications(user_id,title,body,link,created_at) VALUES(?,?,?,?,?)', s1, 'Welcome to EduLearn 👋', 'Join your class, start a course and earn your first badge.', '#/courses', now);
    q.run('INSERT INTO notifications(user_id,title,body,link,created_at) VALUES(?,?,?,?,?)', admin, 'Course awaiting review', 'Intro to Python (awaiting review)', '#/admin', now);
  });
  console.log('[seed] demo data created. Demo logins (password "' + PASSWORD + '"): student@ / adult@ / kid@ / teacher@ / creator@ / moderator@ / admin@ edulearn.demo');
}

if (require.main === module) {
  const { q: qq } = require('./db');
  if (qq.get('SELECT 1 x FROM users LIMIT 1')) console.log('Database already has users; not seeding.');
  else run();
}
module.exports = { run, PASSWORD };

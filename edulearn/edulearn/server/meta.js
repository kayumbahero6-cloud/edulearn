'use strict';
// Reference data: grade ladder, tracks, curricula, subjects, languages.
const g = (key, label, band) => ({ key, label, band });
const GRADES = [
  g('pre-nursery', 'Pre-Nursery', 'early'),
  g('nursery-1', 'Nursery 1', 'early'), g('nursery-2', 'Nursery 2', 'early'), g('nursery-3', 'Nursery 3', 'early'),
  ...[1, 2, 3, 4, 5, 6].map(n => g('p' + n, 'Primary ' + n, 'primary')),
  ...[1, 2, 3].map(n => g('s' + n, 'Secondary ' + n, 'lower-secondary')),
  ...[4, 5, 6].map(n => g('s' + n, 'Secondary ' + n, 'upper-secondary')),
  g('a-level', 'A-Level', 'a-level'),
];
const TRACKS = [
  { key: 'academic', label: 'Academic' },
  { key: 'vocational', label: 'Vocational & TVET skills' },
  { key: 'language', label: 'Languages' },
  { key: 'regional', label: 'Regional curriculum' },
];
const CURRICULA = [
  'Rwanda CBC', 'Kenya CBC / 8-4-4', 'Uganda UNEB', 'Tanzania NECTA', 'Burundi', 'DR Congo',
  'Cambridge (IGCSE / A-Level)', 'IB', 'Edexcel', 'Other / General',
];
const SUBJECTS = [
  'Mathematics', 'English', 'Kinyarwanda', 'French', 'Kiswahili', 'Science & Elementary Technology', 'Social Studies',
  'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Entrepreneurship', 'ICT / Computer Science',
  'Literature', 'Economics', 'Arts & Music', 'Physical Education', 'Religious & Moral Education',
  'Electrical Installation', 'Masonry & Construction', 'Tailoring & Fashion', 'Hospitality & Tourism', 'Agriculture', 'Carpentry',
  'Life Skills', 'Other',
];
const LANGUAGES = [
  { key: 'en', label: 'English' }, { key: 'fr', label: 'Français' },
  { key: 'rw', label: 'Kinyarwanda' }, { key: 'sw', label: 'Kiswahili' },
];
const ROLES = ['student', 'creator', 'educator', 'moderator', 'admin'];
const gradeKeys = GRADES.map(x => x.key);
const gradeLabel = k => (GRADES.find(x => x.key === k) || {}).label || k;

module.exports = { GRADES, TRACKS, CURRICULA, SUBJECTS, LANGUAGES, ROLES, gradeKeys, gradeLabel };

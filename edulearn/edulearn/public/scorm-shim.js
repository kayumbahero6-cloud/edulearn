/* SCORM runtime shim, injected by the server into every HTML page of a package.
 * The package runs in a sandboxed (opaque-origin) frame, so it cannot reach an API object on the parent page.
 * This shim therefore provides the SCORM 1.2 (window.API) and 2004 (window.API_1484_11) APIs in-frame, keeps the data model in memory,
 * and relays commits to the player page with postMessage. The player holds the scoped token; this frame never sees any credentials. */
(function () {
  'use strict';
  var init = window.__EDU_SCORM || { learner: { id: '0', name: 'Learner' }, data: {} };
  var PREFIX = 'EDUSCORM:';
  var data = {};
  try { if (window.name && window.name.indexOf(PREFIX) === 0) data = JSON.parse(window.name.slice(PREFIX.length)) || {}; } catch (e) { data = {}; }
  Object.keys(init.data || {}).forEach(function (k) { data[k] = init.data[k]; });   // server state wins on first load

  var resume = !!(data['cmi.suspend_data'] || data['cmi.core.lesson_location'] || data['cmi.location']);
  var defaults = {
    'cmi.core.student_id': init.learner.id, 'cmi.core.student_name': init.learner.name, 'cmi.core.credit': 'credit', 'cmi.core.lesson_mode': 'normal',
    'cmi.core.entry': resume ? 'resume' : 'ab-initio', 'cmi.core.total_time': '0000:00:00', 'cmi.core.lesson_status': 'not attempted', 'cmi.launch_data': '', 'cmi.comments': '',
    'cmi.learner_id': init.learner.id, 'cmi.learner_name': init.learner.name, 'cmi.credit': 'credit', 'cmi.mode': 'normal', 'cmi.entry': resume ? 'resume' : 'ab-initio',
    'cmi.completion_status': 'unknown', 'cmi.success_status': 'unknown', 'cmi.total_time': 'PT0H0M0S', 'cmi._version': '1.0', 'cmi.scaled_passing_score': '', 'cmi.completion_threshold': '',
    'cmi.interactions._count': '0', 'cmi.objectives._count': '0', 'cmi.suspend_data': '', 'cmi.core.score.min': '0', 'cmi.core.score.max': '100'
  };
  var lastError = '0', initialized = false, dirty = false;

  function persistName() { try { window.name = PREFIX + JSON.stringify(data); } catch (e) { /* ignore */ } }
  function commit() {
    persistName();
    try { window.parent.postMessage({ edu: 'scorm-commit', data: data }, '*'); } catch (e) { /* ignore */ }
    dirty = false;
  }
  function get(key) {
    key = String(key); lastError = '0';
    if (Object.prototype.hasOwnProperty.call(data, key)) return String(data[key]);
    if (Object.prototype.hasOwnProperty.call(defaults, key)) return String(defaults[key]);
    return '';
  }
  function set(key, value) {
    key = String(key); lastError = '0';
    if (/^cmi\.(core\.(student_id|student_name|credit|lesson_mode|entry|total_time)|learner_id|learner_name|credit|mode|entry|total_time|_version)$/.test(key)) { lastError = '403'; return 'false'; }  // read-only elements
    if (!/^cmi\.[A-Za-z0-9_.]{1,120}$/.test(key)) { lastError = '401'; return 'false'; }
    data[key] = String(value).slice(0, 64000); dirty = true; persistName(); return 'true';
  }
  var errors = { '0': 'No error', '101': 'General exception', '201': 'Invalid argument error', '301': 'Not initialized', '401': 'Not implemented error', '403': 'Element is read only' };
  function diag() { return errors[lastError] || ''; }

  window.API = {
    LMSInitialize: function () { initialized = true; lastError = '0'; if (get('cmi.core.lesson_status') === 'not attempted') { data['cmi.core.lesson_status'] = 'incomplete'; } return 'true'; },
    LMSFinish: function () { if (dirty || initialized) commit(); initialized = false; lastError = '0'; return 'true'; },
    LMSGetValue: get, LMSSetValue: set, LMSCommit: function () { commit(); return 'true'; },
    LMSGetLastError: function () { return lastError; }, LMSGetErrorString: function (c) { return errors[String(c)] || ''; }, LMSGetDiagnostic: function () { return diag(); }
  };
  window.API_1484_11 = {
    Initialize: function () { initialized = true; lastError = '0'; return 'true'; },
    Terminate: function () { if (initialized) commit(); initialized = false; lastError = '0'; return 'true'; },
    GetValue: get, SetValue: set, Commit: function () { commit(); return 'true'; },
    GetLastError: function () { return lastError; }, GetErrorString: function (c) { return errors[String(c)] || ''; }, GetDiagnostic: function () { return diag(); }
  };
  window.addEventListener('pagehide', function () { if (dirty) commit(); });
  window.addEventListener('beforeunload', function () { if (dirty) commit(); });
  setInterval(function () { if (dirty) commit(); }, 15000);
})();

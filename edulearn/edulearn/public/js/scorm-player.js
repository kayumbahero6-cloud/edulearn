// Runs in its own tab. It only ever holds a SCORM-scoped token (valid for this one lesson), never the learner's session token.
(function () {
  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get('token'), lessonId = params.get('lesson');
  var frame = document.getElementById('sco'), titleEl = document.getElementById('title'), statusEl = document.getElementById('status');
  document.getElementById('close').addEventListener('click', function () { window.close(); if (!window.closed) location.href = '/#/lessons/' + lessonId; });
  history.replaceState(null, '', location.pathname);   // keep the token out of the address bar and history
  function say(t) { statusEl.textContent = t; }
  if (!token || !lessonId) { titleEl.textContent = 'This link is not valid'; say('Error'); return; }
  var auth = { Authorization: 'Bearer ' + token };

  fetch('/api/scorm/state', { headers: auth }).then(function (r) { if (!r.ok) throw new Error('state'); return r.json(); }).then(function (s) {
    titleEl.textContent = s.lesson.title; document.title = s.lesson.title + ' · EduLearn';
    var entry = s.lesson.entry, sep = entry.indexOf('?') >= 0 ? '&' : '?';
    frame.src = '/scorm/' + encodeURIComponent(s.lesson.id) + '/' + entry.split('/').map(encodeURIComponent).join('/').replace(/%3F/i, '?').replace(/%3D/gi, '=').replace(/%26/g, '&') + sep + 'st=' + encodeURIComponent(token);
    say(s.data && Object.keys(s.data).length ? 'Resumed' : 'In progress');
  }).catch(function () { titleEl.textContent = 'Could not open this lesson'; say('Error'); });

  var pending = null, busy = false;
  function send(data) {
    pending = data; if (busy) return; busy = true;
    var body = pending; pending = null;
    fetch('/api/scorm/commit', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, auth), body: JSON.stringify({ data: body }) })
      .then(function (r) { return r.json(); }).then(function (x) { say(x.completed ? 'Completed' + (x.xp_awarded ? ' (+' + x.xp_awarded + ' XP)' : '') : 'Saved'); })
      .catch(function () { say('Not saved. Retrying…'); pending = pending || body; })
      .finally(function () { busy = false; if (pending) setTimeout(function () { send(pending); }, 3000); });
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== frame.contentWindow) return;               // only the lesson frame may talk to us
    var m = ev.data; if (m && m.edu === 'scorm-commit' && m.data && typeof m.data === 'object') send(m.data);
  });
})();

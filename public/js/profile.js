/* ==========================================================================
   profile.js — powers profile.html (Admin AND Staff)
   ----------------------------------------------------------------------
   Sections, in order:
     1. Setup + who is signed in
     2. Header / photo card
     3. Details form  (validation: on blur, as you type, and on submit)
     4. Profile photo upload
     5. Work Shift Status  (STAFF ONLY: clock in/out toggle + live timer)
     6. Password card      (calls PUT /api/users/me/password)
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('profile')) return;

  /* ------------------------------------------------------------------
     1. Setup
     ------------------------------------------------------------------ */
  const session = getSession();
  const isStaff = session.role === 'Staff';
  const $ = function (id) { return document.getElementById(id); };

  /* The session only holds { name, username, role }; the editable profile lives on the user record.
     A demo "guest" sign-in (any name typed on the login page that isn't a real user) has no record. */
  function findUser() {
    return Store.get('users', []).find(function (u) { return u.username === session.username; }) || null;
  }
  let user = findUser();
  const isGuest = !user;

  /* The values currently saved — "Discard Changes" restores these. */
  let saved = readSaved();
  function readSaved() {
    return {
      fullName: user ? user.name : session.name,
      birthDate: user ? (user.birthDate || '') : '',
      contact: user ? (user.contactNumber || '') : '',
      email: user ? (user.email || '') : ''
    };
  }

  /* Icons live in app.js; the HTML just marks where they go with data-icon="name". */
  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach(function (el) {
      el.innerHTML = icon(el.getAttribute('data-icon'));
    });
  }
  hydrateIcons();

  /* ------------------------------------------------------------------
     2. Header + photo card
     ------------------------------------------------------------------ */
  function garageId() {
    if (!user) return 'Not assigned';
    const digits = String(user.id).replace(/\D/g, '');
    return '#TM-' + Utils.pad(digits || '0', 4);
  }

  function userPhoto() {
    const own = user && /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/.test(user.photo || '') ? user.photo : '';
    return own || profilePhotoFor(getSession() || session);     // falls back to the copy that rides with the login session
  }

  function renderHeader() {
    const role = session.role;
    $('profileTitle').textContent = role + ' Profile';
    $('detailsTitleText').textContent = role + ' Details & Competencies';
    document.title = role + ' Profile — TeamMotor';

    $('photoName').textContent = session.name;
    $('photoRole').textContent = role;
    $('photoId').textContent = 'TeamMotor Garage ID: ' + garageId();

    const photo = userPhoto();
    $('profilePhoto').innerHTML = photo
      ? '<img src="' + photo + '" alt="' + Utils.escapeHtml(session.name) + '">'
      : '<span class="profile-initials">' + Utils.escapeHtml(initials(session.name)) + '</span>';
  }

  /* After a name/photo change, refresh the pieces of the shell that show them. */
  function refreshShell() {
    renderSidebar('profile');
    const topAvatar = document.querySelector('#accountTrigger .avatar');
    if (topAvatar) topAvatar.innerHTML = accountAvatarHTML(getSession() || session);
  }

  if (isGuest) {
    const note = $('guestNote');
    note.hidden = false;
    note.innerHTML = icon('infoCircle') +
      '<span>You&rsquo;re signed in with a demo guest name that isn&rsquo;t linked to a saved user account, so profile changes and ' +
      'shift tracking are turned off. Sign in as one of the users on the <strong>Users</strong> page (or ask an Admin to add you) to use them.</span>';
  }

  /* ------------------------------------------------------------------
     3. Details form + validation
     ------------------------------------------------------------------ */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* Philippine mobile numbers. The three accepted shapes (spaces between the groups are optional):
       +63 9XX XXX XXXX   |   09XX XXX XXXX   |   9XXXXXXXXX                                          */
  const PH_MOBILE_PATTERNS = [
    /^\+63 ?9\d{2} ?\d{3} ?\d{4}$/,
    /^09\d{2} ?\d{3} ?\d{4}$/,
    /^9\d{2} ?\d{3} ?\d{4}$/
  ];
  function isPhMobile(v) { return PH_MOBILE_PATTERNS.some(function (re) { return re.test(v); }); }
  /* Any accepted shape -> "+63 9XX XXX XXXX" (the format everything is stored and shown in). */
  function formatPhMobile(v) {
    const ten = v.replace(/\D/g, '').slice(-10);
    return '+63 ' + ten.slice(0, 3) + ' ' + ten.slice(3, 6) + ' ' + ten.slice(6);
  }

  /* Local calendar date as YYYY-MM-DD (toISOString would shift it to UTC). */
  function todayISO() {
    const d = Utils.demoNow();
    return d.getFullYear() + '-' + Utils.pad(d.getMonth() + 1, 2) + '-' + Utils.pad(d.getDate(), 2);
  }

  /* One entry per editable field: where it lives, and the rule that returns an error message ('' = valid). */
  const FIELDS = {
    fullName:  { input: $('pfFullName'),  err: $('pfFullNameErr'),  validate: function (v) { return v ? '' : 'Full Name required.'; } },
    birthDate: { input: $('pfBirthDate'), err: $('pfBirthDateErr'), validate: function (v) {
      if (!v) return 'Birth Date required.';
      if (v > todayISO()) return 'Birth Date cannot be in the future.';
      return '';
    } },
    contact:   { input: $('pfContact'),   err: $('pfContactErr'),   validate: function (v) {
      if (!v) return 'Contact Number required.';
      return isPhMobile(v) ? '' : 'Invalid Philippine mobile number format.';
    } },
    email:     { input: $('pfEmail'),     err: $('pfEmailErr'),     validate: function (v) {
      if (!v) return 'Email Address required.';
      return EMAIL_RE.test(v) ? '' : 'Incorrect Email Address format.';
    } }
  };
  const FIELD_NAMES = Object.keys(FIELDS);
  const touched = {};   // field -> true once the person has left it (so we don't nag while they're still typing the first time)

  function fieldValue(name) { return FIELDS[name].input.value.trim(); }

  function setFieldError(name, message) {
    const f = FIELDS[name];
    const wrap = f.input.closest('.pf-field');
    wrap.classList.toggle('is-invalid', !!message);
    f.input.setAttribute('aria-invalid', message ? 'true' : 'false');
    f.err.innerHTML = message ? icon('alertTriangle') + '<span>' + Utils.escapeHtml(message) + '</span>' : '';
  }

  /* Validate one field, show/clear its message, and return true when it's fine. */
  function validateField(name) {
    const message = FIELDS[name].validate(fieldValue(name));
    setFieldError(name, message);
    return !message;
  }

  function validateAll() {
    let firstBad = null;
    FIELD_NAMES.forEach(function (name) {
      touched[name] = true;
      if (!validateField(name) && !firstBad) firstBad = name;
    });
    if (firstBad) FIELDS[firstBad].input.focus();
    return !firstBad;
  }

  function fillForm(values) {
    FIELDS.fullName.input.value = values.fullName;
    FIELDS.birthDate.input.value = values.birthDate;
    FIELDS.contact.input.value = values.contact;
    FIELDS.email.input.value = values.email;
    $('pfPosition').value = session.role;
    FIELD_NAMES.forEach(function (name) { touched[name] = false; setFieldError(name, ''); });
  }

  /* Real-time: validate when the person leaves a field, and again on every keystroke once it has been
     touched or is showing an error — so a message appears/disappears as they fix it. */
  FIELD_NAMES.forEach(function (name) {
    const input = FIELDS[name].input;
    input.addEventListener('blur', function () { touched[name] = true; validateField(name); });
    input.addEventListener('input', function () { if (touched[name]) validateField(name); });
    // date pickers fire "change" (not always "input") when a day is chosen from the calendar
    input.addEventListener('change', function () { if (touched[name]) validateField(name); });
  });
  FIELDS.birthDate.input.max = todayISO();
  FIELDS.birthDate.input.min = '1900-01-01';

  async function saveProfile() {
    if (isGuest) { showToast('Guest sessions can\u2019t save profile changes.', 'info'); return; }
    if (!validateAll()) return;

    const name = fieldValue('fullName');
    const email = fieldValue('email');

    const contact = formatPhMobile(fieldValue('contact'));
    try {
      user = await Api.put('/users/me/profile', { name: name, email: email, birthDate: fieldValue('birthDate'), contactNumber: contact });
      await Store.refresh();
    } catch (err) {
      if (/email/i.test(err.message)) { setFieldError('email', err.message); FIELDS.email.input.focus(); }
      else showToast(err.message, 'danger');
      return;
    }

    // The signed-in session carries the display name, so keep it in step with the saved record.
    if (name !== session.name) {
      session.name = name;
      Api.setUser(Object.assign({}, getSession(), { name: name }));
    }

    saved = readSaved();
    fillForm(saved);          // shows the contact number in its tidy "+63 9XX XXX XXXX" form
    renderHeader();
    refreshShell();
    showToast('Profile details saved.', 'ok');
  }

  $('profileForm').addEventListener('submit', function (e) { e.preventDefault(); saveProfile(); });
  $('discardBtn').addEventListener('click', function () {
    fillForm(saved);
    showToast('Changes discarded.', 'info');
  });

  /* ------------------------------------------------------------------
     4. Profile photo
     ------------------------------------------------------------------ */
  /* Shrinks the chosen picture to a small JPEG so it fits comfortably in the browser's ~5 MB of storage (the whole
     app's data shares that space). Avatars are shown at 40-170 px, so 256 px is plenty. It starts at 256 px / 0.8
     quality and steps down until the saved text is under PHOTO_MAX_CHARS. A real backend would store the file and
     keep a URL. */
  const PHOTO_STEPS = [{ max: 256, quality: 0.8 }, { max: 200, quality: 0.7 }, { max: 160, quality: 0.6 }];
  const PHOTO_MAX_CHARS = 60000;            // about 45 KB of image
  function resizePhoto(file, done, fail) {
    const reader = new FileReader();
    reader.onerror = fail;
    reader.onload = function () {
      const img = new Image();
      img.onerror = fail;
      img.onload = function () {
        let dataUrl = '';
        for (let i = 0; i < PHOTO_STEPS.length; i++) {
          const scale = Math.min(1, PHOTO_STEPS[i].max / Math.max(img.width, img.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', PHOTO_STEPS[i].quality);
          if (dataUrl.length <= PHOTO_MAX_CHARS) break;
        }
        done(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $('photoEditBtn').addEventListener('click', function () {
    if (isGuest) { showToast('Guest sessions can\u2019t change the profile photo.', 'info'); return; }
    $('photoInput').click();
  });
  $('photoInput').addEventListener('change', function () {
    const file = this.files && this.files[0];
    this.value = '';                       // lets the same file be picked again later
    if (!file) return;
    if (!/^image\//.test(file.type)) { showToast('Please choose an image file.', 'danger'); return; }
    if (file.size > 10 * 1024 * 1024) { showToast('That image is too large (10 MB max).', 'danger'); return; }
    resizePhoto(file, async function (dataUrl) {
      try {
        user = await Api.put('/users/me/profile', { photo: dataUrl });   // stored on the user record in MongoDB
        rememberSessionPhoto(dataUrl);
        renderHeader();
        refreshShell();
        showToast('Profile photo updated.', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }
    }, function () { showToast('Couldn\u2019t read that image. Try a different file.', 'danger'); });
  });

  /* ------------------------------------------------------------------
     5. Work Shift Status  (STAFF ONLY)
     ------------------------------------------------------------------ */
  let ticker = null;   // setInterval id while a shift is running

  function row(label, valueHtml) {
    return '<div class="shift-row"><dt>' + label + '</dt><dd>' + valueHtml + '</dd></div>';
  }

  /* Live elapsed readout: "05 hrs 47 mins" plus a small seconds counter so it visibly ticks every second. */
  function elapsedHtml(rec) {
    const ms = Shifts.durationMs(rec);
    return '<span class="shift-elapsed"><span id="elapsedMain">' + Shifts.formatDuration(ms, true) + '</span>' +
           '<small id="elapsedSecs">' + Utils.pad(Shifts.split(ms).secs, 2) + 's</small></span>';
  }

  function renderShift() {
    const rec = isGuest ? null : Shifts.active(session.username);
    const on = !!rec;

    const pill = $('shiftPill');
    pill.className = 'badge ' + (on ? 'badge-ok' : 'badge-neutral');
    pill.textContent = on ? 'IN / Shift Started' : 'OFF DUTY';

    const sw = $('shiftSwitch');
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-checked', on ? 'true' : 'false');
    sw.disabled = isGuest;
    $('shiftSideOn').classList.toggle('is-active', on);
    $('shiftSideOff').classList.toggle('is-active', !on);

    let rows;
    if (isGuest) {
      rows = '<div class="shift-note">Shift tracking needs a saved user account.</div>';
    } else if (on) {
      rows = row('Clock In Time:', Shifts.formatStamp(rec.clockIn)) + row('Shift Elapsed:', elapsedHtml(rec));
    } else {
      const last = Shifts.lastCompleted(session.username);
      rows = last
        ? row('Last Clock In:', Shifts.formatStamp(last.clockIn)) +
          row('Last Clock Out:', Shifts.formatStamp(last.clockOut)) +
          row('Shift Duration:', Shifts.formatDuration(Shifts.durationMs(last), true)) +
          '<div class="shift-note shift-note-done">' + icon('checkCircle') + '<span>Shift completed.</span></div>'
        : '<div class="shift-note">No shift yet. Flip the switch to clock in.</div>';
    }
    $('shiftRows').innerHTML = rows;

    if (on) startTicker(); else stopTicker();
  }

  /* Re-read the saved clock-in every second (rather than counting up in memory) so the number stays right
     after reloads, sleep, or a throttled background tab. */
  function tick() {
    const rec = Shifts.active(session.username);
    if (!rec) { renderShift(); return; }          // ended elsewhere (e.g. another tab)
    const ms = Shifts.durationMs(rec);
    const main = $('elapsedMain'), secs = $('elapsedSecs');
    if (main) main.textContent = Shifts.formatDuration(ms, true);
    if (secs) secs.textContent = Utils.pad(Shifts.split(ms).secs, 2) + 's';
  }
  function startTicker() { if (!ticker) ticker = setInterval(tick, 1000); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  async function toggleShift() {
    if (isGuest) return;
    try {
      if (Shifts.active(session.username)) {
        const done = await Shifts.clockOut();          // stops the timer + marks the shift Completed
        if (done) showToast('Clocked out. Shift completed \u2014 ' + Shifts.formatDuration(Shifts.durationMs(done)) + ' worked.', 'ok');
      } else {
        const rec = await Shifts.clockIn();
        showToast('Clocked in at ' + Shifts.formatTime(rec.clockIn) + '.', 'ok');
      }
    } catch (err) { showToast(err.message, 'danger'); }
    renderShift();
  }

  if (isStaff) {
    $('shiftCard').hidden = false;
    $('shiftSwitch').addEventListener('click', toggleShift);
    renderShift();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });
    window.addEventListener('pagehide', stopTicker);
  } else {
    $('shiftCard').remove();          // Admins don't clock in — the card isn't even in the page
  }

  /* ------------------------------------------------------------------
     6. Password & Security — Save Password calls PUT /api/users/me/password
     The password is checked and hashed (bcrypt) by the server; the browser never stores it.
     (Show/hide eyes and the strength bar are purely visual.)
     ------------------------------------------------------------------ */
  document.querySelectorAll('[data-toggle-secret]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const input = $(btn.getAttribute('data-toggle-secret'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      btn.innerHTML = icon(show ? 'eyeOff' : 'eye');
    });
  });

  /* 0-3 bars: 8+ characters, mixed case with a number, and a symbol or 12+ characters. */
  $('pwNew').addEventListener('input', function () {
    const v = this.value;
    let level = 0;
    if (v.length >= 8) level++;
    if (/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v)) level++;
    if (/[^A-Za-z0-9]/.test(v) || v.length >= 12) level++;
    if (!v) level = 0;
    $('pwMeter').setAttribute('data-level', String(level));
  });

  async function changePassword(e) {
    e.preventDefault();
    const current = $('pwCurrent').value, next = $('pwNew').value, confirm = $('pwConfirm').value;
    if (!current || !next) { showToast('Enter your current and new password.', 'danger'); return; }
    if (next !== confirm) { showToast('New password and confirmation do not match.', 'danger'); return; }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(next)) { showToast('New password needs at least 8 characters, including a letter and a number.', 'danger'); return; }
    await Utils.withBusy($('savePasswordBtn'), async function () {
      try {
        const r = await Api.put('/users/me/password', { currentPassword: current, newPassword: next });
        Api.setToken(r.token);                     // other sessions/devices are signed out; this one continues
        $('passwordForm').reset(); $('pwMeter').setAttribute('data-level', '0');
        showToast('Password changed.', 'ok');
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }
  $('clearPasswordBtn').addEventListener('click', function () { $('passwordForm').reset(); $('pwMeter').setAttribute('data-level', '0'); });
  $('passwordForm').addEventListener('submit', changePassword);

  /* ------------------------------------------------------------------
     Go
     ------------------------------------------------------------------ */
  renderHeader();
  fillForm(saved);
  if (isGuest) {
    $('saveBtn').disabled = true;
    $('photoEditBtn').disabled = true;
  }
});

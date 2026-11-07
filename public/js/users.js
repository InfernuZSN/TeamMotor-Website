/* ==========================================================================
   users.js — powers users.html (Admin only)
   ========================================================================== */
Boot.ready(function () {
  if (!initShell('users')) return;
  if (!requireRole('Admin')) return;

  let editingUserId = null;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /* Profile photo saved on the Profile page (user.photo, a resized data URL — the same field the sidebar avatar reads).
     Initials stay underneath, so a missing or broken image falls back to the initials avatar. */
  const PHOTO_OK = /^data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+$/;
  function userAvatar(u) {
    const img = PHOTO_OK.test(u.photo || '') ? '<img class="user-avatar-img" src="' + u.photo + '" alt="" loading="lazy" onerror="this.remove()">' : '';
    return '<div class="avatar user-avatar" title="' + Utils.escapeHtml(u.name) + '">' + Utils.escapeHtml(initials(u.name)) + img + '</div>';
  }

  function openModal(id) { document.getElementById(id).classList.add('open'); }
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'shiftModalOverlay') stopShiftRefresh();
  }

  function renderTable() {
    const q = document.getElementById('userSearch').value.trim().toLowerCase();
    const users = Store.get('users', []).filter(u => !q || u.name.toLowerCase().indexOf(q) !== -1 || u.username.toLowerCase().indexOf(q) !== -1);
    const tbody = document.getElementById('usersTbody');
    if (!users.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state">' + icon('users') + '<h3>No users found</h3></div></td></tr>';
      return;
    }
    const me = getSession();
    tbody.innerHTML = users.map(u => {
      return '<tr>' +
        '<td><div class="cell-product">' + userAvatar(u) +
        '<span style="font-weight:600;color:var(--ink);">' + Utils.escapeHtml(u.name) + (u.username === me.username ? ' <span class="hint" style="display:inline;">(you)</span>' : '') + '</span></div></td>' +
        '<td class="text-muted">' + Utils.escapeHtml(u.username) + '</td>' +
        '<td class="text-muted">' + Utils.escapeHtml(u.email) + '</td>' +
        '<td><span class="badge badge-neutral">' + u.role + '</span></td>' +
        '<td class="text-muted">' + Utils.formatDate(u.dateAdded) + '</td>' +
        '<td><span class="badge ' + (u.status === 'Active' ? 'badge-ok' : 'badge-neutral') + '">' + u.status + '</span></td>' +
        '<td><div class="row-actions">' +
          '<button class="icon-btn" title="Edit" data-edit="' + u.id + '">' + icon('edit') + '</button>' +
          (u.role === 'Staff' ? '<button class="icon-btn" title="Shift history" aria-label="Shift history for ' + Utils.escapeHtml(u.name) + '" data-shifts="' + u.id + '">' + icon('clock') + '</button>' : '') +
          (u.username !== me.username ? '<button class="icon-btn" title="Delete account" aria-label="Delete ' + Utils.escapeHtml(u.name) + '" data-delete="' + u.id + '" style="color:var(--danger);"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>' : '') +
        '</div></td>' +
      '</tr>';
    }).join('');
  }

  function openUserModal(mode, userId) {
    editingUserId = mode === 'edit' ? userId : null;
    document.getElementById('userForm').reset();
    document.getElementById('userModalTitle').textContent = mode === 'edit' ? 'Edit User' : 'Add User';
    const passwordInput = document.getElementById('uPassword');
    const confirmInput = document.getElementById('uConfirmPassword');
    const passwordHint = document.getElementById('userPasswordHint');
    if (mode === 'edit') {
      const u = Store.get('users', []).find(x => x.id === userId);
      if (!u) return;
      document.getElementById('uName').value = u.name;
      document.getElementById('uUsername').value = u.username;
      document.getElementById('uEmail').value = u.email;
      document.getElementById('uRole').value = u.role;
      document.getElementById('uStatus').value = u.status;
      passwordInput.required = false;
      confirmInput.required = false;
      passwordInput.placeholder = 'Leave blank to keep current password';
      confirmInput.placeholder = 'Leave blank to keep current password';
      if (passwordHint) passwordHint.textContent = 'Leave password fields blank to keep the current password. Fill both only if changing it.';
    } else {
      document.getElementById('uRole').value = 'Staff';
      document.getElementById('uStatus').value = 'Active';
      passwordInput.required = true;
      confirmInput.required = true;
      passwordInput.placeholder = 'Enter password';
      confirmInput.placeholder = 'Re-enter password';
      if (passwordHint) passwordHint.textContent = 'Password and confirm password are required when adding a new account.';
    }
    openModal('userModalOverlay');
  }

  /* Password helpers — structured for a future database backend.
     When a real API exists, replace these with hashed password columns
     (e.g. password_hash, password_updated_at) instead of plain storage. */
  function readPasswordFields() {
    const password = (document.getElementById('uPassword').value || '').trim();
    const confirmPassword = (document.getElementById('uConfirmPassword').value || '').trim();
    return { password: password, confirmPassword: confirmPassword };
  }

  function validatePasswordFields(isNewUser) {
    const fields = readPasswordFields();
    const password = fields.password;
    const confirmPassword = fields.confirmPassword;
    const passwordField = document.getElementById('uPassword').closest('.field');
    const confirmField = document.getElementById('uConfirmPassword').closest('.field');

    function setFieldError(fieldEl, message) {
      if (!fieldEl) return;
      fieldEl.classList.add('has-error');
      let msg = fieldEl.querySelector('.field-error-msg');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'field-error-msg';
        fieldEl.appendChild(msg);
      }
      msg.textContent = message;
    }
    function clearFieldError(fieldEl) {
      if (!fieldEl) return;
      fieldEl.classList.remove('has-error');
      const msg = fieldEl.querySelector('.field-error-msg');
      if (msg) msg.remove();
    }

    clearFieldError(passwordField);
    clearFieldError(confirmField);

    if (isNewUser) {
      if (!password) {
        setFieldError(passwordField, 'Password is required.');
        return null;
      }
      if (!confirmPassword) {
        setFieldError(confirmField, 'Confirm password is required.');
        return null;
      }
    } else if (!password && !confirmPassword) {
      // Editing and both blank — keep existing password
      return { skipPassword: true };
    } else if (!password || !confirmPassword) {
      if (!password) setFieldError(passwordField, 'Enter a new password or leave both blank.');
      if (!confirmPassword) setFieldError(confirmField, 'Confirm the new password or leave both blank.');
      return null;
    }

    if (password !== confirmPassword) {
      setFieldError(confirmField, 'Passwords do not match.');
      return null;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password)) {
      setFieldError(passwordField, 'Password must be at least 8 characters and include a letter and a number.');
      return null;
    }

    // sent to the server over the API, which hashes it with bcrypt — the browser never stores or hashes passwords
    return { skipPassword: false, password: password };
  }

  async function saveUser() {
    const form = document.getElementById('userForm');
    if (!validateForm(form)) return;

    const isNewUser = !editingUserId;
    const passwordResult = validatePasswordFields(isNewUser);
    if (!passwordResult) return;

    const payload = {
      name: document.getElementById('uName').value.trim(),
      username: document.getElementById('uUsername').value.trim(),
      email: document.getElementById('uEmail').value.trim(),
      role: document.getElementById('uRole').value,
      status: document.getElementById('uStatus').value
    };
    if (!passwordResult.skipPassword) payload.password = passwordResult.password;

    await Utils.withBusy(document.getElementById('saveUserBtn') || document.querySelector('#userModalOverlay .btn-primary'), async function () {
      try {
        if (editingUserId) { await Api.put('/users/' + encodeURIComponent(editingUserId), payload); showToast('Updated ' + payload.name + '.', 'ok'); }
        else { await Api.post('/users', payload); showToast('Added ' + payload.name + ' as ' + payload.role + '.', 'ok'); }
        await Store.refresh();
        closeModal('userModalOverlay');
        renderTable();
      } catch (err) { showToast(err.message, 'danger'); }
    });
  }

  /* ---------- Shift History (Admin reviews a Staff member's attendance) ---------- */
  let shiftUserId = null;     // whose history the modal is showing
  let shiftRefresh = null;    // timer that keeps an ONGOING shift's hours current while the modal is open

  function stopShiftRefresh() {
    if (shiftRefresh) { clearInterval(shiftRefresh); shiftRefresh = null; }
    shiftUserId = null;
  }

  function renderShiftHistory() {
    const u = Store.get('users', []).find(function (x) { return x.id === shiftUserId; });
    if (!u) return;
    const shifts = Shifts.forUser(u.username);            // newest first
    const totalMs = shifts.reduce(function (sum, sh) { return sum + Shifts.durationMs(sh); }, 0);
    const ongoing = shifts.some(function (sh) { return !sh.clockOut; });

    document.getElementById('shiftModalTitle').textContent = 'Shift History \u2013 ' + u.name;
    document.getElementById('shiftSummary').innerHTML = shifts.length
      ? '<span><strong>' + shifts.length + '</strong> shift' + (shifts.length === 1 ? '' : 's') + '</span>' +
        '<span>Total: <strong>' + Shifts.formatDuration(totalMs) + '</strong></span>' +
        (ongoing ? '<span class="badge badge-ok">Currently on duty</span>' : '')
      : '';

    document.getElementById('shiftHistoryTbody').innerHTML = shifts.length
      ? shifts.map(function (sh) {
          const done = !!sh.clockOut;
          return '<tr>' +
            '<td style="font-weight:600;color:var(--ink);">' + Shifts.formatDate(sh.clockIn) + '</td>' +
            '<td>' + Shifts.formatTime(sh.clockIn) + '</td>' +
            '<td>' + (done ? Shifts.formatTime(sh.clockOut) : '<span class="text-muted">\u2014</span>') + '</td>' +
            '<td>' + Shifts.formatDuration(Shifts.durationMs(sh)) + '</td>' +
            '<td><span class="badge ' + (done ? 'badge-ok' : 'badge-warn') + '">' + (done ? 'Completed' : 'Ongoing') + '</span></td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="5"><div class="empty-state">' + icon('clock') + '<h3>No shifts recorded yet</h3>' +
        '<p>Shifts show up here once ' + Utils.escapeHtml(u.name) + ' clocks in from their Profile page.</p></div></td></tr>';

    // only keep a timer running while there is an ongoing shift to keep fresh
    if (ongoing && !shiftRefresh) shiftRefresh = setInterval(renderShiftHistory, 15000);
    if (!ongoing && shiftRefresh) { clearInterval(shiftRefresh); shiftRefresh = null; }
  }

  function openShiftHistory(userId) {
    shiftUserId = userId;
    renderShiftHistory();
    openModal('shiftModalOverlay');
  }

  function deleteUser(userId) {
    const u = Store.get('users', []).find(function (x) { return x.id === userId; });
    if (!u) return;
    confirmDialog('Delete ' + u.name + '?', 'This permanently removes ' + u.name + ' (' + u.role + ') from the system so they can no longer sign in. Past sales and shift history are preserved.', async function () {
      try {
        await Api.del('/users/' + encodeURIComponent(userId));
        await Store.refresh();
        renderTable();
        showToast('Deleted user account "' + u.name + '".', 'ok');
      } catch (err) {
        showToast(err.message, 'danger');
      }
    }, 'Delete Account');
  }

  Boot.dom(function () {
    renderTable();
    document.getElementById('userSearch').addEventListener('input', renderTable);
    document.getElementById('addUserBtn').addEventListener('click', function () { openUserModal('add'); });
    document.getElementById('saveUserBtn').addEventListener('click', saveUser);
    document.getElementById('usersTbody').addEventListener('click', function (e) {
      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) openUserModal('edit', editBtn.dataset.edit);
      const shiftBtn = e.target.closest('[data-shifts]');
      if (shiftBtn) openShiftHistory(shiftBtn.dataset.shifts);
      const delBtn = e.target.closest('[data-delete]');
      if (delBtn) deleteUser(delBtn.dataset.delete);
    });
    document.querySelectorAll('[data-close]').forEach(function (btn) { btn.addEventListener('click', function () { closeModal(btn.dataset.close); }); });
    document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeModal(overlay.id); });
    });
  });
});

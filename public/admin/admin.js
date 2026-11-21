// Bookings admin: list, details, status and notes, and adding a phone booking.
(function () {
  const STATUSES = ['new', 'contacted', 'quoted', 'booked', 'done', 'lost'];
  const LABELS = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', booked: 'Booked', done: 'Done', lost: 'Lost' };
  const FILMS = ['Uviron PureMax Carbon', 'GeoShield C2 Ceramic', 'Not sure yet'];
  const PACKAGES = ['Full Vehicle (No Front Windshield)', 'Front only', 'Custom'];
  const SOURCES = ['Phone', 'Website', 'Referral', 'Other'];
  const TZ = 'America/Chicago';

  const state = { status: '', due: false, q: '', bookings: [], counts: {}, selectedId: null, mode: 'view' };
  const TODAY = (() => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()))();
  const $ = (sel) => document.querySelector(sel);

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function api(path, opts) {
    const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}));
    let body = {};
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || 'Request failed (' + res.status + ').');
    }
    return body;
  }

  // D1 stores UTC times as "YYYY-MM-DD HH:MM:SS".
  function parseUtc(s) {
    return new Date(String(s).replace(' ', 'T') + 'Z');
  }
  function fmtReceived(s) {
    return parseUtc(s).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  }
  function todayChicago() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return parts; // en-CA gives YYYY-MM-DD
  }
  function isLate(b) {
    return b.status === 'new' && Date.now() - parseUtc(b.created_at).getTime() > 24 * 3600 * 1000;
  }

  function renderChips() {
    const total = STATUSES.reduce((a, s) => a + (state.counts[s] || 0), 0);
    const chips = [{ key: '', label: 'All', n: total }].concat(
      STATUSES.map((s) => ({ key: s, label: LABELS[s], n: state.counts[s] || 0 })),
      [{ key: 'due', label: 'Follow up', n: state.counts.due || 0 }]
    );
    const isOn = (c) => (c.key === 'due' ? state.due : !state.due && state.status === c.key);
    $('#chips').innerHTML = chips.map((c) =>
      '<button class="chip' + (isOn(c) ? ' on' : '') + '" data-key="' + c.key + '">' +
      esc(c.label) + '<b>' + c.n + '</b></button>'
    ).join('');
    document.querySelectorAll('#chips .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.key === 'due') {
          state.due = true;
          state.status = '';
        } else {
          state.due = false;
          state.status = btn.dataset.key;
        }
        loadList();
      });
    });
  }

  function renderList() {
    if (!state.bookings.length) {
      $('#list').innerHTML = '<div class="empty">No bookings here yet.</div>';
      return;
    }
    const rows = state.bookings.map((b) =>
      '<tr class="row' + (b.id === state.selectedId ? ' sel' : '') + '" data-id="' + b.id + '">' +
        '<td class="' + (isLate(b) ? 'late' : '') + '">' + esc(fmtReceived(b.created_at)) + '</td>' +
        '<td><div class="name">' + esc(b.name) + '</div><div class="sub">' + esc(b.phone) + '</div>' +
          (b.follow_up_date ? '<div class="sub ' + (b.follow_up_date <= TODAY && !['done', 'lost'].includes(b.status) ? 'late' : '') + '">Follow up ' + esc(fmtDate(b.follow_up_date)) + '</div>' : '') +
        '</td>' +
        '<td class="hide-m">' + esc(b.year + ' ' + b.make + ' ' + b.model) + '</td>' +
        '<td class="hide-m">' + esc(b.film) + '<div class="sub">' + esc(b.package) + '</div></td>' +
        '<td class="hide-m">' + esc(fmtDate(b.preferred_date)) + ' · ' + esc(b.preferred_time || '') + '</td>' +
        '<td class="hide-m">' + esc(b.source || 'Website') + '</td>' +
        '<td><span class="pill s-' + esc(b.status) + '">' + esc(LABELS[b.status] || b.status) + '</span></td>' +
      '</tr>'
    ).join('');
    $('#list').innerHTML =
      '<table><thead><tr><th>Received</th><th>Customer</th><th class="hide-m">Vehicle</th>' +
      '<th class="hide-m">Film / package</th><th class="hide-m">Requested</th><th class="hide-m">Source</th>' +
      '<th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
    document.querySelectorAll('#list tr.row').forEach((tr) => {
      tr.addEventListener('click', () => {
        state.selectedId = Number(tr.dataset.id);
        state.mode = 'view';
        renderList();
        renderDetail();
      });
    });
  }

  async function loadList() {
    const params = new URLSearchParams();
    if (state.due) params.set('due', '1');
    else if (state.status) params.set('status', state.status);
    if (state.q) params.set('q', state.q);
    try {
      const data = await api('/api/admin/bookings?' + params.toString());
      state.bookings = data.bookings;
      state.counts = data.counts;
      $('#listMsg').innerHTML = '';
      renderChips();
      renderList();
    } catch (err) {
      $('#listMsg').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>';
    }
  }

  function selectedBooking() {
    return state.bookings.find((b) => b.id === state.selectedId) || null;
  }

  function renderDetail(msg) {
    if (state.mode === 'new') return renderNewForm();
    const b = selectedBooking();
    if (!b) {
      $('#panel').innerHTML = msg
        ? '<div class="msg ' + msg.type + '">' + esc(msg.text) + '</div>'
        : '<div class="empty">Select a booking to see details, or add a new one.</div>';
      return;
    }
    const statusOptions = STATUSES.map((s) =>
      '<option value="' + s + '"' + (s === b.status ? ' selected' : '') + '>' + LABELS[s] + '</option>'
    ).join('');
    $('#panel').innerHTML =
      '<h2>' + esc(b.name) + '</h2>' +
      '<div class="meta">Received ' + esc(fmtReceived(b.created_at)) + ' · booking #' + b.id + ' · ' + esc(b.source || 'Website') + '</div>' +
      '<div class="links"><a class="btn" href="tel:' + esc(b.phone.replace(/[^\d+]/g, '')) + '">Call</a>' +
      '<a class="btn" href="mailto:' + esc(b.email) + '">Email</a></div>' +
      '<dl>' +
        '<dt>Phone</dt><dd>' + esc(b.phone) + '</dd>' +
        '<dt>Email</dt><dd>' + esc(b.email) + '</dd>' +
        '<dt>Vehicle</dt><dd>' + esc(b.year + ' ' + b.make + ' ' + b.model) + '</dd>' +
        '<dt>Film</dt><dd>' + esc(b.film) + '</dd>' +
        '<dt>Package</dt><dd>' + esc(b.package) + '</dd>' +
        '<dt>Requested</dt><dd>' + esc(fmtDate(b.preferred_date)) + ' · ' + esc(b.preferred_time || '') + '</dd>' +
        '<dt>Customer notes</dt><dd>' + esc(b.notes || 'None') + '</dd>' +
      '</dl>' +
      (b.status === 'booked'
        ? '<div class="meta">' + (b.reminder_sent_at
            ? 'Reminder emailed ' + esc(fmtReceived(b.reminder_sent_at))
            : 'Reminder email goes out the day before the appointment') + '</div>'
        : '') +
      '<label for="fu">Follow up by</label><input id="fu" type="date" value="' + esc(b.follow_up_date || '') + '">' +
      '<div class="hint">Shows under "Follow up" on the list until it is done or lost. Clear it to remove.</div>' +
      '<label for="st">Status</label><select id="st">' + statusOptions + '</select>' +
      '<label for="nt">Internal notes</label><textarea id="nt" placeholder="Called, left voicemail, quote sent…">' + esc(b.internal_notes || '') + '</textarea>' +
      '<div class="btns"><button class="btn primary wide" id="saveBtn">Save</button></div>' +
      '<div class="btns"><button class="btn wide" id="delBtn" style="color:#ff8a80;border-color:#6b2f2f">Delete booking</button></div>' +
      '<div id="detailMsg">' + (msg ? '<div class="msg ' + msg.type + '">' + esc(msg.text) + '</div>' : '') + '</div>';
    $('#saveBtn').addEventListener('click', saveDetail);
    $('#delBtn').addEventListener('click', deleteBooking);
  }

  async function deleteBooking() {
    const b = selectedBooking();
    if (!b) return;
    const ok = window.confirm(
      'Delete the booking for ' + b.name + ' and remove its calendar event?\n\nThis cannot be undone.'
    );
    if (!ok) return;
    const btn = $('#delBtn');
    btn.disabled = true;
    try {
      const data = await api('/api/admin/bookings/' + b.id, { method: 'DELETE' });
      state.selectedId = null;
      await loadList();
      let text = 'Booking deleted.';
      if (data.calendar === 'deleted') text = 'Booking deleted and its calendar event removed.';
      if (data.calendar === 'not found') text = 'Booking deleted. No matching calendar event was found, so check the calendar by hand.';
      renderDetail({ type: data.calendar === 'not found' ? 'err' : 'ok', text });
    } catch (err) {
      btn.disabled = false;
      const el = $('#detailMsg');
      if (el) el.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>';
    }
  }

  async function saveDetail() {
    const b = selectedBooking();
    if (!b) return;
    const btn = $('#saveBtn');
    btn.disabled = true;
    try {
      await api('/api/admin/bookings/' + b.id, {
        method: 'PATCH',
        body: JSON.stringify({
          status: $('#st').value,
          internal_notes: $('#nt').value,
          follow_up_date: $('#fu').value,
        }),
      });
      await loadList();
      renderDetail({ type: 'ok', text: 'Saved.' });
    } catch (err) {
      // Keep what the user typed; show the error under the buttons.
      btn.disabled = false;
      const el = $('#detailMsg');
      if (el) el.innerHTML = '<div class="msg err">' + esc(err.message) + '</div>';
    }
  }

  // ---- New booking (phone calls and other entries made by hand) ----

  function opts(list, selected) {
    return list.map((v) => '<option' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }

  function renderNewForm(msg) {
    $('#panel').innerHTML =
      '<h2>New booking</h2>' +
      '<div class="meta">Enter a booking taken by phone or another way. It is added to the calendar too.</div>' +
      '<form id="newForm" novalidate>' +
      '<div class="section">Customer</div>' +
      '<div class="grid2">' +
        '<div><label>First name <span class="req">*</span></label><input name="first" autocomplete="off"></div>' +
        '<div><label>Last name <span class="req">*</span></label><input name="last" autocomplete="off"></div>' +
        '<div class="full"><label>Phone <span class="req">*</span></label><input name="phone" type="tel" autocomplete="off"></div>' +
        '<div class="full"><label>Email <span class="req">*</span></label><input name="email" type="email" autocomplete="off"><div class="hint">Required. Ask the caller for an email before saving.</div></div>' +
      '</div>' +
      '<div class="section">Vehicle</div>' +
      '<div class="grid2">' +
        '<div><label>Year <span class="req">*</span></label><input name="year" inputmode="numeric" maxlength="4"></div>' +
        '<div><label>Make <span class="req">*</span></label><input name="make"></div>' +
        '<div class="full"><label>Model <span class="req">*</span></label><input name="model"></div>' +
      '</div>' +
      '<div class="section">Film and package</div>' +
      '<div class="grid2">' +
        '<div class="full"><label>Film <span class="req">*</span></label><select name="film">' + opts(FILMS, FILMS[1]) + '</select></div>' +
        '<div class="full"><label>Package <span class="req">*</span></label><select name="package">' + opts(PACKAGES, PACKAGES[0]) + '</select></div>' +
      '</div>' +
      '<div class="section">Appointment</div>' +
      '<div class="grid2">' +
        '<div class="full"><label>Date <span class="req">*</span></label><input name="date" type="date" min="' + todayChicago() + '"></div>' +
        '<div class="full"><label>Start time <span class="req">*</span></label><select name="time"><option value="">Choose a date first</option></select>' +
        '<div class="hint" id="timeHint">Only open times appear. They come from the calendar.</div></div>' +
      '</div>' +
      '<div class="section">Details</div>' +
      '<label>Follow up by (optional)</label><input name="follow_up_date" type="date">' +
      '<label>Source</label><select name="source">' + opts(SOURCES, 'Phone') + '</select>' +
      '<label>Status</label><select name="status">' + opts(STATUSES.map((s) => LABELS[s]), 'Booked') + '</select>' +
      '<label>Customer notes</label><textarea name="notes" placeholder="What the caller asked for"></textarea>' +
      '<label>Internal notes</label><textarea name="internal_notes" placeholder="Optional"></textarea>' +
      '<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;color:var(--text);margin-top:14px">' +
        '<input type="checkbox" name="send_receipt" checked style="width:auto"> Email the customer their appointment details</label>' +
      '<div class="hint">Consent is recorded as verbal, by phone.</div>' +
      '<div id="formMsg"></div>' +
      '<div class="btns"><button type="button" class="btn" id="cancelNew">Cancel</button>' +
      '<button type="submit" class="btn primary" id="saveNew">Save booking</button></div>' +
      '</form>' +
      (msg ? '<div class="msg ' + msg.type + '">' + esc(msg.text) + '</div>' : '');

    const form = $('#newForm');
    form.elements.date.addEventListener('change', (e) => loadTimes(e.target.value));
    $('#cancelNew').addEventListener('click', () => { state.mode = 'view'; renderDetail(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); submitNew(); });
  }

  async function loadTimes(date) {
    const select = $('#newForm').elements.time;
    const hint = $('#timeHint');
    select.innerHTML = '<option value="">Loading…</option>';
    if (!date) { select.innerHTML = '<option value="">Choose a date first</option>'; return; }
    try {
      const data = await api('/api/availability?date=' + encodeURIComponent(date));
      if (data.closed) {
        select.innerHTML = '<option value="">Closed</option>';
        hint.textContent = 'We are closed on Sundays. Choose another day.';
        return;
      }
      select.innerHTML = data.times.length
        ? '<option value="">Choose a time</option>' + data.times.map((t) => '<option>' + esc(t) + '</option>').join('')
        : '<option value="">No open times</option>';
      hint.textContent = data.times.length ? 'Only open times appear.' : 'No open times on this day. Choose another day.';
    } catch (err) {
      select.innerHTML = '<option value="">Could not load times</option>';
      hint.textContent = err.message;
    }
  }

  // Shows a message under the form without redrawing it, so typed values stay put.
  function setFormMsg(type, text) {
    const el = $('#formMsg');
    if (el) el.innerHTML = '<div class="msg ' + type + '">' + esc(text) + '</div>';
  }

  async function submitNew() {
    const form = $('#newForm');
    const f = form.elements;
    const required = ['first', 'last', 'phone', 'email', 'year', 'make', 'model', 'date', 'time'];
    let missing = false;
    for (const k of required) {
      const bad = !String(f[k].value || '').trim();
      f[k].classList.toggle('invalid', bad);
      if (bad) missing = true;
    }
    if (missing) return setFormMsg('err', 'Please fill in the required fields.');

    const payload = {
      name: (f.first.value + ' ' + f.last.value).trim(),
      phone: f.phone.value.trim(),
      email: f.email.value.trim(),
      year: f.year.value.trim(),
      make: f.make.value.trim(),
      model: f.model.value.trim(),
      film: f.film.value,
      package: f.package.value,
      date: f.date.value,
      time: f.time.value,
      source: f.source.value,
      status: f.status.value.toLowerCase(),
      notes: f.notes.value.trim(),
      internal_notes: f.internal_notes.value.trim(),
      send_receipt: f.send_receipt.checked,
      follow_up_date: f.follow_up_date.value,
    };
    $('#saveNew').disabled = true;
    try {
      const data = await api('/api/admin/bookings', { method: 'POST', body: JSON.stringify(payload) });
      state.mode = 'view';
      state.selectedId = data.id;
      state.status = '';
      await loadList();
      let text = 'Booking added and held on the calendar.';
      if (payload.send_receipt) {
        text = data.receipt_sent
          ? 'Booking added. Appointment details emailed to the customer.'
          : 'Booking added, but the customer email could not be sent. Tell them the details by phone.';
      }
      renderDetail({ type: data.receipt_sent === false && payload.send_receipt ? 'err' : 'ok', text });
    } catch (err) {
      $('#saveNew').disabled = false;
      setFormMsg('err', err.message);
    }
  }

  // ---- Wiring ----
  $('#newBtn').addEventListener('click', () => {
    state.mode = 'new';
    state.selectedId = null;
    renderDetail();
  });
  let timer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.q = e.target.value.trim(); loadList(); }, 250);
  });

  loadList();
})();

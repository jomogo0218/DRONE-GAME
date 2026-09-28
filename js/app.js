(function () {
  var Rules = window.ScoreRules;
  var GAME_MS = Rules.GAME_MS;
  var PREP_MS = 5000;
  var tally = Rules.tally;
  var slotsOf = Rules.slotsOf;
  var phase = Rules.phase;
  var buildRoundRobin = Rules.buildRoundRobin;
  var computeStandings = Rules.computeStandings;
  var STORAGE_KEY = 'drone-soccer-score-v1';
  var UI_KEY = 'drone-soccer-ui';
  var RING = 2 * Math.PI * 54;

  var ui = { view: 'board', modal: null, showGoals: false, toastTimer: 0 };
  var arms = new Map();
  var audioCtx = null;
  var state = loadState();

  function blankGames() {
    return [
      { blue: 0, red: 0, played: false },
      { blue: 0, red: 0, played: false },
      { blue: 0, red: 0, played: false }
    ];
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + Math.random().toString(16).slice(2);
  }

  function clampScore(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(99, Math.floor(n));
  }

  function defaultScratch() {
    return {
      id: 'scratch',
      blueName: '藍隊',
      redName: '紅隊',
      games: blankGames(),
      timerRunning: false,
      timerEndsAt: null,
      timerRemainingMs: GAME_MS,
      timerAlerted: false,
      prepRunning: false,
      prepEndsAt: null
    };
  }

  function defaultState() {
    return {
      version: 1,
      eventName: '足球無人機比賽',
      groups: [],
      teams: [],
      matches: [],
      scratch: defaultScratch(),
      activeMatchId: null,
      updatedAt: 0
    };
  }

  function repairMatch(match) {
    var games = blankGames();
    (match.games || []).forEach(function (game, index) {
      if (!games[index] || !game) return;
      games[index].blue = clampScore(game.blue);
      games[index].red = clampScore(game.red);
      games[index].played = Boolean(game.played);
    });
    match.games = games;
    var ms = Number(match.timerRemainingMs);
    if (!isFinite(ms) || ms < 0) ms = GAME_MS;
    if (ms > GAME_MS) ms = GAME_MS;
    match.timerRemainingMs = Math.round(ms);
    match.timerRunning = Boolean(match.timerRunning && match.timerEndsAt);
    match.timerAlerted = Boolean(match.timerAlerted);
    match.prepRunning = Boolean(match.prepRunning && match.prepEndsAt && match.prepEndsAt > Date.now());
    match.prepEndsAt = match.prepRunning ? match.prepEndsAt : null;
    if (match.prepRunning) match.timerRunning = false;
    return match;
  }

  function loadState() {
    var fresh = defaultState();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fresh;
      var data = JSON.parse(raw);
      fresh.eventName = String(data.eventName || fresh.eventName).slice(0, 40);
      fresh.groups = Array.isArray(data.groups) ? data.groups.filter(function (group) {
        return group && group.id && group.name;
      }).map(function (group) {
        return { id: String(group.id), name: String(group.name).slice(0, 20) };
      }) : [];
      fresh.teams = Array.isArray(data.teams) ? data.teams.filter(function (team) {
        return team && team.id && team.groupId && team.name;
      }).map(function (team) {
        return { id: String(team.id), groupId: String(team.groupId), name: String(team.name).slice(0, 16) };
      }) : [];
      fresh.matches = Array.isArray(data.matches) ? data.matches.filter(function (match) {
        return match && match.id && match.blueId && match.redId;
      }).map(function (match) {
        return repairMatch({
          id: String(match.id),
          groupId: String(match.groupId || ''),
          round: Number(match.round) || 1,
          blueId: String(match.blueId),
          redId: String(match.redId),
          games: match.games,
          timerRunning: match.timerRunning,
          timerEndsAt: match.timerEndsAt || null,
          timerRemainingMs: match.timerRemainingMs,
          timerAlerted: match.timerAlerted,
          prepRunning: match.prepRunning,
          prepEndsAt: match.prepEndsAt || null
        });
      }) : [];
      fresh.scratch = repairMatch(Object.assign(defaultScratch(), data.scratch || {}));
      fresh.scratch.id = 'scratch';
      fresh.scratch.blueName = String((data.scratch && data.scratch.blueName) || '藍隊').slice(0, 16);
      fresh.scratch.redName = String((data.scratch && data.scratch.redName) || '紅隊').slice(0, 16);
      fresh.activeMatchId = data.activeMatchId || null;
      if (fresh.activeMatchId && !fresh.matches.some(function (match) { return match.id === fresh.activeMatchId; })) {
        fresh.activeMatchId = null;
      }
      fresh.updatedAt = Number(data.updatedAt) || 0;
      return fresh;
    } catch (error) {
      return fresh;
    }
  }

  function loadUi() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(UI_KEY) || '{}');
      if (['board', 'groups', 'schedule', 'table'].indexOf(saved.view) >= 0) ui.view = saved.view;
      ui.showGoals = Boolean(saved.showGoals);
    } catch (error) { /* 略過壞掉的畫面狀態 */ }
    var requested = new URLSearchParams(location.search).get('view');
    if (['board', 'groups', 'schedule', 'table'].indexOf(requested) >= 0) ui.view = requested;
  }

  function saveUi() {
    sessionStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, showGoals: ui.showGoals }));
  }

  function save() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      showToast('無法儲存，瀏覽器儲存空間不足');
    }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function showToast(text) {
    var host = document.getElementById('toast');
    if (!host) return;
    host.hidden = false;
    host.textContent = text;
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { host.hidden = true; }, 1700);
  }

  function teamsOf(groupId) {
    return state.teams.filter(function (team) { return team.groupId === groupId; });
  }

  function matchesOf(groupId) {
    return state.matches.filter(function (match) { return match.groupId === groupId; });
  }

  function teamName(id) {
    var team = state.teams.find(function (item) { return item.id === id; });
    return team ? team.name : '未命名';
  }

  function scoringMatch() {
    if (state.activeMatchId) {
      var match = state.matches.find(function (item) { return item.id === state.activeMatchId; });
      if (match) return match;
    }
    return state.scratch;
  }

  function isScheduled(match) {
    return Boolean(match.blueId);
  }

  function sideName(match, side) {
    if (!isScheduled(match)) {
      var raw = side === 'blue' ? match.blueName : match.redName;
      var trimmed = String(raw || '').trim();
      return trimmed || (side === 'blue' ? '藍隊' : '紅隊');
    }
    return teamName(side === 'blue' ? match.blueId : match.redId);
  }

  function remainingMs(match) {
    if (match.timerRunning && match.timerEndsAt) return Math.max(0, match.timerEndsAt - Date.now());
    return match.timerRemainingMs;
  }

  function formatClock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  function shownScore(match, result) {
    if (!result.finished) {
      var game = match.games[result.nextIndex];
      return { blue: game.blue, red: game.red };
    }
    var last = result.games[result.games.length - 1];
    return { blue: last ? last.blue : 0, red: last ? last.red : 0 };
  }

  function clearArm(id) {
    var rec = arms.get(id);
    if (!rec) return;
    clearTimeout(rec.zero);
    clearTimeout(rec.ten);
    arms.delete(id);
  }

  function ensureAudio() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function whistle() {
    var ctx = ensureAudio();
    if (!ctx) return;
    var t = ctx.currentTime;
    var duration = 0.55;
    var sampleCount = Math.floor(ctx.sampleRate * duration);
    var buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < sampleCount; i += 1) data[i] = Math.random() * 2 - 1;
    var noise = ctx.createBufferSource();
    noise.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 12;
    filter.frequency.setValueAtTime(1800, t);
    filter.frequency.linearRampToValueAtTime(3000, t + 0.07);
    filter.frequency.linearRampToValueAtTime(2300, t + 0.32);
    var noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.55, t + 0.015);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);
    noise.stop(t + duration);

    var osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2200, t);
    var vibrato = ctx.createOscillator();
    var vibratoGain = ctx.createGain();
    vibrato.frequency.value = 16;
    vibratoGain.gain.value = 70;
    vibrato.connect(vibratoGain);
    vibratoGain.connect(osc.frequency);
    var oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.0001, t);
    oscGain.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    osc.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + 0.5);
    vibrato.stop(t + 0.5);
  }

  function armClocks(match) {
    if (!match) return;
    clearArm(match.id);
    if (match.prepRunning && match.prepEndsAt) {
      arms.set(match.id, {
        zero: setTimeout(function () { finishPrep(match); }, Math.max(0, match.prepEndsAt - Date.now()))
      });
      return;
    }
    if (!match.timerRunning || !match.timerEndsAt) return;
    arms.set(match.id, {
      zero: setTimeout(function () { onTimeUp(match); }, Math.max(0, match.timerEndsAt - Date.now()))
    });
  }

  function onTimeUp(match) {
    if (!match.timerRunning || match.timerAlerted) return;
    if (remainingMs(match) > 40) return;
    match.timerAlerted = true;
    match.timerRunning = false;
    match.timerRemainingMs = 0;
    match.timerEndsAt = null;
    clearArm(match.id);
    save();
    showToast('時間到');
    render();
  }

  function stopPrep(match) {
    if (!match || !match.prepRunning) return;
    match.prepRunning = false;
    match.prepEndsAt = null;
    clearArm(match.id);
  }

  function pauseMatch(match) {
    if (!match) return;
    stopPrep(match);
    if (!match.timerRunning) return;
    match.timerRemainingMs = Math.max(0, match.timerEndsAt - Date.now());
    match.timerRunning = false;
    match.timerEndsAt = null;
    clearArm(match.id);
  }

  function startTimer(match) {
    if (tally(match).finished || match.timerRemainingMs <= 0 || match.prepRunning) return;
    match.timerEndsAt = Date.now() + match.timerRemainingMs;
    match.timerRunning = true;
    match.timerAlerted = false;
  }

  function startPrep(match) {
    if (tally(match).finished || match.timerRemainingMs < GAME_MS) return;
    ensureAudio();
    whistle();
    showToast('哨音');
    match.timerRunning = false;
    match.timerEndsAt = null;
    match.prepEndsAt = Date.now() + PREP_MS;
    match.prepRunning = true;
  }

  function finishPrep(match) {
    if (!match.prepRunning) return;
    if (match.prepEndsAt && match.prepEndsAt - Date.now() > 80) return;
    match.prepRunning = false;
    match.prepEndsAt = null;
    clearArm(match.id);
    if (!tally(match).finished && match.timerRemainingMs > 0) {
      match.timerEndsAt = Date.now() + match.timerRemainingMs;
      match.timerRunning = true;
      match.timerAlerted = false;
    }
    save();
    showToast('開始計時');
    render();
  }

  function rewindClock(match) {
    clearArm(match.id);
    match.prepRunning = false;
    match.prepEndsAt = null;
    match.timerRunning = false;
    match.timerEndsAt = null;
    match.timerRemainingMs = GAME_MS;
    match.timerAlerted = false;
  }

  function prepSeconds(match) {
    var ms = Math.max(0, match.prepEndsAt - Date.now());
    return Math.max(1, Math.ceil(ms / 1000));
  }

  function updateClockDom() {
    var match = scoringMatch();
    if (match.prepRunning) {
      var prepMs = Math.max(0, match.prepEndsAt - Date.now());
      if (prepMs <= 0) {
        finishPrep(match);
        return;
      }
      var sec = String(prepSeconds(match));
      document.querySelectorAll('[data-clock]').forEach(function (el) { el.textContent = sec; });
      document.querySelectorAll('[data-seconds]').forEach(function (el) { el.textContent = sec; });
      document.querySelectorAll('[data-remain-label]').forEach(function (el) { el.textContent = '準備'; });
      var prepRing = document.querySelector('[data-ring]');
      if (prepRing) {
        var prepRatio = Math.max(0, Math.min(1, prepMs / PREP_MS));
        prepRing.style.strokeDasharray = String(RING);
        prepRing.style.strokeDashoffset = String(RING * (1 - prepRatio));
      }
      var prepClock = document.querySelector('.clock');
      if (prepClock) {
        prepClock.classList.add('is-prep');
        prepClock.classList.remove('is-warn', 'is-danger', 'is-zero');
      }
      document.title = sec + '　準備開始';
      return;
    }
    var ms = remainingMs(match);
    var text = formatClock(ms);
    document.querySelectorAll('[data-clock]').forEach(function (el) { el.textContent = text; });
    document.querySelectorAll('[data-seconds]').forEach(function (el) { el.textContent = String(Math.ceil(ms / 1000)); });
    document.querySelectorAll('[data-remain-label]').forEach(function (el) { el.textContent = '剩餘'; });
    var ring = document.querySelector('[data-ring]');
    if (ring) {
      var ratio = Math.max(0, Math.min(1, ms / GAME_MS));
      ring.style.strokeDasharray = String(RING);
      ring.style.strokeDashoffset = String(RING * (1 - ratio));
    }
    var clock = document.querySelector('.clock');
    if (clock) {
      clock.classList.remove('is-prep');
      clock.classList.toggle('is-warn', ms > 0 && ms <= 30000);
      clock.classList.toggle('is-danger', ms > 0 && ms <= 10000);
      clock.classList.toggle('is-zero', ms <= 0);
    }
    document.title = match.timerRunning ? (text + '　足球無人機計分') : '足球無人機計分器';
    if (match.timerRunning && ms <= 0 && !match.timerAlerted) onTimeUp(match);
  }

  function render() {
    var active = document.activeElement;
    var focusKey = active && active.getAttribute('data-focus');
    var caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    document.body.dataset.view = ui.view;
    document.getElementById('app').innerHTML = renderHeader() + renderMain() + renderModal();
    if (focusKey && window.CSS && CSS.escape) {
      var next = document.querySelector('[data-focus="' + CSS.escape(focusKey) + '"]');
      if (next) {
        next.focus();
        if (caret != null && next.setSelectionRange) {
          var pos = Math.min(caret, next.value.length);
          next.setSelectionRange(pos, pos);
        }
      }
    } else {
      var auto = document.querySelector('[data-autofocus]');
      if (auto) auto.focus();
    }
    updateClockDom();
    armClocks(scoringMatch());
    saveUi();
  }

  function renderHeader() {
    function tab(view, label) {
      return '<button type="button" data-action="set-view" data-view="' + view + '" class="' + (ui.view === view ? 'is-on' : '') + '">' + label + '</button>';
    }
    return '<header class="topbar"><div class="brand"><span class="mark" aria-hidden="true"></span><div><strong>足球無人機計分</strong><small>' + esc(state.eventName) + '</small></div></div><nav class="nav">' +
      tab('board', '計分') + tab('groups', '分組') + tab('schedule', '賽程') + tab('table', '積分榜') +
      '</nav></header>';
  }

  function renderMain() {
    if (ui.view === 'groups') return renderGroups();
    if (ui.view === 'schedule') return renderSchedule();
    if (ui.view === 'table') return renderTable();
    return renderBoard();
  }

  function renderBoard() {
    var match = scoringMatch();
    var result = tally(match);
    var slots = slotsOf(match);
    var score = shownScore(match, result);
    var blue = sideName(match, 'blue');
    var red = sideName(match, 'red');
    var context = isScheduled(match)
      ? esc((groupName(match.groupId) || '分組') + ' · 第 ' + match.round + ' 輪')
      : '快速計分 · 左藍右紅';
    var locked = result.finished || Boolean(match.prepRunning);
    return '<main class="board"><section class="side side-blue">' + sideBlock('blue', blue, score.blue, locked) +
      '</section><section class="hub">' + hubBlock(match, result, slots, context, blue, red) +
      '</section><section class="side side-red">' + sideBlock('red', red, score.red, locked) + '</section></main>';
  }

  function sideBlock(side, name, score, locked) {
    var carpet = side === 'blue' ? '藍邊' : '紅邊';
    var nameHtml = isScheduled(scoringMatch())
      ? '<h2 class="team-title">' + esc(name) + '</h2>'
      : '<input class="team-name" data-action="scratch-name" data-side="' + side + '" data-focus="' + side + '-name" maxlength="16" value="' + esc(side === 'blue' ? state.scratch.blueName : state.scratch.redName) + '" aria-label="' + carpet + '隊名" />';
    return '<div class="side-head">' + nameHtml + '<div class="carpet">' + carpet + '</div></div>' +
      '<div class="score"><div class="score-label">本局進球</div><b class="score-num num" data-score="' + side + '">' + score + '</b></div>' +
      '<div class="goal-wrap"><button type="button" class="goal" data-action="goal" data-side="' + side + '" data-delta="1" ' + (locked ? 'disabled' : '') + ' aria-label="' + esc(name) + '進球"><strong>+1</strong><span>進球</span></button>' +
      '<button type="button" class="linkish" data-action="goal" data-side="' + side + '" data-delta="-1" ' + (locked || score <= 0 ? 'disabled' : '') + '>收回 1 球</button></div>';
  }

  function hubBlock(match, result, slots, context, blue, red) {
    var kicker = result.finished ? '比賽結束' : match.prepRunning ? '準備開始' : ('第 ' + (result.nextIndex + 1) + ' 局');
    var clock = result.finished ? resultClock(match, result, blue, red) : liveClock(match);
    var remain = result.finished ? '' : '<p class="remain"><span data-remain-label>' + (match.prepRunning ? '準備' : '剩餘') + '</span> <b class="num" data-seconds>' + (match.prepRunning ? prepSeconds(match) : Math.ceil(remainingMs(match) / 1000)) + '</b> 秒</p>';
    var actions = result.finished ? '' : liveActions(match);
    var next = '';
    if (isScheduled(match) && result.finished) {
      var upcoming = nextOpenMatch(match.id);
      if (upcoming) next = '<button type="button" data-action="next-match">下一場</button>';
    }
    var undo = match.games.some(function (game) { return game.played; })
      ? '<button type="button" data-action="undo-game">撤回上一局</button>' : '';
    var jump = isScheduled(match)
      ? '<button type="button" data-action="open-scratch">快速計分</button>'
      : '<button type="button" data-action="set-view" data-view="schedule">選擇賽程</button>';
    return '<p class="context">' + context + '</p><h2 class="kicker">' + kicker + '</h2>' + clock + remain +
      '<p class="series">勝局 <span class="num blue">' + result.blueWins + '</span><span class="colon">:</span><span class="num red">' + result.redWins + '</span></p>' +
      '<div class="pips">' + slots.map(function (slot) { return pipHtml(slot); }).join('') + '</div>' +
      actions +
      '<div class="minor">' + undo + '<button type="button" data-action="swap-sides">交換左右</button><button type="button" data-action="reset-match">清空比分</button>' + jump + next + '<span class="hint">哨音後倒數 5 秒，接著開始 3 分鐘計時</span></div>';
  }

  function pipHtml(slot) {
    if (slot.state === 'played') {
      var klass = slot.winner === 'blue' ? 'is-blue' : slot.winner === 'red' ? 'is-red' : 'is-draw';
      var label = slot.winner === 'draw' ? '平手' : (slot.winner === 'blue' ? '藍勝' : '紅勝');
      return '<div class="pip ' + klass + '"><span>第' + (slot.index + 1) + '局</span><b class="num">' + slot.blue + ':' + slot.red + '</b><span>' + label + '</span></div>';
    }
    if (slot.state === 'voided') return '<div class="pip">第' + (slot.index + 1) + '局<br>不採計</div>';
    if (slot.state === 'skipped') return '<div class="pip">第' + (slot.index + 1) + '局<br>不進行</div>';
    if (slot.state === 'current') return '<div class="pip is-current">第' + (slot.index + 1) + '局<br>進行中</div>';
    return '<div class="pip">第' + (slot.index + 1) + '局<br>未開始</div>';
  }

  function liveClock(match) {
    if (match.prepRunning) {
      var prepMs = Math.max(0, match.prepEndsAt - Date.now());
      return '<button type="button" class="clock is-prep" data-action="toggle-timer" aria-label="取消準備倒數">' +
        clockSvg(prepMs, PREP_MS) + '<span class="clock-readout num" data-clock>' + prepSeconds(match) + '</span></button>';
    }
    var ms = remainingMs(match);
    var disabled = !match.timerRunning && ms <= 0;
    var zone = ms <= 0 ? 'is-zero' : ms <= 10000 ? 'is-danger' : ms <= 30000 ? 'is-warn' : '';
    return '<button type="button" class="clock ' + zone + '" data-action="toggle-timer" ' + (disabled ? 'disabled' : '') + ' aria-label="開始或暫停倒數">' +
      clockSvg(ms, GAME_MS) + '<span class="clock-readout num" data-clock>' + formatClock(ms) + '</span></button>';
  }

  function resultClock(match, result, blue, red) {
    var headline = result.draw ? '平手' : sideName(match, result.winner);
    var sub = result.draw ? '雙方不計勝場' : '獲得勝場';
    return '<div class="clock is-zero" role="img" aria-label="' + esc(headline + sub) + '"><div><div class="clock-readout num">' + result.blueWins + ':' + result.redWins + '</div><p class="result-sub">' + esc(sub) + '</p></div></div><p class="result-name">' + esc(headline) + '</p>';
  }

  function clockSvg(ms, total) {
    var ratio = Math.max(0, Math.min(1, ms / total));
    var offset = RING * (1 - ratio);
    return '<svg viewBox="0 0 120 120" aria-hidden="true"><circle class="ring-bg" cx="60" cy="60" r="54"></circle><circle class="ring" data-ring cx="60" cy="60" r="54" style="stroke-dasharray:' + RING + ';stroke-dashoffset:' + offset + '"></circle></svg>';
  }

  function liveActions(match) {
    var running = match.timerRunning;
    var preparing = Boolean(match.prepRunning);
    var done = !running && !preparing && match.timerRemainingMs <= 0;
    var label = preparing ? '取消' : running ? '暫停' : done ? '時間到' : (match.timerRemainingMs < GAME_MS ? '繼續倒數' : '開始');
    var attention = done ? ' attn' : '';
    var mainClass = preparing || running ? ' is-pause' : '';
    return '<div class="hub-actions"><button type="button" class="btn-main' + mainClass + '" data-action="toggle-timer" ' + (done ? 'disabled' : '') + '>' + label + '</button>' +
      '<button type="button" class="btn-line" data-action="reset-timer">回到 3:00</button>' +
      '<button type="button" class="btn-end' + attention + '" data-action="end-game" ' + (preparing ? 'disabled' : '') + '>結束本局</button></div>';
  }

  function renderGroups() {
    var cards = state.groups.map(renderGroupCard).join('');
    var empty = state.groups.length ? '' : '<section class="empty"><h2>先建立分組</h2><p class="lede">計分畫面現在就能用。若要記分組循環賽，請新增分組並加入隊伍，或先載入示範。</p><div class="row-actions"><button type="button" class="btn btn-primary" data-action="add-group">新增分組</button><button type="button" class="btn" data-action="load-demo">載入示範</button></div></section>';
    return '<main class="sheet"><div class="wrap"><div class="sheet-head"><div><h2>分組與賽制</h2><p class="lede">比分存在這台瀏覽器，重新整理不會消失。</p></div><div class="row-actions no-print"><button type="button" class="btn btn-primary" data-action="add-group">新增分組</button><button type="button" class="btn" data-action="generate-all">產生全部賽程</button><button type="button" class="btn" data-action="load-demo">載入示範</button></div></div>' +
      '<label class="inline">賽事名稱 <input class="event-name" data-action="event-name" data-focus="event-name" maxlength="40" value="' + esc(state.eventName) + '" /></label>' +
      empty + cards +
      '<details class="card rules" ' + (state.groups.length ? '' : 'open') + '><summary>賽制說明</summary><ul>' +
      '<li>分區賽採分組循環賽，每隊和其他隊各打一場。</li>' +
      '<li>每場最多 3 局，每局 3 分鐘。按下開始會先吹哨，再倒數 5 秒，數完才開始 3 分鐘計時。計分畫面左邊是藍邊、右邊是紅邊。</li>' +
      '<li>單局進球較多的一邊贏得該局；進球相同則該局平手。</li>' +
      '<li>先贏得 2 局者立刻獲得這場比賽的勝場，剩下的局不再進行。</li>' +
      '<li>若 3 局打完仍沒有人拿到 2 個勝局，勝局數較多者獲得勝場；勝局數相同則為平手，雙方都不計勝場。</li>' +
      '<li>排名只看勝場數。積分等於勝場數，平手不加分。</li>' +
      '<li>不比較總進球、總失球或淨勝球。積分相同就並列。</li>' +
      '<li>各分組前 3 名晉級準決賽。並列以致無法決定前 3 名時，標示為晉級待裁定。</li>' +
      '</ul></details><div class="row-actions no-print"><button type="button" class="btn" data-action="export-data">匯出備份</button><label class="btn">匯入備份<input type="file" accept="application/json" data-action="import-file" hidden /></label><button type="button" class="btn btn-danger" data-action="clear-all">清除全部資料</button></div></div></main>';
  }

  function renderGroupCard(group) {
    var roster = teamsOf(group.id);
    var matches = matchesOf(group.id);
    var locked = matches.length > 0;
    var teams = roster.map(function (team, index) {
      return '<li><span class="seed">' + (index + 1) + '</span><input class="team-edit" data-action="rename-team" data-id="' + esc(team.id) + '" data-focus="team-' + esc(team.id) + '" maxlength="16" value="' + esc(team.name) + '" ' + (locked ? 'readonly' : '') + ' /><span class="row-actions">' +
        (locked ? '' : '<button type="button" class="text-btn" data-action="move-team" data-id="' + esc(team.id) + '" data-dir="-1">上移</button><button type="button" class="text-btn" data-action="move-team" data-id="' + esc(team.id) + '" data-dir="1">下移</button><button type="button" class="text-btn text-danger" data-action="delete-team" data-id="' + esc(team.id) + '">移除</button>') +
        '</span></li>';
    }).join('');
    var add = locked ? '<p class="lede">已產生賽程。要改名單，請先清除這組賽程。</p>' :
      '<form class="team-add" data-action="add-team" data-group="' + esc(group.id) + '"><input name="name" maxlength="16" placeholder="輸入隊名" required /><button type="submit">加入隊伍</button></form>';
    var scheduleBtn = locked
      ? '<button type="button" class="btn" data-action="clear-group" data-id="' + esc(group.id) + '">清除這組賽程</button>'
      : '<button type="button" class="btn btn-primary" data-action="generate-group" data-id="' + esc(group.id) + '">產生循環賽</button>';
    return '<section class="card"><div class="sheet-head"><input class="group-name" data-action="rename-group" data-id="' + esc(group.id) + '" data-focus="group-' + esc(group.id) + '" maxlength="20" value="' + esc(group.name) + '" aria-label="分組名稱" />' +
      '<div class="row-actions">' + scheduleBtn + '<button type="button" class="btn btn-danger" data-action="delete-group" data-id="' + esc(group.id) + '">刪除分組</button></div></div>' +
      '<p class="lede">' + roster.length + ' 隊' + (matches.length ? ' · 賽程 ' + matches.filter(function (match) { return tally(match).finished; }).length + '/' + matches.length + ' 場已結束' : ' · 隊伍順序會影響對戰組合') + '</p>' +
      '<ul class="team-list">' + teams + '</ul>' + add + '</section>';
  }

  function renderSchedule() {
    if (!state.matches.length) {
      return '<main class="sheet"><div class="wrap"><section class="empty"><h2>還沒有賽程</h2><p class="lede">到分組加入至少 2 隊，再產生循環賽。也可以先用計分畫面做快速計分。</p><button type="button" class="btn btn-primary" data-action="set-view" data-view="groups">前往分組</button></section></div></main>';
    }
    var blocks = state.groups.map(function (group) {
      var matches = matchesOf(group.id);
      if (!matches.length) return '';
      var rounds = [];
      matches.forEach(function (match) {
        if (rounds.indexOf(match.round) < 0) rounds.push(match.round);
      });
      rounds.sort(function (a, b) { return a - b; });
      var done = matches.filter(function (match) { return tally(match).finished; }).length;
      var body = rounds.map(function (round) {
        var rows = matches.filter(function (match) { return match.round === round; }).map(renderMatchRow).join('');
        var bye = teamsOf(group.id).filter(function (team) {
          return !matches.some(function (match) {
            return match.round === round && (match.blueId === team.id || match.redId === team.id);
          });
        });
        var byeText = bye.length ? '<p class="bye">輪空：' + bye.map(function (team) { return esc(team.name); }).join('、') + '</p>' : '';
        return '<div class="round-block"><h4>第 ' + round + ' 輪</h4>' + rows + byeText + '</div>';
      }).join('');
      return '<section class="card"><div class="sheet-head"><h3>' + esc(group.name) + '</h3><span class="lede">已結束 ' + done + '/' + matches.length + '</span></div><div class="match-list">' + body + '</div></section>';
    }).join('');
    return '<main class="sheet"><div class="wrap"><div class="sheet-head"><div><h2>賽程</h2><p class="lede">點一場比賽就會進到左右計分、中間倒數的畫面。</p></div><button type="button" class="btn" data-action="open-scratch">快速計分</button></div>' + blocks + '</div></main>';
  }

  function renderMatchRow(match) {
    var status = phase(match);
    var summary = matchSummary(match);
    var active = state.activeMatchId === match.id ? ' is-on' : '';
    return '<button type="button" class="match-row is-' + status + active + '" data-action="open-match" data-id="' + esc(match.id) + '"><span>第 ' + match.round + ' 輪</span><span class="versus"><i class="dot blue"></i>' + esc(teamName(match.blueId)) + '<span class="vs">對</span><i class="dot red"></i>' + esc(teamName(match.redId)) + '</span><span class="meta">' + esc(summary) + '</span></button>';
  }

  function matchSummary(match) {
    var result = tally(match);
    var status = phase(match);
    if (match.prepRunning) return '準備倒數 5 秒';
    if (status === 'ready') return '未開始';
    if (status === 'live') return '第 ' + (result.nextIndex + 1) + ' 局 · 勝局 ' + result.blueWins + ':' + result.redWins;
    if (status === 'draw') return '平手 · 勝局 ' + result.blueWins + ':' + result.redWins;
    return sideName(match, result.winner) + ' 勝 · 勝局 ' + result.blueWins + ':' + result.redWins;
  }

  function renderTable() {
    if (!state.groups.length) {
      return '<main class="sheet"><div class="wrap"><section class="empty"><h2>還沒有積分榜</h2><p class="lede">建立分組並打完比賽後，這裡會依勝場數排名。</p></section></div></main>';
    }
    var blocks = state.groups.map(renderGroupTable).join('');
    return '<main class="sheet"><div class="wrap"><div class="sheet-head"><div><h2>積分榜</h2><p class="lede">積分等於勝場數。不比較淨勝球，積分相同就並列。各組前 3 名晉級準決賽。</p></div><div class="row-actions no-print"><button type="button" class="btn" data-action="toggle-goals">' + (ui.showGoals ? '隱藏進失球' : '顯示進失球（不排名）') + '</button><button type="button" class="btn" data-action="copy-table">複製文字</button><button type="button" class="btn" data-action="print-table">列印</button></div></div>' + blocks + '</div></main>';
  }

  function groupRows(group) {
    return computeStandings(teamsOf(group.id), matchesOf(group.id));
  }

  function groupComplete(group) {
    var matches = matchesOf(group.id);
    return matches.length > 0 && matches.every(function (match) { return tally(match).finished; });
  }

  function qualifyLabel(row, complete) {
    if (row.qualification === 'pending') return { text: '—', klass: '' };
    if (row.qualification === 'tie') return { text: complete ? '並列待裁定' : '暫定並列', klass: 'tie' };
    if (row.qualification === 'in') return { text: complete ? '晉級準決賽' : '暫定晉級', klass: 'in' };
    return { text: complete ? '未晉級' : '—', klass: complete ? 'out' : '' };
  }

  function renderGroupTable(group) {
    var rows = groupRows(group);
    var matches = matchesOf(group.id);
    var complete = groupComplete(group);
    var note = !matches.length ? '尚未產生賽程。' : complete ? '賽程已全部結束。' : '賽程尚未結束，以下是暫定排名。';
    var qualified = rows.filter(function (row) { return row.qualification === 'in'; });
    var tied = rows.filter(function (row) { return row.qualification === 'tie'; });
    var summary = '';
    if (matches.length && rows.some(function (row) { return row.played > 0; })) {
      if (complete && !tied.length) summary = '<p class="lede">晉級準決賽：' + (qualified.map(function (row) { return esc(row.name); }).join('、') || '無') + '</p>';
      else if (tied.length) summary = '<p class="lede">這些隊伍勝場相同，規程沒有其他比較方式，需另行裁定：' + tied.map(function (row) { return esc(row.name); }).join('、') + '</p>';
    }
    var goalHead = ui.showGoals ? '<th class="num">進球</th><th class="num">失球</th>' : '';
    var body = rows.map(function (row) {
      var badge = qualifyLabel(row, complete);
      var goalCells = ui.showGoals ? '<td class="num">' + row.goalsFor + '</td><td class="num">' + row.goalsAgainst + '</td>' : '';
      return '<tr class="' + (badge.klass === 'in' ? 'row-in' : badge.klass === 'tie' ? 'row-tie' : '') + '"><td class="num">' + (row.rank == null ? '—' : row.rank) + '</td><td>' + esc(row.name) + '</td><td class="num">' + row.played + '</td><td class="num">' + row.won + '</td><td class="num">' + row.drawn + '</td><td class="num">' + row.lost + '</td><td class="num">' + row.points + '</td>' + goalCells + '<td>' + (badge.text === '—' ? '—' : '<span class="badge ' + badge.klass + '">' + badge.text + '</span>') + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>' + esc(group.name) + '</h3><p class="lede">' + note + '</p>' + summary +
      '<table class="standings"><thead><tr><th class="num">排名</th><th>隊伍</th><th class="num">已賽</th><th class="num">勝</th><th class="num">平</th><th class="num">負</th><th class="num">積分</th>' + goalHead + '<th>晉級</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="8">這個分組還沒有隊伍。</td></tr>') + '</tbody></table><p class="footnote">平、負和進失球只供查閱。排序只使用積分，積分就是勝場數。</p></section>';
  }

  function renderModal() {
    if (!ui.modal) return '';
    var modal = ui.modal;
    var okFocus = modal.focus === 'ok' ? ' data-autofocus="true"' : '';
    var cancelFocus = modal.focus !== 'ok' ? ' data-autofocus="true"' : '';
    return '<div class="modal-back" data-action="modal-cancel"><div class="modal" role="dialog" aria-modal="true" data-action="noop"><h3>' + esc(modal.title) + '</h3><p>' + esc(modal.body) + '</p><div class="modal-actions"><button type="button" class="btn" data-action="modal-cancel"' + cancelFocus + '>' + esc(modal.cancel || '取消') + '</button><button type="button" class="btn btn-primary" data-action="modal-ok"' + okFocus + '>' + esc(modal.ok || '確定') + '</button></div></div></div>';
  }

  function ask(options) {
    ui.modal = options;
    render();
  }

  function groupName(id) {
    var group = state.groups.find(function (item) { return item.id === id; });
    return group ? group.name : '';
  }

  function nextGroupName() {
    var used = {};
    state.groups.forEach(function (group) { used[group.name] = true; });
    var letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (var i = 0; i < letters.length; i += 1) {
      var name = '分組 ' + letters.charAt(i);
      if (!used[name]) return name;
    }
    return '分組 ' + (state.groups.length + 1);
  }

  function makeMatches(groupId) {
    var rounds = buildRoundRobin(teamsOf(groupId).map(function (team) { return team.id; }));
    var list = [];
    rounds.forEach(function (round) {
      round.pairs.forEach(function (pair) {
        list.push(repairMatch({
          id: uid(),
          groupId: groupId,
          round: round.round,
          blueId: pair.blueId,
          redId: pair.redId,
          games: blankGames(),
          timerRunning: false,
          timerEndsAt: null,
          timerRemainingMs: GAME_MS,
          timerAlerted: false,
          prepRunning: false,
          prepEndsAt: null
        }));
      });
    });
    return list;
  }

  function nextOpenMatch(afterId) {
    var ordered = state.matches.slice().sort(function (a, b) {
      var groups = state.groups.map(function (group) { return group.id; });
      var ga = groups.indexOf(a.groupId) - groups.indexOf(b.groupId);
      if (ga) return ga;
      return a.round - b.round;
    });
    var index = ordered.findIndex(function (match) { return match.id === afterId; });
    var rest = index >= 0 ? ordered.slice(index + 1).concat(ordered.slice(0, index)) : ordered;
    return rest.find(function (match) { return !tally(match).finished; }) || null;
  }

  function openMatch(id) {
    pauseMatch(scoringMatch());
    state.activeMatchId = id;
    ui.view = 'board';
    save();
    render();
  }

  var actions = {
    noop: function () {},
    'set-view': function (el) {
      ui.view = el.dataset.view;
      render();
    },
    goal: function (el) {
      var match = scoringMatch();
      var result = tally(match);
      if (result.finished || match.prepRunning) return;
      var side = el.dataset.side === 'red' ? 'red' : 'blue';
      var delta = Number(el.dataset.delta) || 0;
      var game = match.games[result.nextIndex];
      var next = clampScore(game[side] + delta);
      if (next === game[side]) return;
      game[side] = next;
      if (delta > 0 && navigator.vibrate) navigator.vibrate(12);
      save();
      render();
    },
    'toggle-timer': function () {
      var match = scoringMatch();
      if (match.prepRunning) stopPrep(match);
      else if (match.timerRunning) pauseMatch(match);
      else if (!tally(match).finished && match.timerRemainingMs >= GAME_MS) startPrep(match);
      else startTimer(match);
      save();
      render();
    },
    'reset-timer': function () {
      rewindClock(scoringMatch());
      save();
      render();
    },
    'end-game': function () { requestEndGame(); },
    'undo-game': function () {
      var match = scoringMatch();
      var last = -1;
      match.games.forEach(function (game, index) { if (game.played) last = index; });
      if (last < 0) return;
      match.games[last].played = false;
      rewindClock(match);
      save();
      showToast('已撤回上一局');
      render();
    },
    'swap-sides': function () { requestSwap(); },
    'reset-match': function () { requestReset(); },
    'open-scratch': function () {
      pauseMatch(scoringMatch());
      state.activeMatchId = null;
      ui.view = 'board';
      save();
      render();
    },
    'open-match': function (el) { openMatch(el.dataset.id); },
    'next-match': function () {
      var upcoming = nextOpenMatch(scoringMatch().id);
      if (upcoming) openMatch(upcoming.id);
    },
    'modal-cancel': function () {
      ui.modal = null;
      render();
    },
    'modal-ok': function () {
      var action = ui.modal && ui.modal.onOk;
      ui.modal = null;
      if (action) action();
      if (!ui.modal) render();
    },
    'add-group': function () {
      state.groups.push({ id: uid(), name: nextGroupName() });
      save();
      ui.view = 'groups';
      render();
    },
    'delete-group': function (el) {
      var group = state.groups.find(function (item) { return item.id === el.dataset.id; });
      if (!group) return;
      ask({
        title: '刪除' + group.name,
        body: '這組的隊伍、賽程和比分會一起刪除。',
        ok: '刪除',
        focus: 'cancel',
        onOk: function () {
          if (state.activeMatchId && matchesOf(group.id).some(function (match) { return match.id === state.activeMatchId; })) {
            pauseMatch(scoringMatch());
            state.activeMatchId = null;
          }
          state.groups = state.groups.filter(function (item) { return item.id !== group.id; });
          state.teams = state.teams.filter(function (team) { return team.groupId !== group.id; });
          state.matches = state.matches.filter(function (match) { return match.groupId !== group.id; });
          save();
        }
      });
    },
    'delete-team': function (el) {
      var team = state.teams.find(function (item) { return item.id === el.dataset.id; });
      if (!team || matchesOf(team.groupId).length) return;
      state.teams = state.teams.filter(function (item) { return item.id !== team.id; });
      save();
      render();
    },
    'move-team': function (el) {
      var team = state.teams.find(function (item) { return item.id === el.dataset.id; });
      if (!team || matchesOf(team.groupId).length) return;
      var roster = teamsOf(team.groupId);
      var index = roster.findIndex(function (item) { return item.id === team.id; });
      var target = roster[index + Number(el.dataset.dir)];
      if (!target) return;
      var from = state.teams.indexOf(team);
      var to = state.teams.indexOf(target);
      var copy = state.teams[from];
      state.teams[from] = state.teams[to];
      state.teams[to] = copy;
      save();
      render();
    },
    'generate-group': function (el) { generateGroup(el.dataset.id, false); },
    'generate-all': function () {
      var ready = state.groups.filter(function (group) {
        return teamsOf(group.id).length >= 2 && matchesOf(group.id).length === 0;
      });
      if (!ready.length) {
        showToast('沒有可產生賽程的分組');
        return;
      }
      ready.forEach(function (group) { state.matches = state.matches.concat(makeMatches(group.id)); });
      save();
      ui.view = 'schedule';
      showToast('已產生 ' + ready.length + ' 組賽程');
      render();
    },
    'clear-group': function (el) {
      var group = state.groups.find(function (item) { return item.id === el.dataset.id; });
      if (!group) return;
      ask({
        title: '清除' + group.name + '賽程',
        body: '這組已登錄的比分會刪除，隊伍名單會保留。',
        ok: '清除',
        focus: 'cancel',
        onOk: function () {
          if (state.activeMatchId && matchesOf(group.id).some(function (match) { return match.id === state.activeMatchId; })) state.activeMatchId = null;
          state.matches = state.matches.filter(function (match) { return match.groupId !== group.id; });
          save();
        }
      });
    },
    'load-demo': function () { requestDemo(); },
    'export-data': function () { exportData(); },
    'clear-all': function () {
      ask({
        title: '清除全部資料',
        body: '分組、賽程、比分和快速計分都會刪除。',
        ok: '全部清除',
        focus: 'cancel',
        onOk: function () {
          clearArm('scratch');
          state.matches.forEach(function (match) { clearArm(match.id); });
          state = defaultState();
          save();
          ui.view = 'board';
        }
      });
    },
    'toggle-goals': function () {
      ui.showGoals = !ui.showGoals;
      render();
    },
    'copy-table': function () { copyTable(); },
    'print-table': function () { window.print(); }
  };

  function requestEndGame() {
    var match = scoringMatch();
    var result = tally(match);
    if (result.finished || match.prepRunning) return;
    var game = match.games[result.nextIndex];
    var blue = sideName(match, 'blue');
    var red = sideName(match, 'red');
    var verdict = game.blue === game.red ? '比分相同，本局平手，雙方都未贏得這一局。' : (game.blue > game.red ? blue + ' 贏得本局。' : red + ' 贏得本局。');
    var blueWins = result.blueWins + (game.blue > game.red ? 1 : 0);
    var redWins = result.redWins + (game.red > game.blue ? 1 : 0);
    var extra = '結束後進入下一局，倒數回到 3:00。';
    if (blueWins >= 2) extra = blue + ' 將取得 2 勝局，本場比賽結束，後面的局不進行。';
    else if (redWins >= 2) extra = red + ' 將取得 2 勝局，本場比賽結束，後面的局不進行。';
    else if (result.nextIndex === 2 && blueWins === redWins) extra = '三局結束且勝局數相同，本場記為平手。';
    else if (result.nextIndex === 2) extra = '三局結束，勝局數較多的一方獲得勝場。';
    ask({
      title: '結束第 ' + (result.nextIndex + 1) + ' 局',
      body: '比分 ' + game.blue + '：' + game.red + '\n' + verdict + '\n' + extra,
      ok: '確定結束',
      cancel: '返回',
      focus: 'ok',
      onOk: function () { finishCurrentGame(match); }
    });
  }

  function finishCurrentGame(match) {
    var result = tally(match);
    if (result.finished || result.nextIndex == null) return;
    match.games[result.nextIndex].played = true;
    rewindClock(match);
    save();
    var after = tally(match);
    if (after.finished && after.draw) showToast('本場平手，雙方不計勝場');
    else if (after.finished) showToast(sideName(match, after.winner) + ' 獲得勝場');
    else showToast('進入第 ' + (after.nextIndex + 1) + ' 局');
  }

  function requestSwap() {
    var match = scoringMatch();
    var dirty = match.games.some(function (game) { return game.played || game.blue || game.red; });
    var run = function () {
      if (isScheduled(match)) {
        var blueId = match.blueId;
        match.blueId = match.redId;
        match.redId = blueId;
      } else {
        var blueName = match.blueName;
        match.blueName = match.redName;
        match.redName = blueName;
      }
      match.games.forEach(function (game) {
        var blue = game.blue;
        game.blue = game.red;
        game.red = blue;
      });
      save();
    };
    if (!dirty) {
      run();
      render();
      return;
    }
    ask({
      title: '交換左右',
      body: '藍邊和紅邊的隊伍，以及已經記下的比分，會整場對調。',
      ok: '交換',
      focus: 'cancel',
      onOk: run
    });
  }

  function requestReset() {
    ask({
      title: '清空這場比分',
      body: '三局的進球和勝局都會清掉，倒數回到 3:00。隊名會保留。',
      ok: '清空',
      focus: 'cancel',
      onOk: function () {
        var match = scoringMatch();
        match.games = blankGames();
        rewindClock(match);
        save();
      }
    });
  }

  function generateGroup(groupId, silent) {
    var roster = teamsOf(groupId);
    if (roster.length < 2) {
      if (!silent) showToast('至少需要 2 隊');
      return false;
    }
    if (matchesOf(groupId).length) {
      if (!silent) showToast('這組已有賽程');
      return false;
    }
    state.matches = state.matches.concat(makeMatches(groupId));
    save();
    if (!silent) {
      ui.view = 'schedule';
      showToast('已產生循環賽');
      render();
    }
    return true;
  }

  function requestDemo() {
    var run = function () {
      var groupA = uid();
      var groupB = uid();
      state.groups = [{ id: groupA, name: '分組 A' }, { id: groupB, name: '分組 B' }];
      state.teams = ['青鋒', '迅翼', '雷霆', '星航'].map(function (name) {
        return { id: uid(), groupId: groupA, name: name };
      }).concat(['破風', '逐日', '凌雲', '熾空'].map(function (name) {
        return { id: uid(), groupId: groupB, name: name };
      }));
      state.matches = [];
      state.groups.forEach(function (group) { state.matches = state.matches.concat(makeMatches(group.id)); });
      pauseMatch(state.scratch);
      state.activeMatchId = state.matches[0] ? state.matches[0].id : null;
      ui.view = 'board';
      save();
      showToast('已載入示範賽程');
    };
    if (state.groups.length || state.matches.some(function (match) { return phase(match) !== 'ready'; })) {
      ask({
        title: '載入示範分組',
        body: '這會取代目前的分組、賽程和比分。',
        ok: '載入',
        focus: 'cancel',
        onOk: run
      });
      return;
    }
    run();
    render();
  }

  function exportData() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = state.eventName + '-計分備份.json';
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  function importFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ''));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state = loadState();
        ui.view = 'board';
        save();
        showToast('已匯入備份');
        render();
      } catch (error) {
        showToast('這個檔案不是計分備份');
      }
    };
    reader.readAsText(file);
  }

  function copyTable() {
    var lines = [state.eventName, '積分等於勝場數，不比較淨勝球。各組前 3 名晉級準決賽。', ''];
    state.groups.forEach(function (group) {
      var complete = groupComplete(group);
      lines.push(group.name + (complete ? '（賽程已結束）' : '（暫定）'));
      groupRows(group).forEach(function (row) {
        var badge = qualifyLabel(row, complete).text;
        lines.push([(row.rank == null ? '-' : row.rank), row.name, '已賽' + row.played, '勝' + row.won, '平' + row.drawn, '負' + row.lost, '積分' + row.points, badge].join('　'));
      });
      lines.push('');
    });
    var text = lines.join('\n');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { showToast('已複製積分榜'); }, function () { fallbackCopy(text); });
    } else fallbackCopy(text);
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    showToast('已複製積分榜');
  }

  function onClick(event) {
    var el = event.target.closest('[data-action]');
    if (!el || !document.getElementById('app').contains(el)) return;
    var fn = actions[el.dataset.action];
    if (!fn || el.dataset.action === 'noop') return;
    fn(el, event);
  }

  function onSubmit(event) {
    var form = event.target.closest('form[data-action]');
    if (!form) return;
    event.preventDefault();
    if (form.dataset.action !== 'add-team') return;
    var name = String(new FormData(form).get('name') || '').trim().slice(0, 16);
    if (!name) return;
    if (matchesOf(form.dataset.group).length) {
      showToast('請先清除這組賽程');
      return;
    }
    if (teamsOf(form.dataset.group).some(function (team) { return team.name === name; })) {
      showToast('同組已有相同隊名');
      return;
    }
    state.teams.push({ id: uid(), groupId: form.dataset.group, name: name });
    save();
    render();
  }

  function onChange(event) {
    var el = event.target;
    if (el.dataset.action === 'rename-team') {
      var team = state.teams.find(function (item) { return item.id === el.dataset.id; });
      if (!team) return;
      var name = el.value.trim().slice(0, 16);
      if (!name) { render(); return; }
      if (teamsOf(team.groupId).some(function (item) { return item.id !== team.id && item.name === name; })) {
        showToast('同組已有相同隊名');
        render();
        return;
      }
      team.name = name;
      save();
      render();
    } else if (el.dataset.action === 'rename-group') {
      var group = state.groups.find(function (item) { return item.id === el.dataset.id; });
      if (!group) return;
      group.name = el.value.trim().slice(0, 20) || group.name;
      save();
      render();
    } else if (el.dataset.action === 'event-name') {
      state.eventName = el.value.trim().slice(0, 40) || '足球無人機比賽';
      save();
      render();
    } else if (el.dataset.action === 'import-file') {
      importFile(el.files && el.files[0]);
      el.value = '';
    }
  }

  function onInput(event) {
    var el = event.target;
    if (el.dataset.action !== 'scratch-name') return;
    if (el.dataset.side === 'blue') state.scratch.blueName = el.value.slice(0, 16);
    else state.scratch.redName = el.value.slice(0, 16);
    save();
  }

  function onKey(event) {
    if (event.code !== 'Space') return;
    if (event.target.matches('input, textarea, select')) return;
    if (ui.modal || ui.view !== 'board') return;
    event.preventDefault();
    actions['toggle-timer']();
  }

  loadUi();
  var app = document.getElementById('app');
  app.addEventListener('click', onClick);
  app.addEventListener('submit', onSubmit);
  app.addEventListener('change', onChange);
  app.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') updateClockDom();
  });
  setInterval(function () {
    var match = scoringMatch();
    updateClockDom();
    if (match.prepRunning && match.prepEndsAt - Date.now() <= 0) finishPrep(match);
    else if (match.timerRunning && remainingMs(match) <= 0 && !match.timerAlerted) onTimeUp(match);
  }, 200);
  render();
})();

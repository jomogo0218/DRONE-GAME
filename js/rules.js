(function (root) {
  var GAME_MS = 3 * 60 * 1000;
  var QUALIFY_COUNT = 3;

  function scoreOf(value) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) return 0;
    return Math.min(99, Math.floor(n));
  }

  function tally(match) {
    var games = [];
    var voided = [];
    var blueWins = 0;
    var redWins = 0;
    var locked = false;
    var source = match && match.games ? match.games : [];

    for (var i = 0; i < 3; i += 1) {
      var game = source[i];
      if (!game || !game.played) break;
      var blue = scoreOf(game.blue);
      var red = scoreOf(game.red);
      if (locked) {
        voided.push({ index: i, blue: blue, red: red });
        continue;
      }
      var winner = 'draw';
      if (blue > red) {
        winner = 'blue';
        blueWins += 1;
      } else if (red > blue) {
        winner = 'red';
        redWins += 1;
      }
      games.push({ index: i, blue: blue, red: red, winner: winner });
      if (blueWins >= 2 || redWins >= 2) locked = true;
    }

    var clinched = blueWins >= 2 || redWins >= 2;
    var finished = clinched || games.length === 3;
    var draw = finished && !clinched && blueWins === redWins;
    var winner = !finished || draw ? null : (blueWins > redWins ? 'blue' : 'red');

    return {
      games: games,
      voided: voided,
      blueWins: blueWins,
      redWins: redWins,
      clinched: clinched,
      finished: finished,
      draw: draw,
      winner: winner,
      nextIndex: finished ? null : games.length
    };
  }

  function slotsOf(match) {
    var result = tally(match);
    var slots = [];
    for (var i = 0; i < 3; i += 1) {
      var played = null;
      for (var g = 0; g < result.games.length; g += 1) {
        if (result.games[g].index === i) played = result.games[g];
      }
      if (played) {
        slots.push({
          index: i,
          state: 'played',
          blue: played.blue,
          red: played.red,
          winner: played.winner
        });
        continue;
      }
      var skipped = null;
      for (var v = 0; v < result.voided.length; v += 1) {
        if (result.voided[v].index === i) skipped = result.voided[v];
      }
      if (skipped) {
        slots.push({ index: i, state: 'voided', blue: skipped.blue, red: skipped.red });
        continue;
      }
      if (result.clinched) {
        slots.push({ index: i, state: 'skipped' });
        continue;
      }
      slots.push({ index: i, state: result.nextIndex === i ? 'current' : 'upcoming' });
    }
    return slots;
  }

  function phase(match) {
    var result = tally(match);
    if (result.finished) return result.draw ? 'draw' : 'done';
    var current = match.games && match.games[result.nextIndex] ? match.games[result.nextIndex] : { blue: 0, red: 0 };
    var started = result.games.length > 0 || match.timerRunning || scoreOf(current.blue) > 0 || scoreOf(current.red) > 0;
    return started ? 'live' : 'ready';
  }

  function buildRoundRobin(teamIds) {
    var ids = teamIds.slice();
    if (ids.length < 2) return [];
    if (ids.length % 2 === 1) ids.push(null);
    var n = ids.length;
    var half = n / 2;
    var rotation = ids.slice();
    var rounds = [];

    for (var r = 0; r < n - 1; r += 1) {
      var pairs = [];
      for (var i = 0; i < half; i += 1) {
        var blue = rotation[i];
        var red = rotation[n - 1 - i];
        if (!blue || !red) continue;
        if (r % 2 === 1) {
          var swap = blue;
          blue = red;
          red = swap;
        }
        pairs.push({ blueId: blue, redId: red });
      }
      rounds.push({ round: r + 1, pairs: pairs });
      var fixed = rotation[0];
      var rest = rotation.slice(1);
      rest.unshift(rest.pop());
      rotation = [fixed].concat(rest);
    }
    return rounds;
  }

  function computeStandings(teams, matches) {
    var rows = teams.map(function (team) {
      var row = {
        teamId: team.id,
        name: team.name,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        points: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        rank: null,
        qualification: 'pending'
      };
      matches.forEach(function (match) {
        if (match.blueId !== team.id && match.redId !== team.id) return;
        var result = tally(match);
        var side = match.blueId === team.id ? 'blue' : 'red';
        result.games.forEach(function (game) {
          if (side === 'blue') {
            row.goalsFor += game.blue;
            row.goalsAgainst += game.red;
          } else {
            row.goalsFor += game.red;
            row.goalsAgainst += game.blue;
          }
        });
        if (!result.finished) return;
        row.played += 1;
        if (result.draw) row.drawn += 1;
        else if (result.winner === side) row.won += 1;
        else row.lost += 1;
      });
      row.points = row.won;
      return row;
    });

    rows.sort(function (a, b) {
      if (b.points !== a.points) return b.points - a.points;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

    if (!rows.some(function (row) { return row.played > 0; })) return rows;

    var lastPoints = null;
    var lastRank = 0;
    rows.forEach(function (row, index) {
      if (row.points !== lastPoints) {
        lastRank = index + 1;
        lastPoints = row.points;
      }
      row.rank = lastRank;
    });

    var clusters = [];
    rows.forEach(function (row) {
      var last = clusters[clusters.length - 1];
      if (!last || last.rank !== row.rank) clusters.push({ rank: row.rank, rows: [row] });
      else last.rows.push(row);
    });

    var slots = 0;
    clusters.forEach(function (cluster) {
      if (slots >= QUALIFY_COUNT) {
        cluster.rows.forEach(function (row) { row.qualification = 'out'; });
      } else if (slots + cluster.rows.length <= QUALIFY_COUNT) {
        cluster.rows.forEach(function (row) { row.qualification = 'in'; });
        slots += cluster.rows.length;
      } else {
        cluster.rows.forEach(function (row) { row.qualification = 'tie'; });
        slots = QUALIFY_COUNT;
      }
    });
    return rows;
  }

  var api = {
    GAME_MS: GAME_MS,
    QUALIFY_COUNT: QUALIFY_COUNT,
    tally: tally,
    slotsOf: slotsOf,
    phase: phase,
    buildRoundRobin: buildRoundRobin,
    computeStandings: computeStandings
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ScoreRules = api;
})(typeof window !== 'undefined' ? window : globalThis);

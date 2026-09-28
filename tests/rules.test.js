const assert = require('assert/strict');
const rules = require('../js/rules.js');

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('ok  ' + name);
  } catch (error) {
    failed += 1;
    console.error('FAIL ' + name);
    console.error(error);
  }
}

function played(blue, red) {
  return { blue: blue, red: red, played: true };
}

function open() {
  return { blue: 0, red: 0, played: false };
}

test('4 隊循環賽每對只打一場，每隊 3 場', () => {
  const rounds = rules.buildRoundRobin(['a', 'b', 'c', 'd']);
  const pairs = rounds.flatMap((round) => round.pairs);
  assert.equal(pairs.length, 6);
  const keys = pairs.map((pair) => [pair.blueId, pair.redId].sort().join('-'));
  assert.equal(new Set(keys).size, 6);
  ['a', 'b', 'c', 'd'].forEach((id) => {
    const count = pairs.filter((pair) => pair.blueId === id || pair.redId === id).length;
    assert.equal(count, 3);
  });
});

test('3 隊循環賽有 3 場，每隊打 2 場', () => {
  const pairs = rules.buildRoundRobin(['a', 'b', 'c']).flatMap((round) => round.pairs);
  assert.equal(pairs.length, 3);
  ['a', 'b', 'c'].forEach((id) => {
    assert.equal(pairs.filter((pair) => pair.blueId === id || pair.redId === id).length, 2);
  });
});

test('5 隊循環賽有 10 場，每隊打 4 場', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const pairs = rules.buildRoundRobin(ids).flatMap((round) => round.pairs);
  assert.equal(pairs.length, 10);
  ids.forEach((id) => {
    assert.equal(pairs.filter((pair) => pair.blueId === id || pair.redId === id).length, 4);
  });
});

test('先拿 2 勝局就結束，第 3 局不採計', () => {
  const result = rules.tally({
    games: [played(2, 1), played(1, 0), played(0, 9)]
  });
  assert.equal(result.finished, true);
  assert.equal(result.clinched, true);
  assert.equal(result.winner, 'blue');
  assert.equal(result.blueWins, 2);
  assert.equal(result.redWins, 0);
  assert.equal(result.voided.length, 1);
  assert.equal(result.voided[0].red, 9);
  const slots = rules.slotsOf({ games: [played(2, 1), played(1, 0), open()] });
  assert.equal(slots[2].state, 'skipped');
});

test('打完 3 局只有 1 個勝局，仍由勝局數較多者獲得勝場', () => {
  const result = rules.tally({
    games: [played(2, 0), played(1, 1), played(0, 0)]
  });
  assert.equal(result.finished, true);
  assert.equal(result.clinched, false);
  assert.equal(result.draw, false);
  assert.equal(result.winner, 'blue');
  assert.equal(result.blueWins, 1);
});

test('3 局打完勝局數相同則為平手', () => {
  const result = rules.tally({
    games: [played(1, 0), played(0, 2), played(3, 3)]
  });
  assert.equal(result.draw, true);
  assert.equal(result.winner, null);
  assert.equal(result.blueWins, 1);
  assert.equal(result.redWins, 1);
});

test('排名只看勝場，不看淨勝球', () => {
  const teams = [
    { id: 'low', name: '低淨勝' },
    { id: 'high', name: '高淨勝' },
    { id: 'opp1', name: '對一' },
    { id: 'opp2', name: '對二' }
  ];
  const matches = [
    { blueId: 'low', redId: 'opp1', games: [played(1, 0), played(1, 0), open()] },
    { blueId: 'high', redId: 'opp2', games: [played(8, 0), played(1, 0), open()] }
  ];
  const rows = rules.computeStandings(teams, matches);
  const low = rows.find((row) => row.teamId === 'low');
  const high = rows.find((row) => row.teamId === 'high');
  assert.equal(low.points, 1);
  assert.equal(high.points, 1);
  assert.equal(low.rank, high.rank);
  assert.ok(high.goalsFor - high.goalsAgainst > low.goalsFor - low.goalsAgainst);
});

test('勝場較多排名較前，即使淨勝球較少', () => {
  const teams = [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' },
    { id: 'c', name: '丙' },
    { id: 'd', name: '丁' }
  ];
  const matches = [
    { blueId: 'a', redId: 'c', games: [played(1, 0), played(1, 0), open()] },
    { blueId: 'a', redId: 'd', games: [played(1, 0), played(1, 0), open()] },
    { blueId: 'b', redId: 'c', games: [played(9, 0), played(1, 0), open()] }
  ];
  const rows = rules.computeStandings(teams, matches);
  const a = rows.find((row) => row.teamId === 'a');
  const b = rows.find((row) => row.teamId === 'b');
  assert.equal(a.points, 2);
  assert.equal(b.points, 1);
  assert.ok(a.rank < b.rank);
  assert.ok((b.goalsFor - b.goalsAgainst) > (a.goalsFor - a.goalsAgainst));
});

test('提前結束後的第 3 局進球不計入進失球', () => {
  const teams = [
    { id: 'a', name: '甲' },
    { id: 'b', name: '乙' }
  ];
  const rows = rules.computeStandings(teams, [{
    blueId: 'a',
    redId: 'b',
    games: [played(1, 0), played(1, 0), played(0, 5)]
  }]);
  const a = rows.find((row) => row.teamId === 'a');
  assert.equal(a.goalsFor, 2);
  assert.equal(a.goalsAgainst, 0);
  assert.equal(a.points, 1);
});

test('積分不同時前 3 名晉級，第 4 名不晉級', () => {
  const teams = ['甲', '乙', '丙', '丁'].map((name, index) => ({ id: String(index), name: name }));
  const win = (blue, red) => ({
    blueId: blue,
    redId: red,
    games: [played(1, 0), played(1, 0), open()]
  });
  const matches = [
    win('0', '1'), win('0', '2'), win('0', '3'),
    win('1', '2'), win('1', '3'),
    win('2', '3')
  ];
  const rows = rules.computeStandings(teams, matches);
  assert.deepEqual(rows.map((row) => row.points), [3, 2, 1, 0]);
  assert.deepEqual(rows.map((row) => row.qualification), ['in', 'in', 'in', 'out']);
});

test('第 3 名並列時無法只靠勝場決定，標成待裁定', () => {
  const teams = ['甲', '乙', '丙', '丁'].map((name, index) => ({ id: String(index), name: name }));
  const win = (blue, red) => ({
    blueId: blue,
    redId: red,
    games: [played(1, 0), played(1, 0), open()]
  });
  const rows = rules.computeStandings(teams, [win('0', '1'), win('0', '2')]);
  const leader = rows.find((row) => row.teamId === '0');
  const tied = rows.filter((row) => row.teamId !== '0');
  assert.equal(leader.qualification, 'in');
  assert.equal(leader.rank, 1);
  tied.forEach((row) => {
    assert.equal(row.points, 0);
    assert.equal(row.qualification, 'tie');
    assert.equal(row.rank, 2);
  });
});

test('還沒有人打完比賽時不排名', () => {
  const rows = rules.computeStandings(
    [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
    [{ blueId: 'a', redId: 'b', games: [played(1, 0), open(), open()], timerRunning: true }]
  );
  rows.forEach((row) => {
    assert.equal(row.rank, null);
    assert.equal(row.qualification, 'pending');
    assert.equal(row.points, 0);
  });
});

test('平手不加分', () => {
  const rows = rules.computeStandings(
    [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }],
    [{ blueId: 'a', redId: 'b', games: [played(1, 0), played(0, 1), played(0, 0)] }]
  );
  rows.forEach((row) => {
    assert.equal(row.drawn, 1);
    assert.equal(row.points, 0);
    assert.equal(row.won, 0);
  });
});

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all passed');

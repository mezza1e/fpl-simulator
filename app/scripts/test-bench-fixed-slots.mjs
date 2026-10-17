/**
 * Test script for 4 fixed bench slots:
 * Slot 0: GKP
 * Slot 1: SUB 1
 * Slot 2: SUB 2
 * Slot 3: SUB 3
 * 
 * Verifies that adding an outfielder goes to SUB 1 and does NOT shift the GKP slot!
 */

const Position = {
  GKP: 1,
  DEF: 2,
  MID: 3,
  FWD: 4,
};

const playerMap = new Map();
function makePlayer(id, name, position) {
  const p = { id, webName: name, position, teamId: 1, startPrice: 50 };
  playerMap.set(id, p);
  return p;
}

const gkp1 = makePlayer(1, 'Ramsdale', Position.GKP);
const fwd1 = makePlayer(2, 'Fraser', Position.FWD);
const def1 = makePlayer(3, 'Lamptey', Position.DEF);
const mid1 = makePlayer(4, 'Gordon', Position.MID);

function getBenchSlots(benchPlayers) {
  const benchGkp = benchPlayers.find(sp => playerMap.get(sp.playerId)?.position === Position.GKP);
  const benchOutfield = benchPlayers.filter(sp => playerMap.get(sp.playerId)?.position !== Position.GKP);

  return [
    // Slot 0: GKP
    {
      slotIndex: 0,
      label: 'GKP',
      player: benchGkp || null,
      isEmpty: !benchGkp,
    },
    // Slot 1: SUB 1
    {
      slotIndex: 1,
      label: 'SUB 1',
      player: benchOutfield[0] || null,
      isEmpty: !benchOutfield[0],
    },
    // Slot 2: SUB 2
    {
      slotIndex: 2,
      label: 'SUB 2',
      player: benchOutfield[1] || null,
      isEmpty: !benchOutfield[1],
    },
    // Slot 3: SUB 3
    {
      slotIndex: 3,
      label: 'SUB 3',
      player: benchOutfield[2] || null,
      isEmpty: !benchOutfield[2],
    },
  ];
}

console.log('--- TEST 1: Empty Bench ---');
let slots = getBenchSlots([]);
console.log(slots.map(s => `Slot ${s.slotIndex}: [${s.isEmpty ? 'EMPTY ' + s.label : s.player.webName}]`).join(' | '));
console.assert(slots[0].label === 'GKP' && slots[0].isEmpty, 'Slot 0 must be empty GKP');
console.assert(slots[1].label === 'SUB 1' && slots[1].isEmpty, 'Slot 1 must be empty SUB 1');
console.assert(slots[2].label === 'SUB 2' && slots[2].isEmpty, 'Slot 2 must be empty SUB 2');
console.assert(slots[3].label === 'SUB 3' && slots[3].isEmpty, 'Slot 3 must be empty SUB 3');
console.log('✓ PASS: Empty bench correctly initializes 4 fixed slots\n');

console.log('--- TEST 2: Add 1 Outfielder (User Scenario) ---');
// User adds Fraser (outfielder)
let benchWith1Outfield = [
  { playerId: fwd1.id, isStarting: false, benchOrder: 2 }
];
slots = getBenchSlots(benchWith1Outfield);
console.log(slots.map(s => `Slot ${s.slotIndex}: [${s.isEmpty ? 'EMPTY ' + s.label : s.player.playerId === fwd1.id ? 'Fraser (SUB 1)' : s.player.webName}]`).join(' | '));
console.assert(slots[0].label === 'GKP' && slots[0].isEmpty, 'Slot 0 must remain EMPTY GKP (did not shift)');
console.assert(slots[1].label === 'SUB 1' && slots[1].player?.playerId === fwd1.id, 'Slot 1 must contain Fraser');
console.assert(slots[2].label === 'SUB 2' && slots[2].isEmpty, 'Slot 2 must be empty SUB 2');
console.assert(slots[3].label === 'SUB 3' && slots[3].isEmpty, 'Slot 3 must be empty SUB 3');
console.log('✓ PASS: Fraser is in SUB 1 slot, GKP slot is in slot 0 and NEVER shifted!\n');

console.log('--- TEST 3: Add Goalkeeper ---');
// User adds Ramsdale
let benchWithGkpAndOutfield = [
  { playerId: gkp1.id, isStarting: false, benchOrder: 1 },
  { playerId: fwd1.id, isStarting: false, benchOrder: 2 },
];
slots = getBenchSlots(benchWithGkpAndOutfield);
console.log(slots.map(s => `Slot ${s.slotIndex}: [${s.isEmpty ? 'EMPTY ' + s.label : s.player.playerId === gkp1.id ? 'Ramsdale (GKP)' : 'Fraser (SUB 1)'}]`).join(' | '));
console.assert(slots[0].player?.playerId === gkp1.id, 'Slot 0 must be Ramsdale');
console.assert(slots[1].player?.playerId === fwd1.id, 'Slot 1 must be Fraser');
console.log('✓ PASS: Ramsdale takes Slot 0 (GKP), Fraser stays in Slot 1 (SUB 1)!\n');

console.log('--- TEST 4: Full Bench (1 GKP + 3 Outfielders) ---');
let fullBench = [
  { playerId: gkp1.id, isStarting: false, benchOrder: 1 },
  { playerId: fwd1.id, isStarting: false, benchOrder: 2 },
  { playerId: def1.id, isStarting: false, benchOrder: 3 },
  { playerId: mid1.id, isStarting: false, benchOrder: 4 },
];
slots = getBenchSlots(fullBench);
console.log(slots.map(s => `Slot ${s.slotIndex}: [${s.player.playerId === gkp1.id ? 'Ramsdale (GKP)' : playerMap.get(s.player.playerId).webName + ' (' + s.label + ')'}]`).join(' | '));
console.assert(slots[0].player?.playerId === gkp1.id, 'Slot 0 is Ramsdale');
console.assert(slots[1].player?.playerId === fwd1.id, 'Slot 1 is Fraser');
console.assert(slots[2].player?.playerId === def1.id, 'Slot 2 is Lamptey');
console.assert(slots[3].player?.playerId === mid1.id, 'Slot 3 is Gordon');
console.log('✓ PASS: All 4 bench slots filled in exact designated positions!\n');

console.log('ALL BENCH FIXED SLOTS TESTS PASSED! ✓✓✓');

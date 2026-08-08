/**
 * Phase 2 verification: the cross-service driver busy-lock (driverAssignmentService).
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/assignment.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};
const oid = () => new mongoose.Types.ObjectId();

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri(), { dbName: 'assign' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { acquireDriverAssignment, releaseDriverAssignment, forceClearDriverAssignment } =
    await import('../src/modules/taxi/driver/services/driverAssignmentService.js');

  let phoneSeq = 9000000000;
  const newDriver = () => Driver.create({
    name: 'D', phone: `+91${phoneSeq++}`,
    password: 'secret123', vehicleType: 'car', location: { type: 'Point', coordinates: [72, 23] },
  });

  await test('acquire on a free driver succeeds and sets the lock', async () => {
    const d = await newDriver();
    const rideId = oid();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true);
    const fresh = await Driver.findById(d._id).lean();
    assert.equal(fresh.activeAssignment.type, 'ride');
    assert.equal(String(fresh.activeAssignment.id), String(rideId));
  });

  await test('a delivery cannot lock a driver already on a ride (mutual exclusion)', async () => {
    const d = await newDriver();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', oid()), true);
    assert.equal(await acquireDriverAssignment(d._id, 'delivery', oid()), false, 'must be refused');
  });

  await test('re-acquiring the SAME assignment is idempotent (accept retry)', async () => {
    const d = await newDriver();
    const rideId = oid();
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true);
    assert.equal(await acquireDriverAssignment(d._id, 'ride', rideId), true, 'same id re-acquire ok');
  });

  await test('concurrent acquires of different jobs: exactly one wins', async () => {
    const d = await newDriver();
    const [a, b, c] = await Promise.all([
      acquireDriverAssignment(d._id, 'ride', oid()),
      acquireDriverAssignment(d._id, 'delivery', oid()),
      acquireDriverAssignment(d._id, 'ride', oid()),
    ]);
    assert.equal([a, b, c].filter(Boolean).length, 1, 'only one of three may win the lock');
  });

  await test('release only clears when it still holds THIS assignment', async () => {
    const d = await newDriver();
    const rideId = oid();
    await acquireDriverAssignment(d._id, 'ride', rideId);
    // stale release for a different id must NOT clear
    assert.equal(await releaseDriverAssignment(d._id, oid()), false, 'stale release is a no-op');
    let fresh = await Driver.findById(d._id).lean();
    assert.ok(fresh.activeAssignment, 'lock still held after stale release');
    // correct release clears
    assert.equal(await releaseDriverAssignment(d._id, rideId), true);
    fresh = await Driver.findById(d._id).lean();
    assert.equal(fresh.activeAssignment, null, 'lock cleared');
  });

  await test('driver is re-lockable after release', async () => {
    const d = await newDriver();
    const r1 = oid();
    await acquireDriverAssignment(d._id, 'ride', r1);
    await releaseDriverAssignment(d._id, r1);
    assert.equal(await acquireDriverAssignment(d._id, 'delivery', oid()), true, 'free again');
  });

  await test('forceClear recovers a stuck lock', async () => {
    const d = await newDriver();
    await acquireDriverAssignment(d._id, 'ride', oid());
    assert.equal(await forceClearDriverAssignment(d._id), true);
    assert.equal((await Driver.findById(d._id).lean()).activeAssignment, null);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  return failed.length;
}

let code = 1;
try { code = await main(); } catch (err) { console.error('Harness error:', err); code = 1; }
process.exit(code === 0 ? 0 : 1);

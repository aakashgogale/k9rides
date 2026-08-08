/**
 * Integration smoke tests for the concurrency-sensitive taxi flow fixes.
 *
 * Runs against an ISOLATED in-memory MongoDB replica set (replica set is required because the
 * ride/wallet code uses transactions). It never touches the configured Atlas cluster.
 *
 * Run:  node tests/flow.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let replSet;
const results = [];
const test = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};

const oid = () => new mongoose.Types.ObjectId();

// ---------------------------------------------------------------------------
// The exact atomic expressions used by instantPoolingService, exercised against
// a real MongoDB so the pipeline semantics are verified (not just reviewed).
// ---------------------------------------------------------------------------
const claimSeats = (Group, groupId, requiredSeats) =>
  Group.findOneAndUpdate(
    {
      _id: groupId,
      status: { $nin: ['completed', 'cancelled'] },
      $expr: { $lte: [{ $add: ['$occupiedSeats', requiredSeats] }, { $ifNull: ['$totalCapacity', 4] }] },
    },
    { $inc: { occupiedSeats: requiredSeats } },
    { new: true },
  );

const detachAtomic = (Group, groupId, rideId, releasedSeats) => {
  const rideObjId = new mongoose.Types.ObjectId(String(rideId));
  return Group.findByIdAndUpdate(
    groupId,
    [
      {
        $set: {
          activeRides: {
            $filter: { input: { $ifNull: ['$activeRides', []] }, as: 'r', cond: { $ne: ['$$r', rideObjId] } },
          },
          occupiedSeats: {
            $max: [0, {
              $subtract: [
                { $ifNull: ['$occupiedSeats', 0] },
                { $cond: [{ $in: [rideObjId, { $ifNull: ['$activeRides', []] }] }, releasedSeats, 0] },
              ],
            }],
          },
          routeVersion: { $add: [{ $ifNull: ['$routeVersion', 0] }, 1] },
        },
      },
    ],
    { new: true },
  );
};

async function main() {
  // Cold-start of the cached mongod binary can exceed the 10s default (notably on Windows).
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  process.env.MONGODB_URI = uri;
  process.env.MONGO_URI = uri;
  process.env.REDIS_ENABLED = 'false';
  process.env.BULLMQ_ENABLED = 'false';
  process.env.JWT_ACCESS_SECRET = 'test';
  process.env.JWT_REFRESH_SECRET = 'test';

  await mongoose.connect(uri, { dbName: 'flowsmoke' });
  console.log('Connected.\n');

  const { InstantPoolGroup } = await import('../src/modules/taxi/admin/models/InstantPoolGroup.js');

  const newGroup = async (over = {}) =>
    InstantPoolGroup.create({
      driverId: oid(), vehicleTypeId: oid(), activeRides: [],
      totalCapacity: 4, occupiedSeats: 0, status: 'created', routeVersion: 0, ...over,
    });

  console.log('Pool seat concurrency (Uber/Ola-style accounting)');

  await test('concurrent joins cannot overbook the vehicle', async () => {
    const g = await newGroup({ totalCapacity: 4, occupiedSeats: 0 });
    // 10 riders each wanting 1 seat, all at once. Only 4 may succeed.
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimSeats(InstantPoolGroup, g._id, 1)),
    );
    const granted = claims.filter(Boolean).length;
    const fresh = await InstantPoolGroup.findById(g._id).lean();
    assert.equal(granted, 4, `expected exactly 4 claims granted, got ${granted}`);
    assert.equal(fresh.occupiedSeats, 4, `occupiedSeats must equal capacity, got ${fresh.occupiedSeats}`);
    assert.ok(fresh.occupiedSeats <= fresh.totalCapacity, 'never exceeds capacity');
  });

  await test('multi-seat claims respect remaining capacity', async () => {
    const g = await newGroup({ totalCapacity: 4, occupiedSeats: 3 });
    assert.equal(await claimSeats(InstantPoolGroup, g._id, 2), null, '2 seats must be refused when only 1 free');
    assert.ok(await claimSeats(InstantPoolGroup, g._id, 1), '1 seat must be granted');
    const fresh = await InstantPoolGroup.findById(g._id).lean();
    assert.equal(fresh.occupiedSeats, 4);
  });

  await test('legacy group without totalCapacity still accepts joins ($ifNull 4)', async () => {
    const g = await newGroup();
    // Simulate a legacy doc that predates totalCapacity.
    await InstantPoolGroup.collection.updateOne({ _id: g._id }, { $unset: { totalCapacity: '' } });
    const claimed = await claimSeats(InstantPoolGroup, g._id, 1);
    assert.ok(claimed, 'legacy group must not be permanently unjoinable');
  });

  await test('claim refused once group is completed/cancelled', async () => {
    const g = await newGroup({ status: 'completed' });
    assert.equal(await claimSeats(InstantPoolGroup, g._id, 1), null);
  });

  console.log('\nAtomic detach (leave / complete)');

  await test('detach removes the ride and releases its seats exactly once', async () => {
    const r1 = oid(), r2 = oid();
    const g = await newGroup({ activeRides: [r1, r2], occupiedSeats: 3 });
    const after = await detachAtomic(InstantPoolGroup, g._id, r1, 2);
    assert.equal(after.activeRides.length, 1);
    assert.equal(String(after.activeRides[0]), String(r2));
    assert.equal(after.occupiedSeats, 1, 'released the 2 seats');
    assert.equal(after.routeVersion, 1, 'route version bumped');
  });

  await test('double-remove is idempotent (no seat over-decrement)', async () => {
    const r1 = oid(), r2 = oid();
    const g = await newGroup({ activeRides: [r1, r2], occupiedSeats: 3 });
    await detachAtomic(InstantPoolGroup, g._id, r1, 2);
    const after = await detachAtomic(InstantPoolGroup, g._id, r1, 2); // repeat same ride
    assert.equal(after.occupiedSeats, 1, `seats must stay 1, got ${after.occupiedSeats}`);
    assert.equal(after.activeRides.length, 1);
  });

  await test('concurrent detaches of different riders do not clobber each other', async () => {
    const r1 = oid(), r2 = oid(), r3 = oid();
    const g = await newGroup({ activeRides: [r1, r2, r3], occupiedSeats: 3 });
    await Promise.all([
      detachAtomic(InstantPoolGroup, g._id, r1, 1),
      detachAtomic(InstantPoolGroup, g._id, r2, 1),
    ]);
    const fresh = await InstantPoolGroup.findById(g._id).lean();
    assert.equal(fresh.activeRides.length, 1, 'both riders removed (no lost update)');
    assert.equal(String(fresh.activeRides[0]), String(r3));
    assert.equal(fresh.occupiedSeats, 1, `seats must be 1, got ${fresh.occupiedSeats}`);
  });

  await test('seats never go negative', async () => {
    const r1 = oid();
    const g = await newGroup({ activeRides: [r1], occupiedSeats: 1 });
    const after = await detachAtomic(InstantPoolGroup, g._id, r1, 5); // over-release
    assert.equal(after.occupiedSeats, 0);
  });

  await test('last-passenger close frees the driver exactly once', async () => {
    const g = await newGroup({ activeRides: [], occupiedSeats: 0, status: 'active' });
    const closeOnce = () => InstantPoolGroup.findOneAndUpdate(
      { _id: g._id, status: { $ne: 'completed' } }, { $set: { status: 'completed' } }, { new: true },
    );
    const [a, b] = await Promise.all([closeOnce(), closeOnce()]);
    assert.equal([a, b].filter(Boolean).length, 1, 'only one caller may close (and free the driver)');
  });

  console.log('\nDriver-cancel re-dispatch exclusion');

  await test('rejection survives stopDispatchFlow ordering (canceller not re-offered)', async () => {
    const ds = await import('../src/modules/taxi/services/dispatchService.js');
    const rideId = String(oid());
    const driverId = String(oid());
    // Simulate a live dispatch, then the fixed cancel ordering:
    ds.getDispatchState(rideId);
    ds.stopDispatchFlow(rideId);              // must come FIRST
    ds.markDriverRejectedFromDispatch(rideId, driverId); // then seed the rejection
    const state = ds.getDispatchState(rideId);
    assert.ok(
      state.rejectedDriverIds.map(String).includes(driverId),
      'cancelling driver must remain excluded from re-dispatch',
    );
  });

  await test('wrong order (reject then stop) would lose the exclusion — regression guard', async () => {
    const ds = await import('../src/modules/taxi/services/dispatchService.js');
    const rideId = String(oid());
    const driverId = String(oid());
    ds.markDriverRejectedFromDispatch(rideId, driverId);
    ds.stopDispatchFlow(rideId); // wipes state — this is the bug we fixed
    const state = ds.getDispatchState(rideId);
    assert.equal(
      state.rejectedDriverIds.length, 0,
      'documents why order matters: stopDispatchFlow clears the rejection',
    );
  });

  // ---- summary ----
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('\nFailures:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.err.stack?.split('\n')[0]}`);
  }
  return failed.length;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('Harness error:', err);
  code = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
  await replSet?.stop().catch(() => {});
}
process.exit(code === 0 ? 0 : 1);

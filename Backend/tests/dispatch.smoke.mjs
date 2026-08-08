/**
 * Phase 3 verification: the unified dispatch candidate query (findEligibleUnifiedDrivers).
 * Isolated in-memory MongoDB replica set; never touches Atlas.
 *
 * Run:  node tests/dispatch.smoke.mjs
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
  await mongoose.connect(replSet.getUri(), { dbName: 'dispatch' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { findEligibleUnifiedDrivers } = await import('../src/modules/taxi/driver/services/unifiedDispatchService.js');
  await Driver.init(); // ensure 2dsphere index built before $geoNear

  let seq = 9200000000;
  const near = [72.5, 23.0];
  const mk = (over) => Driver.create({
    name: 'D', phone: `+91${seq++}`, password: 'secret123', vehicleType: 'car',
    approve: true, isOnline: true, workMode: 'all', serviceCapabilities: ['taxi', 'delivery'],
    activeAssignment: null, location: { type: 'Point', coordinates: near }, ...over,
  });

  await test('returns an online, free, capable driver in range', async () => {
    const d = await mk({});
    const got = await findEligibleUnifiedDrivers('delivery', near, { maxDistanceMeters: 3000 });
    assert.ok(got.some((x) => String(x._id) === String(d._id)));
  });

  await test('excludes offline drivers', async () => {
    const d = await mk({ isOnline: false });
    const got = await findEligibleUnifiedDrivers('taxi', near, {});
    assert.ok(!got.some((x) => String(x._id) === String(d._id)));
  });

  await test('excludes busy drivers (activeAssignment set)', async () => {
    const d = await mk({ activeAssignment: { type: 'ride', id: oid(), at: new Date() } });
    const got = await findEligibleUnifiedDrivers('delivery', near, {});
    assert.ok(!got.some((x) => String(x._id) === String(d._id)), 'busy driver must not be a candidate');
  });

  await test('excludes drivers lacking the capability', async () => {
    const d = await mk({ serviceCapabilities: ['taxi'] });
    const got = await findEligibleUnifiedDrivers('delivery', near, {});
    assert.ok(!got.some((x) => String(x._id) === String(d._id)), 'taxi-only driver not offered deliveries');
  });

  await test('workMode gates the stream (taxi-only mode gets no delivery offers)', async () => {
    const d = await mk({ workMode: 'taxi' });
    const gotDel = await findEligibleUnifiedDrivers('delivery', near, {});
    assert.ok(!gotDel.some((x) => String(x._id) === String(d._id)), 'workMode taxi -> no delivery');
    const gotTaxi = await findEligibleUnifiedDrivers('taxi', near, {});
    assert.ok(gotTaxi.some((x) => String(x._id) === String(d._id)), 'workMode taxi -> still gets rides');
  });

  await test('excludes drivers outside the radius', async () => {
    const d = await mk({ location: { type: 'Point', coordinates: [73.5, 24.0] } }); // ~150km away
    const got = await findEligibleUnifiedDrivers('taxi', near, { maxDistanceMeters: 5000 });
    assert.ok(!got.some((x) => String(x._id) === String(d._id)), 'far driver excluded');
  });

  await test('taxi vehicleTypeId filter is honored', async () => {
    const vt = oid();
    const match = await mk({ vehicleTypeId: vt });
    const other = await mk({ vehicleTypeId: oid() });
    const got = await findEligibleUnifiedDrivers('taxi', near, { vehicleTypeIds: [vt] });
    assert.ok(got.some((x) => String(x._id) === String(match._id)), 'matching vehicle type included');
    assert.ok(!got.some((x) => String(x._id) === String(other._id)), 'other vehicle type excluded');
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

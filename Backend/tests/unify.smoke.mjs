/**
 * Phase 1 verification: the driver-unification backfill migration.
 * Boots an isolated in-memory MongoDB and runs the REAL scripts/migrate-unify-drivers.js
 * against seeded data. Never touches the configured Atlas cluster.
 *
 * Run:  node tests/unify.smoke.mjs
 */
import assert from 'assert';
import mongoose from 'mongoose';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, '..', 'scripts', 'migrate-unify-drivers.js');

const results = [];
const test = async (name, fn) => {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (err) { results.push({ name, ok: false, err }); console.log(`  FAIL  ${name}\n        ${err.message}`); }
};

async function main() {
  process.env.MONGOMS_STARTUP_TIMEOUT ||= '180000';
  console.log('Booting in-memory MongoDB replica set…');
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const uri = replSet.getUri();
  await mongoose.connect(uri, { dbName: 'unify' });
  console.log('Connected.\n');

  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
  const { FoodDeliveryWallet } = await import('../src/modules/food/delivery/models/deliveryWallet.model.js');
  const { DeliveryProfile } = await import('../src/modules/food/delivery/models/deliveryProfile.model.js');

  // Seed: one existing taxi driver whose phone matches a partner, plus a delivery-only partner.
  const existingDriver = await Driver.create({
    name: 'Ravi', phone: '+919876500001', password: 'secret123', vehicleType: 'car',
    location: { type: 'Point', coordinates: [72.5, 23.0] },
  });
  const matchedPartner = await FoodDeliveryPartner.create({
    name: 'Ravi D', phone: '9876500001', vehicleType: 'bike', vehicleNumber: 'GJ01AB1111',
    status: 'approved', panNumber: 'ABCDE1234F', bankName: 'HDFC',
    lastLocation: { type: 'Point', coordinates: [72.5, 23.0] },
  });
  await FoodDeliveryWallet.create({ deliveryPartnerId: matchedPartner._id, balance: 250, cashInHand: 120, totalEarnings: 900 });

  const soloPartner = await FoodDeliveryPartner.create({
    name: 'Sunil', phone: '+919876500002', vehicleType: 'bike', vehicleNumber: 'GJ01AB2222', status: 'approved',
    lastLocation: { type: 'Point', coordinates: [72.6, 23.1] },
  });
  await FoodDeliveryWallet.create({ deliveryPartnerId: soloPartner._id, balance: 40, cashInHand: 0 });

  const runMigration = () => execFileP(process.execPath, [scriptPath, '--apply'], {
    env: { ...process.env, MONGODB_URI: uri, MONGO_URI: uri, MONGODB_DB_NAME: 'unify' },
  });

  console.log('Running migration (apply)…');
  await runMigration();
  console.log('');

  await test('existing driver gains delivery capability + legacy link', async () => {
    const d = await Driver.findById(existingDriver._id).lean();
    assert.ok(d.serviceCapabilities.includes('taxi'), 'keeps taxi capability');
    assert.ok(d.serviceCapabilities.includes('delivery'), 'gains delivery capability');
    assert.equal(String(d.legacyDeliveryPartnerId), String(matchedPartner._id));
    assert.equal(d.delivery.vehicleNumber, 'GJ01AB1111', 'delivery hint copied');
  });

  await test('matched partner links back to the unified driver', async () => {
    const p = await FoodDeliveryPartner.findById(matchedPartner._id).lean();
    assert.equal(String(p.driverId), String(existingDriver._id));
  });

  await test('DeliveryProfile created with KYC + wallet snapshot', async () => {
    const prof = await DeliveryProfile.findOne({ driverId: existingDriver._id }).lean();
    assert.ok(prof, 'profile exists');
    assert.equal(prof.panNumber, 'ABCDE1234F');
    assert.equal(prof.bankName, 'HDFC');
    assert.equal(prof.walletSnapshot.balance, 250);
    assert.equal(prof.walletSnapshot.cashInHand, 120);
    assert.equal(prof.walletSnapshot.reconciled, false, 'snapshot not yet reconciled (Phase 4)');
  });

  await test('unmatched partner creates a delivery-only unified driver', async () => {
    const p = await FoodDeliveryPartner.findById(soloPartner._id).lean();
    assert.ok(p.driverId, 'reverse link set');
    const d = await Driver.findById(p.driverId).lean();
    assert.deepEqual(d.serviceCapabilities, ['delivery'], 'delivery-only capability');
    assert.equal(d.workMode, 'all');
    assert.equal(String(d.legacyDeliveryPartnerId), String(soloPartner._id));
    assert.equal(d.location.coordinates[0], 72.6, 'location carried from partner');
  });

  await test('re-running the migration is idempotent (no duplicate drivers/profiles)', async () => {
    const driversBefore = await Driver.countDocuments();
    const profilesBefore = await DeliveryProfile.countDocuments();
    await runMigration();
    assert.equal(await Driver.countDocuments(), driversBefore, 'no new drivers on re-run');
    assert.equal(await DeliveryProfile.countDocuments(), profilesBefore, 'no duplicate profiles');
    // capability not duplicated
    const d = await Driver.findById(existingDriver._id).lean();
    assert.equal(d.serviceCapabilities.filter((c) => c === 'delivery').length, 1, 'delivery capability not doubled');
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await mongoose.disconnect().catch(() => {});
  await replSet.stop().catch(() => {});
  return failed.length;
}

let code = 1;
try { code = await main(); }
catch (err) { console.error('Harness error:', err); code = 1; }
process.exit(code === 0 ? 0 : 1);

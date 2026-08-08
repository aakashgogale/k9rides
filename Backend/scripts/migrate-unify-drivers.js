/**
 * Phase 1 backfill for driver unification.
 *
 * Folds every FoodDeliveryPartner into the unified TaxiDriver identity, keyed by phone:
 *   - existing driver (same phone) -> grant 'delivery' capability, copy delivery dispatch hints,
 *     link legacyDeliveryPartnerId, create/update its DeliveryProfile
 *   - no matching driver           -> create a delivery-only Driver, then its DeliveryProfile
 * Also snapshots the delivery wallet into the profile for Phase-4 reconciliation and sets the
 * reverse link (FoodDeliveryPartner.driverId).
 *
 * ADDITIVE + IDEMPOTENT: changes no existing behavior and is safe to re-run. It never mutates
 * live wallet balances (only snapshots them) and never touches taxi dispatch fields.
 *
 * Usage:
 *   node scripts/migrate-unify-drivers.js            # DRY RUN (default) — reports, writes nothing
 *   node scripts/migrate-unify-drivers.js --apply    # actually write
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(-10);

const connect = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI / MONGO_URI in environment.');
  const dbName = process.env.MONGODB_DB_NAME || undefined;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
};

async function main() {
  await connect();
  const { Driver } = await import('../src/modules/taxi/driver/models/Driver.js');
  const { FoodDeliveryPartner } = await import('../src/modules/food/delivery/models/deliveryPartner.model.js');
  const { FoodDeliveryWallet } = await import('../src/modules/food/delivery/models/deliveryWallet.model.js');
  const { DeliveryProfile } = await import('../src/modules/food/delivery/models/deliveryProfile.model.js');

  const partners = await FoodDeliveryPartner.find({}).lean();
  const stats = { partners: partners.length, linked: 0, created: 0, capabilityAdded: 0, profiles: 0, skipped: 0, errors: 0 };

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${partners.length} delivery partners to process\n`);

  for (const p of partners) {
    const phone10 = normalizePhone(p.phone);
    if (!phone10) { stats.skipped++; console.log(`  skip (no phone): ${p._id}`); continue; }

    try {
      // Match an existing unified driver by the last 10 digits of the phone.
      let driver = await Driver.findOne({ phone: { $regex: `${phone10}$` } });

      const wallet = await FoodDeliveryWallet.findOne({ deliveryPartnerId: p._id }).lean();
      const walletSnapshot = {
        balance: wallet?.balance || 0,
        cashInHand: wallet?.cashInHand || 0,
        lockedAmount: wallet?.lockedAmount || 0,
        totalEarnings: wallet?.totalEarnings || 0,
        totalSettled: wallet?.totalSettled || 0,
        totalDeliveries: wallet?.totalDeliveries || 0,
        capturedAt: new Date(),
        reconciled: false,
      };

      if (!driver) {
        // Create a delivery-only unified driver.
        if (APPLY) {
          driver = await Driver.create({
            name: p.name || 'Delivery Partner',
            phone: p.phone,
            // placeholder password (select:false); delivery login is OTP-based, unchanged here
            password: crypto.randomBytes(16).toString('hex'),
            vehicleType: p.vehicleType || 'bike',
            serviceCapabilities: ['delivery'],
            workMode: 'all',
            status: p.status === 'approved' ? 'approved' : 'pending',
            approve: p.status === 'approved',
            city: p.city || '',
            profileImage: p.profilePhoto || '',
            legacyDeliveryPartnerId: p._id,
            location: p.lastLocation?.coordinates?.length === 2
              ? { type: 'Point', coordinates: p.lastLocation.coordinates }
              : { type: 'Point', coordinates: [0, 0] },
            delivery: {
              vehicleType: p.vehicleType || '',
              vehicleName: p.vehicleName || '',
              vehicleNumber: p.vehicleNumber || '',
              codCashLimit: 0,
            },
          });
        }
        stats.created++;
        console.log(`  create driver <- partner ${p._id} (${phone10})`);
      } else {
        // Link + grant delivery capability on the existing driver.
        const caps = new Set(driver.serviceCapabilities || []);
        const hadDelivery = caps.has('delivery');
        caps.add('delivery');
        if (APPLY) {
          driver.serviceCapabilities = [...caps];
          driver.legacyDeliveryPartnerId = p._id;
          driver.delivery = {
            vehicleType: p.vehicleType || driver.delivery?.vehicleType || '',
            vehicleName: p.vehicleName || driver.delivery?.vehicleName || '',
            vehicleNumber: p.vehicleNumber || driver.delivery?.vehicleNumber || '',
            codCashLimit: driver.delivery?.codCashLimit || 0,
          };
          await driver.save();
        }
        if (!hadDelivery) stats.capabilityAdded++;
        stats.linked++;
        console.log(`  link driver ${driver._id} <- partner ${p._id} (${phone10})${hadDelivery ? '' : ' +delivery'}`);
      }

      // Upsert the DeliveryProfile (idempotent by driverId).
      if (APPLY && driver?._id) {
        await DeliveryProfile.updateOne(
          { driverId: driver._id },
          {
            $set: {
              legacyDeliveryPartnerId: p._id,
              address: p.address || '', city: p.city || '', state: p.state || '',
              panNumber: p.panNumber || '', aadharNumber: p.aadharNumber || '',
              drivingLicenseNumber: p.drivingLicenseNumber || '',
              aadharPhoto: p.aadharPhoto || '', panPhoto: p.panPhoto || '',
              drivingLicensePhoto: p.drivingLicensePhoto || '',
              bankAccountHolderName: p.bankAccountHolderName || '', bankAccountNumber: p.bankAccountNumber || '',
              bankIfscCode: p.bankIfscCode || '', bankName: p.bankName || '',
              upiId: p.upiId || '', upiQrCode: p.upiQrCode || '',
              referralCode: p.referralCode || '', referredByLegacyId: p.referredBy || null,
              walletSnapshot,
            },
          },
          { upsert: true },
        );
        await FoodDeliveryPartner.updateOne({ _id: p._id }, { $set: { driverId: driver._id } });
      }
      stats.profiles++;
    } catch (err) {
      stats.errors++;
      console.log(`  ERROR partner ${p._id} (${phone10}): ${err.message}`);
    }
  }

  console.log(`\nDone (${APPLY ? 'applied' : 'dry run — no writes'}):`);
  console.log(JSON.stringify(stats, null, 2));
  if (!APPLY) console.log('\nRe-run with --apply to write changes.');
}

let code = 0;
try {
  await main();
} catch (err) {
  console.error('Migration failed:', err);
  code = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
process.exit(code);

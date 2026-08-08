import mongoose from 'mongoose';

/**
 * DeliveryProfile — per-service (food delivery) data for a UNIFIED driver.
 *
 * Part of the driver-unification (Phase 1). The core `TaxiDriver` doc owns identity, wallet,
 * live location, availability and the busy-lock; the heavy / rarely-queried delivery-specific
 * data (KYC docs, bank details, delivery vehicle papers, wallet snapshot at migration) lives
 * here, keyed by the unified driverId. Keeping it out of the core doc keeps the dispatch hot
 * path small and lets a third service add its own profile later without reshaping the driver.
 */
const deliveryProfileSchema = new mongoose.Schema(
  {
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TaxiDriver',
      required: true,
      unique: true,
      index: true,
    },
    // Back-reference to the legacy record for the dual-run phase (retired at contract).
    legacyDeliveryPartnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodDeliveryPartner',
      default: null,
      index: true,
    },
    address: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    // KYC / documents
    panNumber: { type: String, default: '' },
    aadharNumber: { type: String, default: '' },
    drivingLicenseNumber: { type: String, default: '' },
    aadharPhoto: { type: String, default: '' },
    panPhoto: { type: String, default: '' },
    drivingLicensePhoto: { type: String, default: '' },
    // Banking / payout
    bankAccountHolderName: { type: String, default: '' },
    bankAccountNumber: { type: String, default: '' },
    bankIfscCode: { type: String, default: '' },
    bankName: { type: String, default: '' },
    upiId: { type: String, default: '' },
    upiQrCode: { type: String, default: '' },
    // Delivery referral (kept separate from the taxi referral graph)
    referralCode: { type: String, default: '' },
    referredByLegacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodDeliveryPartner', default: null },
    // Snapshot of the delivery wallet at migration time — used to reconcile into the unified
    // wallet in Phase 4. NOT a live balance; do not spend from this.
    walletSnapshot: {
      balance: { type: Number, default: 0 },
      cashInHand: { type: Number, default: 0 },
      lockedAmount: { type: Number, default: 0 },
      totalEarnings: { type: Number, default: 0 },
      totalSettled: { type: Number, default: 0 },
      totalDeliveries: { type: Number, default: 0 },
      capturedAt: { type: Date, default: null },
      reconciled: { type: Boolean, default: false },
    },
  },
  { collection: 'food_delivery_profiles', timestamps: true },
);

export const DeliveryProfile =
  mongoose.models.DeliveryProfile || mongoose.model('DeliveryProfile', deliveryProfileSchema);

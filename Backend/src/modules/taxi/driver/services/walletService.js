import mongoose from 'mongoose';
import { env } from '../../../../config/env.js';
import { ApiError } from '../../../../utils/ApiError.js';
import { SetPrice } from '../../admin/models/SetPrice.js';
import { Driver } from '../models/Driver.js';
import { WalletTransaction } from '../models/WalletTransaction.js';
import { Ride } from '../../user/models/Ride.js';
import { getWalletSettings } from '../../services/appSettingsService.js';

const normalizeAmount = (value, fieldName = 'amount') => {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    throw new ApiError(400, `${fieldName} must be a valid number`);
  }

  return Math.round(amount * 100) / 100;
};

const normalizePaymentMethod = (value) => (
  String(value || '').trim().toLowerCase() === 'cash' ? 'cash' : 'online'
);

const normalizeCommissionType = (value) => {
  const numericValue = Number(value);
  return numericValue === 1 ? 'percentage' : 'fixed';
};

const computeCommissionAmount = ({ fare, type, value }) => {
  const safeFare = normalizeAmount(fare, 'fare');
  const safeValue = Math.max(normalizeAmount(value || 0, 'commission'), 0);

  if (normalizeCommissionType(type) === 'percentage') {
    return Math.min(Math.round((safeFare * safeValue)) / 100, safeFare);
  }

  return Math.min(safeValue, safeFare);
};

const resolveCommissionConfigForRide = async (ride, session) => {
  if (ride?.pricingSnapshot?.admin_commission_from_driver !== undefined) {
    return {
      source: ride.pricingSnapshot?.setPriceId ? 'ride_snapshot' : 'ride_snapshot_fallback',
      type: Number(ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      value: Number(ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
    };
  }

  if (ride?.vehicleTypeId) {
    const normalizedServiceType = String(ride?.serviceType || '').trim().toLowerCase();
    const savedTransportType = String(ride.transport_type || '').trim().toLowerCase();
    const normalizedTransportType =
      normalizedServiceType === 'parcel'
        ? (savedTransportType === 'delivery' || savedTransportType === 'both' ? savedTransportType : 'delivery')
        : (savedTransportType || 'taxi');
    const filters = [
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        ...(ride.service_location_id ? { service_location_id: ride.service_location_id } : {}),
        transport_type: 'both',
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: normalizedTransportType,
      },
      {
        vehicle_type: ride.vehicleTypeId,
        active: 1,
        status: 'active',
        transport_type: 'both',
      },
    ];

    for (const filter of filters) {
      const setPrice = await SetPrice.findOne(filter).sort({ updatedAt: -1, createdAt: -1 }).session(session).lean();
      if (setPrice) {
        return {
          source: 'set_price_lookup',
          type: Number(setPrice.admin_commission_type_from_driver ?? 1),
          value: Number(setPrice.admin_commission_from_driver ?? 0),
          setPriceId: setPrice._id,
        };
      }
    }
  }

  return {
    source: 'env_fallback',
    type: 1,
    value: Number(env.driverWallet.commissionPercent || 0),
  };
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : fallback;
};

const isEnabledSetting = (value, fallback = true) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const resolveWalletRules = async () => {
  const walletSettings = await getWalletSettings();
  const configuredMinimumBalance = Number(walletSettings.driver_wallet_minimum_amount_to_get_an_order);
  const minimumBalanceForOrders = Number.isFinite(configuredMinimumBalance)
    ? Math.round(configuredMinimumBalance * 100) / 100
    : -toNonNegativeNumber(env.driverWallet.defaultCashLimit, 500);

  return {
    minimumBalanceForOrders,
    cashLimit: Math.abs(Math.min(minimumBalanceForOrders, 0)),
    minimumTopUpAmount: toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0),
    minimumTransferAmount: toNonNegativeNumber(walletSettings.minimum_wallet_amount_for_transfer, 0),
    isWalletEnabled: isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true),
    isTransferEnabled: isEnabledSetting(walletSettings.enable_wallet_transfer_driver, true),
  };
};

const getWalletSnapshot = async (driver) => {
  const rules = await resolveWalletRules();
  const balance = Number(driver?.wallet?.balance || 0);

  return {
    balance,
    cashLimit: rules.cashLimit,
    minimumBalanceForOrders: rules.minimumBalanceForOrders,
    availableForOrders: Math.round((balance - rules.minimumBalanceForOrders) * 100) / 100,
    isBlocked: Boolean(driver?.wallet?.isBlocked),
    rules,
  };
};

export const serializeDriverWallet = async (driver) => {
  const wallet = await getWalletSnapshot(driver);

  return {
    balance: wallet.balance,
    cashLimit: wallet.cashLimit,
    minimumBalanceForOrders: wallet.minimumBalanceForOrders,
    availableForOrders: wallet.availableForOrders,
    isWalletEnabled: wallet.rules.isWalletEnabled,
    isTransferEnabled: wallet.rules.isTransferEnabled,
    minimumTopUpAmount: wallet.rules.minimumTopUpAmount,
    minimumTransferAmount: wallet.rules.minimumTransferAmount,
    isBlocked: wallet.isBlocked || !wallet.rules.isWalletEnabled || wallet.balance <= wallet.minimumBalanceForOrders,
  };
};

export const ensureDriverWalletCanAcceptRide = async (driverOrId, { session } = {}) => {
  const driver =
    typeof driverOrId === 'object' && driverOrId?._id
      ? driverOrId
      : await Driver.findById(driverOrId).session(session);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const wallet = await getWalletSnapshot(driver);
  const isBlocked = wallet.isBlocked || !wallet.rules.isWalletEnabled || wallet.balance <= wallet.minimumBalanceForOrders;

  if (isBlocked) {
    await Driver.findByIdAndUpdate(driver._id, {
      'wallet.cashLimit': wallet.cashLimit,
      'wallet.isBlocked': true,
    });
    throw new ApiError(403, wallet.rules.isWalletEnabled
      ? 'Driver wallet minimum balance is not met. Please top up to accept rides.'
      : 'Driver wallet is disabled by admin.');
  }

  if (Number(driver?.wallet?.cashLimit) !== wallet.cashLimit || driver?.wallet?.isBlocked) {
    await Driver.findByIdAndUpdate(driver._id, {
      'wallet.cashLimit': wallet.cashLimit,
      'wallet.isBlocked': false,
    });
  }

  return wallet;
};

export const applyDriverWalletAdjustment = async ({
  driverId,
  amount,
  type,
  rideId = null,
  description = '',
  metadata = {},
  session = null,
}) => {
  const normalizedAmount = normalizeAmount(amount);

  if (!normalizedAmount) {
    throw new ApiError(400, 'Wallet adjustment amount cannot be zero');
  }

  const driver = await Driver.findById(driverId).session(session);

  if (!driver) {
    throw new ApiError(404, 'Driver not found');
  }

  const before = await getWalletSnapshot(driver);

  // ponytail: compute balance AND isBlocked in one atomic aggregation-pipeline update so the
  // block flag is derived from the real post-balance. Deriving it from the pre-read snapshot
  // (then $set) lost the update under concurrent adjustments.
  const walletEnabled = before.rules.isWalletEnabled;
  const minBal = before.minimumBalanceForOrders;
  const updatedDriver = await Driver.findByIdAndUpdate(
    driverId,
    [
      {
        $set: {
          'wallet.balance': {
            $round: [{ $add: [{ $ifNull: ['$wallet.balance', 0] }, normalizedAmount] }, 2],
          },
          'wallet.cashLimit': before.cashLimit,
        },
      },
      {
        $set: {
          'wallet.isBlocked': walletEnabled ? { $lte: ['$wallet.balance', minBal] } : true,
        },
      },
    ],
    { returnDocument: 'after', session },
  );

  const balanceAfter = Math.round((updatedDriver.wallet.balance) * 100) / 100;
  const balanceBefore = Math.round((balanceAfter - normalizedAmount) * 100) / 100;
  const isBlockedAfter = Boolean(updatedDriver.wallet.isBlocked);

  const [transaction] = await WalletTransaction.create(
    [
      {
        driverId,
        rideId,
        type,
        amount: normalizedAmount,
        balanceBefore,
        balanceAfter,
        cashLimit: before.cashLimit,
        isBlockedAfter,
        description,
        metadata,
      },
    ],
    { session },
  );

  return {
    driver: updatedDriver,
    wallet: await serializeDriverWallet(updatedDriver),
    transaction,
  };
};

export const topUpDriverWallet = async ({ driverId, amount, metadata = {} }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const walletSettings = await getWalletSettings();
    if (!isEnabledSetting(walletSettings.show_wallet_feature_for_driver, true)) {
      throw new ApiError(403, 'Driver wallet is disabled by admin');
    }

    const minimumTopUpAmount = toNonNegativeNumber(walletSettings.minimum_amount_added_to_wallet, 0);
    const normalizedTopUpAmount = Math.abs(normalizeAmount(amount));

    if (minimumTopUpAmount > 0 && normalizedTopUpAmount < minimumTopUpAmount) {
      throw new ApiError(400, `amount must be at least ${minimumTopUpAmount}`);
    }

    const result = await applyDriverWalletAdjustment({
      driverId,
      amount: normalizedTopUpAmount,
      type: 'top_up',
      description: 'Driver wallet top-up',
      metadata: {
        ...metadata,
        minimumTopUpAmount,
      },
      session,
    });

    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

export const settleCompletedRideWallet = async ({ rideId }) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const ride = await Ride.findOneAndUpdate(
      { _id: rideId, walletSettledAt: null, driverId: { $ne: null } },
      { $set: { walletSettledAt: new Date() } },
      { returnDocument: 'after', session },
    );

    if (!ride) {
      await session.commitTransaction();
      return null;
    }

    const fare = normalizeAmount(ride.fare || 0, 'fare');
    const recoveredDue = Number(ride.recovered_cancellation_due || 0);
    const fareExcludingDue = Math.max(0, fare - recoveredDue);

    const promoDiscountAmount = Math.max(0, Number(ride?.promo?.discount_amount || 0));

    const surgeAmount = Math.max(0, normalizeAmount(ride?.pricingSnapshot?.ride_surge_amount || 0, 'surgeAmount'));
    const commissionableFare = Math.max(0, normalizeAmount(fareExcludingDue - promoDiscountAmount - surgeAmount, 'commissionableFare'));
    const commissionConfig = await resolveCommissionConfigForRide(ride, session);
    const commissionAmount = computeCommissionAmount({
      fare: commissionableFare,
      type: commissionConfig.type,
      value: commissionConfig.value,
    });
    const paymentMethod = normalizePaymentMethod(ride.paymentMethod);

    const cancellationFeeGoesTo = ride?.pricingSnapshot?.cancellation_fee_goes_to || 'admin';
    const isDriverGetsCancellationFee = cancellationFeeGoesTo === 'driver' && recoveredDue > 0;

    let driverEarnings = Math.max(Math.round((fareExcludingDue - promoDiscountAmount - commissionAmount) * 100) / 100, 0);
    if (isDriverGetsCancellationFee) {
      driverEarnings = Math.round((driverEarnings + recoveredDue) * 100) / 100;
    }

    let adminOwedAmount = isDriverGetsCancellationFee ? commissionAmount : (commissionAmount + recoveredDue);

    const amount = paymentMethod === 'cash' ? -adminOwedAmount : driverEarnings;
    const type = paymentMethod === 'cash' ? 'commission_deduction' : 'ride_earning';

    ride.paymentMethod = paymentMethod;
    ride.commissionAmount = commissionAmount;
    ride.driverEarnings = driverEarnings;
    ride.pricingSnapshot = {
      ...(ride.pricingSnapshot?.toObject ? ride.pricingSnapshot.toObject() : ride.pricingSnapshot || {}),
      setPriceId: ride.pricingSnapshot?.setPriceId || commissionConfig.setPriceId || null,
      admin_commission_type_from_driver: Number(commissionConfig.type ?? ride.pricingSnapshot?.admin_commission_type_from_driver ?? 1),
      admin_commission_from_driver: Number(commissionConfig.value ?? ride.pricingSnapshot?.admin_commission_from_driver ?? 0),
      cancellation_fee_goes_to: cancellationFeeGoesTo,
      resolvedAt: ride.pricingSnapshot?.resolvedAt || new Date(),
    };
    await ride.save({ session });

    if (!amount) {
      await session.commitTransaction();
      return null;
    }

    const result = await applyDriverWalletAdjustment({
      driverId: ride.driverId,
      rideId: ride._id,
      amount,
      type,
      description: paymentMethod === 'cash'
        ? (recoveredDue > 0
          ? (isDriverGetsCancellationFee ? 'Commission deducted for cash ride' : 'Commission & previous user cancellation due deducted')
          : 'Commission deducted for cash ride')
        : 'Driver earning credited for online ride',
      metadata: {
        fare,
        surgeAmount,
        commissionableFare,
        commissionAmount,
        driverEarnings,
        paymentMethod,
        commissionSource: commissionConfig.source,
        commissionType: normalizeCommissionType(commissionConfig.type),
        commissionValue: Number(commissionConfig.value || 0),
        recoveredCancellationDue: recoveredDue,
        cancellationFeeGoesTo,
      },
      session,
    });

    await session.commitTransaction();
    return {
      ...result,
      ride,
    };
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

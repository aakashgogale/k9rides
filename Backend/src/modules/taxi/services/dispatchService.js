import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { Ride } from '../user/models/Ride.js';
import { User } from '../user/models/User.js';
import { UserWallet } from '../user/models/UserWallet.js';
import { Driver } from '../driver/models/Driver.js';
import { WalletTransaction } from '../driver/models/WalletTransaction.js';
import { applyDriverWalletAdjustment } from '../driver/services/walletService.js';
import { matchDrivers } from './matchingService.js';
import {
  RIDE_LIVE_STATUS,
  RIDE_STATUS,
} from '../constants/index.js';
import { Delivery } from '../user/models/Delivery.js';
import { getRideRoom, resolveSetPriceForRide } from './rideService.js';
import { SOCKET_EVENTS } from '../socket/events.js';
import { resolveTransportDispatchConfig, getTransportRideSettings } from './transportSettingsService.js';
import { sendPushNotificationToEntities } from './pushNotificationService.js';

const activeDispatches = new Map();
let ioInstance = null;
const scheduledDispatchTimers = new Map();

const roundMoney = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const ensureUserWallet = async (userId, session = null) => {
  if (!userId) {
    return;
  }

  await UserWallet.updateOne(
    { userId },
    { $setOnInsert: { userId, balance: 0, refundWallet: 0, transactions: [] } },
    { upsert: true, session },
  );
};

const normalizeRideTransportType = (ride) => {
  const serviceType = String(ride?.serviceType || '').trim().toLowerCase();
  const transportType = String(ride?.transport_type || '').trim().toLowerCase();

  if (serviceType === 'parcel') {
    return transportType === 'both' ? 'delivery' : (transportType || 'delivery');
  }

  if (serviceType === 'intercity') {
    return 'intercity';
  }

  if (transportType === 'all' || transportType === 'both' || !transportType) {
    return 'taxi';
  }

  return transportType;
};

const computeCancellationFeeAmount = ({ ride, feeType, feeValue }) => {
  const baseAmount = Math.max(roundMoney(ride?.fare || 0), roundMoney(ride?.baseFare || 0), 0);
  const normalizedValue = Math.max(roundMoney(feeValue || 0), 0);
  const normalizedType = String(feeType || 'percentage').trim().toLowerCase();

  if (normalizedValue <= 0) {
    return 0;
  }

  if (normalizedType === 'fixed') {
    return normalizedValue;
  }

  return Math.min(roundMoney((baseAmount * normalizedValue) / 100), baseAmount);
};

const resolveCancellationPricing = async (ride, session) => {
  if (!ride?.vehicleTypeId) {
    return null;
  }

  return resolveSetPriceForRide({
    serviceLocationId: ride.service_location_id || null,
    transportType: normalizeRideTransportType(ride),
    vehicleTypeId: ride.vehicleTypeId,
  });
};

const applyUserWalletAdjustment = async ({
  userId,
  amount,
  kind,
  title,
  referenceKey,
  walletField = 'balance',
  provider = 'ride_cancellation',
  session = null,
  requireSufficientFunds = false,
}) => {
  const normalizedAmount = roundMoney(amount);
  const normalizedKind = kind === 'debit' ? 'debit' : 'credit';
  const normalizedField = walletField === 'refundWallet' ? 'refundWallet' : 'balance';
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!userId || normalizedAmount <= 0 || !normalizedReferenceKey) {
    return { status: 'skipped', amount: 0 };
  }

  await ensureUserWallet(userId, session);

  const existing = await UserWallet.findOne({
    userId,
    'transactions.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .session(session)
    .lean();

  if (existing) {
    return { status: 'existing', amount: normalizedAmount };
  }

  const tx = {
    kind: normalizedKind,
    amount: normalizedAmount,
    title: String(title || '').trim(),
    provider,
    referenceKey: normalizedReferenceKey,
  };

  const updateFilter = { userId };
  if (normalizedKind === 'debit' && requireSufficientFunds) {
    updateFilter[normalizedField] = { $gte: normalizedAmount };
  }

  const updateResult = await UserWallet.updateOne(
    updateFilter,
    {
      $inc: { [normalizedField]: normalizedKind === 'credit' ? normalizedAmount : -normalizedAmount },
      $push: { transactions: { $each: [tx], $slice: -50 } },
    },
    { session },
  );

  if (!updateResult?.modifiedCount) {
    return { status: requireSufficientFunds ? 'insufficient_funds' : 'not_modified', amount: normalizedAmount };
  }

  return { status: 'applied', amount: normalizedAmount };
};

export const applyDriverWalletAdjustmentByReference = async ({
  driverId,
  amount,
  rideId = null,
  description,
  referenceKey,
  metadata = {},
  session = null,
}) => {
  const normalizedAmount = roundMoney(amount);
  const normalizedReferenceKey = String(referenceKey || '').trim();

  if (!driverId || !normalizedAmount || !normalizedReferenceKey) {
    return { status: 'skipped', amount: normalizedAmount, walletResult: null };
  }

  const existing = await WalletTransaction.findOne({
    driverId,
    'metadata.referenceKey': normalizedReferenceKey,
  })
    .select('_id')
    .session(session)
    .lean();

  if (existing) {
    return { status: 'existing', amount: normalizedAmount, walletResult: null };
  }

  const walletResult = await applyDriverWalletAdjustment({
    driverId,
    amount: normalizedAmount,
    type: 'adjustment',
    rideId,
    description,
    metadata: {
      ...metadata,
      referenceKey: normalizedReferenceKey,
    },
    session,
  });

  return { status: 'applied', amount: normalizedAmount, walletResult };
};

export const settleUserCancellationFee = async (ride, session) => {
  const pricing = ride.pricingSnapshot || (await resolveCancellationPricing(ride, session)) || {};

  const isEnabled = pricing.enable_cancellation_charge !== false;
  if (!isEnabled) {
    return {
      feeAmount: 0,
      waitingTimeMinutes: 0,
      waitingCharge: 0,
      totalFeeAmount: 0,
      userDebitStatus: 'none',
      driverCreditStatus: 'none',
      driverWalletResult: null,
      message: 'Cancellation charge disabled'
    };
  }

  let chargeApplies = false;
  let conditionMsg = 'No condition met';

  const acceptedAt = ride.acceptedAt ? new Date(ride.acceptedAt) : null;
  const timeSinceAcceptedMs = acceptedAt ? Date.now() - acceptedAt.getTime() : 0;
  const timeSinceAcceptedMin = timeSinceAcceptedMs / 60000;
  const freeCancellationTime = Number(pricing.free_cancellation_time ?? 2);

  if (acceptedAt && timeSinceAcceptedMin < freeCancellationTime) {
    return {
      feeAmount: 0,
      waitingTimeMinutes: 0,
      waitingCharge: 0,
      totalFeeAmount: 0,
      userDebitStatus: 'none',
      driverCreditStatus: 'none',
      driverWalletResult: null,
      message: `Cancelled within free window of ${freeCancellationTime} minutes`
    };
  }

  const liveStatusLower = String(ride.liveStatus || ride.status || '').toLowerCase();
  const isOtpStage = ['waiting_for_otp', 'otp_verification'].includes(liveStatusLower);
  const isReachedStage = !!ride.arrivedAt || liveStatusLower === 'arrived';
  const isAcceptedStage = !!ride.driverId || !!ride.acceptedAt || liveStatusLower === 'accepted';

  if (isOtpStage) {
    if (pricing.charge_after_otp || pricing.charge_after_driver_reached_pickup || pricing.charge_after_driver_accepted) {
      chargeApplies = true;
      conditionMsg = 'Charge applies at OTP stage based on active rules';
    }
  } else if (isReachedStage) {
    if (pricing.charge_after_driver_reached_pickup || pricing.charge_after_driver_accepted) {
      chargeApplies = true;
      conditionMsg = 'Charge applies after reaching pickup based on active rules';
    }
  } else if (isAcceptedStage) {
    if (pricing.charge_after_driver_accepted) {
      chargeApplies = true;
      conditionMsg = 'Charge applies after driver accepted based on active rules';
    }
  }

  if (!chargeApplies) {
    return {
      feeAmount: 0,
      waitingTimeMinutes: 0,
      waitingCharge: 0,
      totalFeeAmount: 0,
      userDebitStatus: 'none',
      driverCreditStatus: 'none',
      driverWalletResult: null,
      message: conditionMsg
    };
  }

  const baseAmount = Math.max(roundMoney(ride?.fare || 0), roundMoney(ride?.baseFare || 0), 0);
  let computedFee = 0;

  const fixedFee = Number(pricing.fixed_cancellation_charge || 0);
  const percentageFee = Number(pricing.percentage_cancellation_charge || 0);

  if (fixedFee > 0) {
    computedFee = fixedFee;
  } else if (percentageFee > 0) {
    computedFee = roundMoney((baseAmount * percentageFee) / 100);
  }

  const maxFeeCap = Number(pricing.max_cancellation_fee || 0);
  if (maxFeeCap > 0 && computedFee > maxFeeCap) {
    computedFee = maxFeeCap;
  }

  let waitingCharge = 0;
  let waitingTimeMinutes = 0;

  const totalFeeAmount = computedFee;

  if (totalFeeAmount <= 0) {
    return {
      feeAmount: 0,
      waitingTimeMinutes: 0,
      waitingCharge: 0,
      totalFeeAmount: 0,
      userDebitStatus: 'none',
      driverCreditStatus: 'none',
      driverWalletResult: null
    };
  }

  await User.findByIdAndUpdate(ride.userId, {
    $inc: { pending_cancellation_due: totalFeeAmount }
  }, { session });

  let driverCredit = { status: 'skipped', walletResult: null };
  const shouldCreditDriver =
    String(pricing?.cancellation_fee_goes_to || 'admin').trim().toLowerCase() === 'driver' &&
    ride.driverId;

  if (shouldCreditDriver) {
    const feeReferenceBase = `ride-cancel:user:${String(ride._id)}`;
    driverCredit = await applyDriverWalletAdjustmentByReference({
      driverId: ride.driverId,
      amount: totalFeeAmount,
      rideId: ride._id,
      description: `Cancellation fee received for booking ${String(ride._id).slice(-6)}`,
      referenceKey: `${feeReferenceBase}:driver-credit`,
      metadata: {
        source: 'ride_cancellation_fee',
        cancelledBy: 'user',
        counterpartyRole: 'user',
        counterpartyId: String(ride.userId),
      },
      session,
    });
  }

  return {
    feeAmount: computedFee,
    waitingTimeMinutes,
    waitingCharge,
    totalFeeAmount,
    userDebitStatus: 'pending_due',
    driverCreditStatus: driverCredit.status,
    driverWalletResult: driverCredit.walletResult,
  };
};

const settleDriverCancellationFee = async (ride, session) => {
  const pricing = await resolveCancellationPricing(ride, session);
  const feeAmount = computeCancellationFeeAmount({
    ride,
    feeType: pricing?.driver_cancellation_fee_type,
    feeValue: pricing?.driver_cancellation_fee,
  });

  if (feeAmount <= 0 || !ride?.driverId) {
    return { feeAmount: 0, driverDebitStatus: 'none', userCreditStatus: 'none', driverWalletResult: null };
  }

  // Include the driverId so that after a cancel + re-dispatch, a SECOND driver cancelling gets a
  // distinct reference key — otherwise the user-credit (deduped per {userId, rideId}) is skipped
  // and the rider is never compensated for the second cancellation.
  const feeReferenceBase = `ride-cancel:driver:${String(ride._id)}:${String(ride.driverId)}`;
  const driverDebit = await applyDriverWalletAdjustmentByReference({
    driverId: ride.driverId,
    amount: -feeAmount,
    rideId: ride._id,
    description: `Scheduled ride cancellation fee for booking ${String(ride._id).slice(-6)}`,
    referenceKey: `${feeReferenceBase}:driver-debit`,
    metadata: {
      source: 'ride_cancellation_fee',
      cancelledBy: 'driver',
      counterpartyRole: 'user',
      counterpartyId: String(ride.userId),
    },
    session,
  });

  let userCredit = { status: 'skipped' };
  if (['applied', 'existing'].includes(driverDebit.status) && ride.userId) {
    userCredit = await applyUserWalletAdjustment({
      userId: ride.userId,
      amount: feeAmount,
      kind: 'credit',
      title: `Driver cancellation compensation for booking ${String(ride._id).slice(-6)}`,
      referenceKey: `${feeReferenceBase}:user-credit`,
      walletField: 'refundWallet',
      provider: 'ride_cancellation_refund',
      session,
    });
  }

  return {
    feeAmount,
    driverDebitStatus: driverDebit.status,
    userCreditStatus: userCredit.status,
    driverWalletResult: driverDebit.walletResult || null,
  };
};

export const getUserRoom = (userId) => `user:${userId}`;
export const getDriverRoom = (driverId) => `driver:${driverId}`;
export const getAdminRoom = () => 'admin:broadcast';

export const setSocketServer = (io) => {
  ioInstance = io;
};

export const joinRideRoom = (socket, rideId) => {
  socket.join(getRideRoom(rideId));
};

export const addSocketSubscriptions = (socket, { role, entityId }) => {
  if (role === 'admin') {
    socket.join(getAdminRoom());
    return;
  }

  if (role === 'user') {
    socket.join(getUserRoom(entityId));
    return;
  }

  if (role === 'driver') {
    socket.join(getDriverRoom(entityId));
  }
};

const getDispatchVehicleTypeIds = (ride) => {
  const ids = [
    ...(Array.isArray(ride.dispatchVehicleTypeIds) ? ride.dispatchVehicleTypeIds : []),
    ride.vehicleTypeId,
  ];

  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
};

const emitToSocket = (socketId, event, payload) => {
  if (ioInstance && socketId) {
    ioInstance.to(socketId).emit(event, payload);
  }
};

export const emitToRoom = (room, event, payload) => {
  if (ioInstance) {
    ioInstance.to(room).emit(event, payload);
  }
};

export const notifyUserAccountDeleted = (userId) => {
  if (!userId) return;
  emitToRoom(getUserRoom(userId), 'account:deleted', {
    reason: 'delete_request_approved',
  });
};

export const emitToDriver = (driverId, event, payload) => {
  if (driverId) {
    emitToRoom(getDriverRoom(driverId), event, payload);
  }
};

export const emitToAdmins = (event, payload) => {
  emitToRoom(getAdminRoom(), event, payload);
};

export const emitToRideRoom = (rideId, event, payload) => {
  emitToRoom(getRideRoom(rideId), event, payload);
};


const clearDispatchTimer = (rideId) => {
  const state = activeDispatches.get(String(rideId));

  if (state?.timer) {
    clearTimeout(state.timer);
  }
};

const clearScheduledDispatchTimer = (rideId) => {
  const key = String(rideId);
  const timer = scheduledDispatchTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    scheduledDispatchTimers.delete(key);
  }
};

export const stopDispatchFlow = (rideId) => {
  clearDispatchTimer(rideId);
  clearScheduledDispatchTimer(rideId);
  activeDispatches.delete(String(rideId));
};

export const restartRideDispatchWithLatestFare = async (rideId) => {
  if (!rideId) {
    return;
  }

  const state = getDispatchState(rideId);
  closeDriverRequestWindow(rideId, [
    ...state.driverIds,
    ...state.notifiedDriverIds,
    ...state.rejectedDriverIds,
  ]);
  stopDispatchFlow(rideId);

  const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');
  if (!ride || ride.status !== RIDE_STATUS.SEARCHING || ride.liveStatus !== RIDE_LIVE_STATUS.SEARCHING) {
    return;
  }

  await startDispatchFlow(ride);
};

export const getDispatchState = (rideId) => {
  const rideKey = String(rideId);
  const state = activeDispatches.get(rideKey) || {};

  return {
    radiusIndex: Number.isInteger(state.radiusIndex) ? state.radiusIndex : 0,
    timer: state.timer || null,
    driverIds: Array.isArray(state.driverIds) ? state.driverIds : [],
    notifiedDriverIds: Array.isArray(state.notifiedDriverIds) ? state.notifiedDriverIds : [],
    rejectedDriverIds: Array.isArray(state.rejectedDriverIds) ? state.rejectedDriverIds : [],
  };
};

const saveDispatchState = (rideId, nextState = {}) => {
  const rideKey = String(rideId);
  const currentState = getDispatchState(rideKey);

  activeDispatches.set(rideKey, {
    ...currentState,
    ...nextState,
  });

  return activeDispatches.get(rideKey);
};

const closeDriverRequestWindow = (rideId, driverIds = []) => {
  const safeDriverIds = [...new Set((Array.isArray(driverIds) ? driverIds : []).map((id) => String(id || '')).filter(Boolean))];

  for (const driverId of safeDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(rideId),
      reason: 'search-window-expired',
    });
  }
};

const emitRideRequestToDrivers = async ({
  ride,
  targetDrivers = [],
  zone = null,
  effectiveRadius = 0,
  dispatchVehicleTypeIds = [],
  dispatchConfig,
  attemptIndex = 0,
}) => {
  if (!ride || !targetDrivers.length) {
    return;
  }

  const requestExpiresAt = new Date(Date.now() + dispatchConfig.retryDelayMs).toISOString();

  for (const driver of targetDrivers) {
    console.log(`[emitRideRequestToDrivers] Emitting 'rideRequest' to driverId=${driver._id}, room=${getDriverRoom(driver._id)}`);
    emitToDriver(driver._id, 'rideRequest', {
      rideId: String(ride._id),
      type: ride.serviceType || 'ride',
      serviceType: ride.serviceType || 'ride',
      userId: String(ride.userId),
      user: {
        id: ride.userId?._id ? String(ride.userId._id) : String(ride.userId || ''),
        name: ride.userId?.name || 'Customer',
        phone: ride.userId?.phone || '',
        countryCode: ride.userId?.countryCode || '',
      },
      pickupLocation: ride.pickupLocation,
      pickupAddress: ride.pickupAddress || '',
      dropLocation: ride.dropLocation,
      dropAddress: ride.dropAddress || '',
      scheduledAt: ride.scheduledAt || null,
      estimatedDistanceMeters: ride.estimatedDistanceMeters || 0,
      estimatedDurationMinutes: ride.estimatedDurationMinutes || 0,
      vehicleTypeId: ride.vehicleTypeId ? String(ride.vehicleTypeId) : null,
      vehicleTypeIds: dispatchVehicleTypeIds,
      vehicleIconType: ride.vehicleIconType,
      vehicleIconUrl: ride.vehicleIconUrl || '',
      fare: ride.fare,
      baseFare: Number(ride.baseFare || ride.fare || 0),
      bookingMode: ride.bookingMode || 'normal',
      pricingNegotiationMode: ride.pricingNegotiationMode || 'none',
      biddingStatus: ride.biddingStatus || 'none',
      bidding: ride.pricingNegotiationMode === 'driver_bid'
        ? {
            enabled: true,
            baseFare: Number(ride.baseFare || ride.fare || 0),
            bidFloorFare: Number(ride.bidFloorFare ?? ride.baseFare ?? ride.fare ?? 0),
            userMaxBidFare: Number(ride.userMaxBidFare || ride.fare || 0),
            bidCeilingMaxFare: Number(ride.bidCeilingMaxFare || ride.userMaxBidFare || ride.fare || 0),
            bidStepAmount: Number(ride.bidStepAmount || 10),
          }
        : {
            enabled: false,
          },
      fareIncreaseWaitMinutes: Number(ride.fareIncreaseWaitMinutes || 0),
      nextFareIncreaseAt: ride.nextFareIncreaseAt || null,
      paymentMethod: ride.paymentMethod,
      parcel: ride.parcel || null,
      intercity: ride.intercity || null,
      radius: effectiveRadius,
      attempt: attemptIndex + 1,
      maxAttempts: dispatchConfig.maxAttempts,
      acceptRejectDurationSeconds: dispatchConfig.retryWindowSeconds,
      expiresInSeconds: dispatchConfig.retryWindowSeconds,
      requestExpiresAt,
      zoneId: zone?._id ? String(zone._id) : null,
    });
  }

  sendPushNotificationToEntities({
    driverIds: targetDrivers.map((driver) => String(driver._id)),
    title: ride.serviceType === 'parcel' ? 'New delivery request' : 'New ride request',
    body: ride.pickupAddress
      ? `Pickup: ${ride.pickupAddress}`
      : 'A new booking is waiting for your response.',
    data: {
      type: 'ride_request',
      rideId: String(ride._id),
      serviceType: ride.serviceType || 'ride',
      userId: String(ride.userId?._id || ride.userId || ''),
    },
  }).catch((error) => {
    console.error('Failed to send driver ride-request push notification', error);
  });
};

export const markDriverRejectedFromDispatch = (rideId, driverId) => {
  if (!rideId || !driverId) {
    return;
  }

  const state = getDispatchState(rideId);
  const rejectedDriverIds = [...new Set([...state.rejectedDriverIds, String(driverId)])];

  saveDispatchState(rideId, { rejectedDriverIds });
};

const closeRideAsUnmatched = async (rideId) => {
  const dispatchState = getDispatchState(rideId);
  const ride = await Ride.findOneAndUpdate(
    { _id: rideId, status: RIDE_STATUS.SEARCHING },
    {
      status: RIDE_STATUS.CANCELLED,
      liveStatus: RIDE_LIVE_STATUS.CANCELLED,
      biddingStatus: 'expired',
    },
    { returnDocument: 'after' },
  );

  if (!ride) {
    return;
  }

  if (ride.deliveryId) {
    await Delivery.findByIdAndUpdate(ride.deliveryId, {
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  }

  // Free the driver if one was ever assigned (e.g. after a cancel+re-dispatch that went unmatched),
  // otherwise the driver can be left isOnRide:true with no active ride.
  if (ride.driverId) {
    await Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false });
  }

  await User.findByIdAndUpdate(ride.userId, { currentRideId: null });

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'No drivers accepted the ride request',
  });

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'unmatched',
  });

  for (const driverId of dispatchState.notifiedDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'unmatched',
    });
  }

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });
};

export const cancelRideByAdmin = async (rideId) => {
  stopDispatchFlow(rideId);

  const ride = await Ride.findById(rideId);

  if (!ride) {
    return null;
  }

  ride.status = RIDE_STATUS.CANCELLED;
  ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
  if (ride.bookingMode === 'bidding') {
    ride.biddingStatus = 'cancelled';
  }
  await ride.save();

  if (ride.deliveryId) {
    await Delivery.findByIdAndUpdate(ride.deliveryId, {
      driverId: ride.driverId || null,
      status: ride.status,
      liveStatus: ride.liveStatus,
    });
  }

  await Promise.all([
    User.findByIdAndUpdate(ride.userId, { currentRideId: null }),
    ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }) : Promise.resolve(),
  ]);

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: 'Ride was deleted by admin',
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'deleted-by-admin',
    });
  }

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'deleted-by-admin',
  });

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  return ride;
};

export const cancelRideByUser = async ({ rideId, userId, reason = '' }) => {
  const dispatchState = getDispatchState(rideId);
  stopDispatchFlow(rideId);
  const session = await mongoose.startSession();
  let ride = null;
  let cancellationSettlement = null;

  try {
    session.startTransaction();

    ride = await Ride.findOne({ _id: rideId, userId }).session(session);

    if (!ride) {
      await session.abortTransaction();
      return null;
    }

    // Block cancellation once the trip is underway. Key on explicit statuses (incl. 'ongoing'/'arrived')
    // as well as startedAt, so a ride advanced without startedAt still can't be cancelled for a fee.
    const blockedStatuses = ['started', 'in_trip', 'ongoing', 'arrived', 'completed'];
    if (
      ride.startedAt ||
      blockedStatuses.includes(String(ride.status || '').toLowerCase()) ||
      blockedStatuses.includes(String(ride.liveStatus || '').toLowerCase())
    ) {
      throw new ApiError(400, 'Ride cancellation is not allowed after the trip has started.');
    }

    if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
      await session.commitTransaction();
      return { ride, cancellationSettlement: null };
    }

    cancellationSettlement = await settleUserCancellationFee(ride, session);

    const totalCancellationFee = Number(cancellationSettlement?.totalFeeAmount || 0);
    ride.cancelled_by = 'user';
    ride.cancellation_reason = String(reason || 'User cancelled').trim();
    ride.cancellation_time = new Date();

    if (totalCancellationFee > 0) {
      ride.cancellation_charge = totalCancellationFee;
      ride.cancellation_status = 'pending';
      ride.recovery_status = 'pending';
      ride.adminExtraCharge = {
        amount: totalCancellationFee,
        reason: String(reason || 'User cancellation charge').trim(),
        addedAt: new Date(),
      };
      ride.fare = Number(ride.fare || 0) + totalCancellationFee;
    } else {
      ride.cancellation_charge = 0;
      ride.cancellation_status = 'no_charge';
      ride.recovery_status = 'none';
    }

    ride.status = RIDE_STATUS.CANCELLED;
    ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;

    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    if (ride.deliveryId) {
      await Delivery.findByIdAndUpdate(ride.deliveryId, {
        driverId: ride.driverId || null,
        status: ride.status,
        liveStatus: ride.liveStatus,
      }, { session });
    }

    await Promise.all([
      // ponytail: settleUserCancellationFee already $inc'd pending_cancellation_due;
      // do not add it a second time here or the rider is charged 2x the fee.
      User.findByIdAndUpdate(ride.userId, {
        $set: { currentRideId: null }
      }, { session }),
      (ride.driverId && !ride.isPoolRide) ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }, { session }) : Promise.resolve(),
    ]);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  if (ride.isPoolRide && ride.poolGroupId) {
    const { removeRideFromPoolGroup } = await import('./instantPoolingService.js');
    await removeRideFromPoolGroup(ride.poolGroupId, ride._id, reason || 'User cancelled');
  }

  // Socket emissions (outside the transaction)
  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: ride.cancellation_reason || 'You cancelled the ride',
    cancellation_charge: ride.cancellation_charge,
    cancellation_status: ride.cancellation_status,
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideCancelled', {
      rideId: String(ride._id),
      reason: 'user-cancelled',
      message: 'User cancelled the ride.',
      cancellation_reason: ride.cancellation_reason,
      cancellation_time: ride.cancellation_time,
    });
    
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'user-cancelled',
    });

    const totalCancellationFee = Number(cancellationSettlement?.totalFeeAmount || 0);
    const goesToDriver = String(ride.pricingSnapshot?.cancellation_fee_goes_to || 'admin').trim().toLowerCase() === 'driver';
    let pushBody = 'The user has cancelled the ride.';

    if (totalCancellationFee > 0) {
      if (goesToDriver) {
        pushBody = `The user cancelled the ride. A cancellation fee of Rs ${totalCancellationFee} was charged and will reflect in your payout.`;
      } else {
        pushBody = `The user cancelled the ride. A cancellation fee was charged to the user.`;
      }
    }

    sendPushNotificationToEntities({
      driverIds: [String(ride.driverId)],
      title: 'Ride Cancelled',
      body: pushBody,
      data: {
        type: 'ride_cancelled',
        rideId: String(ride._id),
      },
    }).catch(err => console.error('Failed to send driver cancellation push', err));
  }

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  if (cancellationSettlement?.driverWalletResult?.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: cancellationSettlement.driverWalletResult.wallet,
      transaction: cancellationSettlement.driverWalletResult.transaction,
      notification: {
        id: `ride-cancel-credit-${String(ride._id)}`,
        title: 'Cancellation fee received',
        body: `Rs ${Number(cancellationSettlement.feeAmount || 0).toFixed(2)} credited for rider cancellation.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  const totalCancellationFee = Number(cancellationSettlement?.totalFeeAmount || 0);
  const userChargeAppliedMsg = totalCancellationFee > 0 
    ? `Cancellation Charge Applied: ₹${totalCancellationFee}` 
    : 'No cancellation charge applied.';

  sendPushNotificationToEntities({
    entityType: 'user',
    entityIds: [String(ride.userId)],
    notification: {
      title: 'Ride Cancelled',
      body: `Ride cancelled successfully. ${userChargeAppliedMsg}`,
    },
    data: {
      type: 'ride_cancellation',
      rideId: String(ride._id),
      status: 'cancelled',
    }
  }).catch(err => console.error('Failed to send user cancellation push notification:', err.message));

  if (ride.driverId) {
    sendPushNotificationToEntities({
      entityType: 'driver',
      entityIds: [String(ride.driverId)],
      notification: {
        title: 'Ride Cancelled',
        body: 'The user has cancelled this ride.',
      },
      data: {
        type: 'ride_cancellation',
        rideId: String(ride._id),
        status: 'cancelled',
      }
    }).catch(err => console.error('Failed to send driver cancellation push notification:', err.message));
  }

  if (dispatchState?.notifiedDriverIds) {
    for (const driverId of dispatchState.notifiedDriverIds) {
      emitToDriver(driverId, 'rideRequestClosed', {
        rideId: String(ride._id),
        reason: 'user-cancelled',
        message: 'User cancelled the ride.',
      });
    }
  }

  return { ride, cancellationSettlement };
};

export const cancelScheduledRideByDriver = async ({ rideId, driverId }) => {
  const dispatchState = getDispatchState(rideId);
  stopDispatchFlow(rideId);
  const session = await mongoose.startSession();
  let ride = null;
  let cancellationSettlement = null;

  try {
    session.startTransaction();

    ride = await Ride.findOne({ _id: rideId, driverId }).session(session);

    if (!ride) {
      await session.abortTransaction();
      return null;
    }

    const scheduledAt = ride?.scheduledAt ? new Date(ride.scheduledAt) : null;
    const isScheduledRide = scheduledAt && Number.isFinite(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now();

    if (!isScheduledRide) {
      throw new Error('Only upcoming scheduled rides can be cancelled by the driver');
    }

    if (ride.status === RIDE_STATUS.COMPLETED || ride.liveStatus === RIDE_LIVE_STATUS.COMPLETED) {
      throw new Error('Completed rides cannot be cancelled');
    }

    if (ride.status === RIDE_STATUS.CANCELLED || ride.liveStatus === RIDE_LIVE_STATUS.CANCELLED) {
      await session.commitTransaction();
      return ride;
    }

    cancellationSettlement = await settleDriverCancellationFee(ride, session);

    ride.status = RIDE_STATUS.CANCELLED;
    ride.liveStatus = RIDE_LIVE_STATUS.CANCELLED;
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'cancelled';
    }
    await ride.save({ session });

    if (ride.deliveryId) {
      await Delivery.findByIdAndUpdate(ride.deliveryId, {
        driverId: ride.driverId || null,
        status: ride.status,
        liveStatus: ride.liveStatus,
      }, { session });
    }

    await Promise.all([
      User.findByIdAndUpdate(ride.userId, { currentRideId: null }, { session }),
      ride.driverId ? Driver.findByIdAndUpdate(ride.driverId, { isOnRide: false }, { session }) : Promise.resolve(),
    ]);

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  const cancelReason = 'Your scheduled ride was cancelled by the driver.';

  emitToRoom(getUserRoom(ride.userId), 'rideCancelled', {
    rideId: String(ride._id),
    room: getRideRoom(ride._id),
    reason: cancelReason,
  });

  emitToRoom(getRideRoom(ride._id), 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'driver-cancelled',
    message: cancelReason,
  });

  if (ride.driverId) {
    emitToRoom(getDriverRoom(ride.driverId), 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'driver-cancelled',
      message: 'Scheduled ride cancelled.',
    });
  }

  for (const notifiedDriverId of dispatchState.notifiedDriverIds) {
    emitToDriver(notifiedDriverId, 'rideRequestClosed', {
      rideId: String(ride._id),
      reason: 'driver-cancelled',
      message: cancelReason,
    });
  }

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });

  if (cancellationSettlement?.driverWalletResult?.transaction) {
    emitToDriver(ride.driverId, 'driver:wallet:updated', {
      wallet: cancellationSettlement.driverWalletResult.wallet,
      transaction: cancellationSettlement.driverWalletResult.transaction,
      notification: {
        id: `ride-cancel-debit-${String(ride._id)}`,
        title: 'Cancellation fee charged',
        body: `Rs ${Number(cancellationSettlement.feeAmount || 0).toFixed(2)} deducted for scheduled ride cancellation.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  sendPushNotificationToEntities({
    userIds: [String(ride.userId)],
    title: 'Scheduled ride cancelled',
    body: cancelReason,
    data: {
      type: 'ride_cancelled_by_driver',
      rideId: String(ride._id),
      serviceType: ride.serviceType || 'ride',
    },
  }).catch((error) => {
    console.error('Failed to send user scheduled-ride cancellation push notification', error);
  });

  return ride;
};

/**
 * Driver cancels a LIVE ride they've accepted but not yet driven to / started.
 * Only allowed while liveStatus === ACCEPTED — once the driver is en route (arriving),
 * has arrived, or the trip has started, cancellation is blocked. Applies the admin-configured
 * driver cancellation penalty (debit driver, credit rider), then re-opens the request and
 * re-dispatches to another driver (the canceller is excluded via rejectedDriverIds) so the
 * rider isn't stranded. Pool rides are not handled here (different lifecycle).
 * @returns {Promise<{ride: object, settlement: object|null}>}
 */
export const cancelActiveRideByDriver = async ({ rideId, driverId, reason = '' }) => {
  const session = await mongoose.startSession();
  let ride = null;
  let cancellationSettlement = null;

  try {
    session.startTransaction();

    ride = await Ride.findOne({ _id: rideId, driverId }).session(session);
    if (!ride) {
      await session.abortTransaction();
      return { ride: null, settlement: null };
    }

    if (ride.isPoolRide) {
      throw new ApiError(409, 'Pool rides cannot be cancelled from here.');
    }

    // Block cancellation once the driver is en route or beyond — only a freshly ACCEPTED ride
    // (driver hasn't started moving to pickup) can be cancelled by the driver.
    const liveStatus = String(ride.liveStatus || '').toLowerCase();
    if (liveStatus !== RIDE_LIVE_STATUS.ACCEPTED) {
      throw new ApiError(409, 'Ride can no longer be cancelled — the driver is already en route.');
    }
    if (ride.startedAt) {
      throw new ApiError(409, 'Ride cannot be cancelled after the trip has started.');
    }

    // Apply the admin-configured driver cancellation penalty (idempotent by reference key).
    cancellationSettlement = await settleDriverCancellationFee(ride, session);

    // Re-open the ride for dispatch and free the driver. currentRideId stays set — the rider
    // keeps their active request while we search for a replacement driver.
    const previousDriverId = ride.driverId;
    ride.driverId = null;
    ride.acceptedAt = null;
    ride.status = RIDE_STATUS.SEARCHING;
    ride.liveStatus = RIDE_LIVE_STATUS.SEARCHING;
    if (ride.bookingMode === 'bidding') {
      ride.biddingStatus = 'searching';
    }
    await ride.save({ session });

    if (ride.deliveryId) {
      await Delivery.findByIdAndUpdate(ride.deliveryId, {
        driverId: null,
        status: ride.status,
        liveStatus: ride.liveStatus,
      }, { session });
    }

    if (previousDriverId) {
      await Driver.findByIdAndUpdate(previousDriverId, { isOnRide: false }, { session });
    }

    await session.commitTransaction();
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  // Exclude the cancelling driver from re-dispatch, then re-run the search.
  // Order matters: stop FIRST (clears any stale dispatch state), THEN record the rejection so it
  // survives into the fresh dispatch. We call dispatchAttempt directly below rather than
  // startDispatchFlow, because startDispatchFlow calls stopDispatchFlow again and would wipe this.
  stopDispatchFlow(rideId);
  markDriverRejectedFromDispatch(rideId, driverId);

  const cancelReason = String(reason || '').trim() || 'The assigned driver cancelled. Finding you another driver.';

  emitToRoom(getRideRoom(ride._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(ride._id),
    status: ride.status,
    liveStatus: ride.liveStatus,
  });
  emitToRoom(getUserRoom(ride.userId), 'rideDriverCancelled', {
    rideId: String(ride._id),
    reason: cancelReason,
  });
  emitToDriver(driverId, 'rideRequestClosed', {
    rideId: String(ride._id),
    reason: 'self-cancelled',
    message: 'You cancelled this ride. A cancellation fee may apply.',
  });

  if (cancellationSettlement?.driverWalletResult?.transaction) {
    emitToDriver(driverId, 'driver:wallet:updated', {
      wallet: cancellationSettlement.driverWalletResult.wallet,
      transaction: cancellationSettlement.driverWalletResult.transaction,
      notification: {
        id: `ride-cancel-debit-${String(ride._id)}`,
        title: 'Cancellation fee charged',
        body: `Rs ${Number(cancellationSettlement.feeAmount || 0).toFixed(2)} deducted for cancelling the ride.`,
        sentAt: new Date().toISOString(),
      },
    });
  }

  // Re-dispatch to a new driver so the rider keeps their request. dispatchAttempt (not
  // startDispatchFlow) preserves the rejectedDriverIds seeded above so the canceller isn't re-offered.
  const rideForDispatch = await Ride.findById(ride._id).populate('userId', 'name phone countryCode');
  if (rideForDispatch && rideForDispatch.status === RIDE_STATUS.SEARCHING) {
    await dispatchAttempt(rideForDispatch._id, 0);
  }

  return { ride, settlement: cancellationSettlement };
};

const scheduleNextAttempt = (rideId, nextAttemptIndex, retryDelayMs) => {
  const timer = setTimeout(() => {
    dispatchAttempt(rideId, nextAttemptIndex).catch((error) => {
      console.error('Dispatch retry failed', error);
    });
  }, retryDelayMs);

  saveDispatchState(rideId, { timer });
};

const getAttemptRadiusMeters = (baseDistanceMeters, attemptIndex) => {
  const safeBaseDistance = Math.max(1000, Number(baseDistanceMeters) || 0);
  const growthMultiplier = Math.min(1 + (Math.max(0, attemptIndex) * 0.5), 3);

  return Math.round(safeBaseDistance * growthMultiplier);
};

const dispatchAttempt = async (rideId, attemptIndex = 0) => {
  const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');

  if (!ride || ride.status !== RIDE_STATUS.SEARCHING) {
    stopDispatchFlow(rideId);
    return;
  }

  try {
    const dispatchConfig = await resolveTransportDispatchConfig();
    const radius = getAttemptRadiusMeters(
      dispatchConfig.baseDistanceMeters || dispatchConfig.maxDistanceMeters,
      attemptIndex,
    );
    const dispatchVehicleTypeIds = getDispatchVehicleTypeIds(ride);
    const dispatchState = getDispatchState(rideId);
    if (dispatchConfig.dispatchType === 'one_by_one' && attemptIndex > 0 && dispatchState.driverIds.length) {
      closeDriverRequestWindow(rideId, dispatchState.driverIds);
    }

    const { zone, drivers, searchRadiusMeters } = await matchDrivers(ride.pickupLocation.coordinates, {
      maxDistance: radius,
      vehicleTypeId: ride.vehicleTypeId,
      vehicleTypeIds: dispatchVehicleTypeIds,
      transportType: normalizeRideTransportType(ride),
    });
    const effectiveRadius = Number.isFinite(searchRadiusMeters) && searchRadiusMeters > 0
      ? searchRadiusMeters
      : radius;

    const rejectedDriverIds = new Set(dispatchState.rejectedDriverIds);
    const notifiedDriverIds = new Set(dispatchState.notifiedDriverIds);

    const availableDrivers = drivers.filter((driver) => {
      const driverId = String(driver._id);
      return !rejectedDriverIds.has(driverId) && !notifiedDriverIds.has(driverId);
    });

    const targetDrivers = dispatchConfig.dispatchType === 'broadcast'
      ? availableDrivers
      : availableDrivers.slice(0, 1);
    const nextNotifiedDriverIds = [
      ...dispatchState.notifiedDriverIds,
      ...targetDrivers.map((driver) => String(driver._id)),
    ];

    saveDispatchState(rideId, {
      radiusIndex: attemptIndex,
      driverIds: targetDrivers.map((driver) => String(driver._id)),
      notifiedDriverIds: nextNotifiedDriverIds,
      timer: null,
    });

    await emitRideRequestToDrivers({
      ride,
      targetDrivers,
      zone,
      effectiveRadius,
      dispatchVehicleTypeIds,
      dispatchConfig,
      attemptIndex,
    });

    emitToRoom(getUserRoom(ride.userId), 'rideSearchUpdate', {
      rideId: String(ride._id),
      status: ride.status,
      radius: effectiveRadius,
      dispatchType: dispatchConfig.dispatchType,
      attempt: attemptIndex + 1,
      maxAttempts: dispatchConfig.maxAttempts,
      matchedDrivers: targetDrivers.length,
      totalNotifiedDrivers: nextNotifiedDriverIds.length,
    });

    if (attemptIndex >= dispatchConfig.maxAttempts - 1) {
      // Final attempt waits one more cycle before the ride is closed as unmatched.
      const timer = setTimeout(() => {
        closeRideAsUnmatched(rideId)
          .catch((error) => console.error('Failed to mark ride unmatched', error))
          .finally(() => stopDispatchFlow(rideId));
      }, dispatchConfig.retryDelayMs);

        saveDispatchState(rideId, {
          radiusIndex: attemptIndex,
          driverIds: targetDrivers.map((driver) => String(driver._id)),
          notifiedDriverIds: nextNotifiedDriverIds,
          timer,
        });

      return;
    }

    scheduleNextAttempt(rideId, attemptIndex + 1, dispatchConfig.retryDelayMs);
  } catch (error) {
    await closeRideAsUnmatched(rideId);
    stopDispatchFlow(rideId);
    throw error;
  }
};

export const startDispatchFlow = async (ride) => {
  stopDispatchFlow(ride._id);

  const scheduledAt = ride?.scheduledAt ? new Date(ride.scheduledAt) : null;
  const bookingMode = String(ride?.bookingMode || 'normal').trim().toLowerCase();
  const shouldDispatchImmediately = bookingMode === 'bidding';

  let searchBufferMs = 15 * 60 * 1000;
  try {
    const settings = await getTransportRideSettings();
    const bufferMinutes = Number(settings.minimum_time_for_starting_trip_drivers_for_schedule_ride);
    if (Number.isFinite(bufferMinutes) && bufferMinutes > 0) {
      searchBufferMs = bufferMinutes * 60 * 1000;
    }
  } catch (error) {
    console.error('Failed to get scheduled ride search buffer', error);
  }

  const delayMs = scheduledAt ? scheduledAt.getTime() - Date.now() - searchBufferMs : 0;

  // Dispatch scheduled rides immediately so drivers can accept and get assigned in advance
  await dispatchAttempt(ride._id, 0);
};

export const restoreScheduledDispatches = async () => {
  const rides = await Ride.find({
    status: RIDE_STATUS.SEARCHING,
    liveStatus: RIDE_LIVE_STATUS.SEARCHING,
    scheduledAt: { $ne: null },
  }).select('_id scheduledAt');

  for (const ride of rides) {
    await startDispatchFlow(ride);
  }
};

export const notifyLateAvailableDriver = async (driverId) => {
  if (!driverId || activeDispatches.size === 0) {
    return;
  }

  const driver = await Driver.findById(driverId)
    .select('_id isOnline isOnRide wallet location zoneId vehicleTypeId vehicleType vehicleIconType');

  if (!driver?.isOnline || driver?.isOnRide || driver?.wallet?.isBlocked || !driver?.location?.coordinates?.length) {
    return;
  }

  const activeRideIds = Array.from(activeDispatches.keys());

  for (const rideId of activeRideIds) {
    const ride = await Ride.findById(rideId).populate('userId', 'name phone countryCode');

    if (!ride || ride.status !== RIDE_STATUS.SEARCHING) {
      continue;
    }

    const dispatchState = getDispatchState(rideId);
    const driverKey = String(driver._id);

    if (
      dispatchState.notifiedDriverIds.includes(driverKey) ||
      dispatchState.rejectedDriverIds.includes(driverKey)
    ) {
      continue;
    }

    const dispatchConfig = await resolveTransportDispatchConfig();
    const attemptIndex = Number.isInteger(dispatchState.radiusIndex) ? dispatchState.radiusIndex : 0;
    const radius = getAttemptRadiusMeters(
      dispatchConfig.baseDistanceMeters || dispatchConfig.maxDistanceMeters,
      attemptIndex,
    );
    const dispatchVehicleTypeIds = getDispatchVehicleTypeIds(ride);
    const { zone, drivers, searchRadiusMeters } = await matchDrivers(ride.pickupLocation.coordinates, {
      maxDistance: radius,
      vehicleTypeId: ride.vehicleTypeId,
      vehicleTypeIds: dispatchVehicleTypeIds,
      transportType: normalizeRideTransportType(ride),
    });

    const matchedDriver = drivers.find((item) => String(item._id) === driverKey);
    if (!matchedDriver) {
      continue;
    }

    const effectiveRadius = Number.isFinite(searchRadiusMeters) && searchRadiusMeters > 0
      ? searchRadiusMeters
      : radius;

    const nextNotifiedDriverIds = [...dispatchState.notifiedDriverIds, driverKey];
    const nextDriverIds = dispatchConfig.dispatchType === 'broadcast'
      ? [...new Set([...dispatchState.driverIds, driverKey])]
      : dispatchState.driverIds.length
        ? dispatchState.driverIds
        : [driverKey];

    saveDispatchState(rideId, {
      driverIds: nextDriverIds,
      notifiedDriverIds: nextNotifiedDriverIds,
    });

    await emitRideRequestToDrivers({
      ride,
      targetDrivers: [matchedDriver],
      zone,
      effectiveRadius,
      dispatchVehicleTypeIds,
      dispatchConfig,
      attemptIndex,
    });
  }
};

export const notifyRideAccepted = async (ride) => {
  const state = getDispatchState(ride._id);
  stopDispatchFlow(ride._id);

  // Once one driver wins the race, the rider is updated and the rest are told to stop.
  const populatedRide = await Ride.findById(ride._id).populate(
    'driverId',
    'name phone profileImage vehicleTypeId vehicleType vehicleIconType vehicleNumber vehicleColor vehicleMake vehicleModel vehicleImage rating',
  );

  if (!populatedRide) {
    return;
  }

  // Guard: driverId populate can yield null (driver deleted between accept-commit and this read);
  // dereferencing populatedRide.driverId._id below would throw and swallow the rider notification.
  if (!populatedRide.driverId || !populatedRide.driverId._id) {
    console.warn(`[notifyRideAccepted] Ride ${populatedRide._id} has no populated driver; skipping driver-room emits`);
    emitToRoom(getRideRoom(populatedRide._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
      rideId: String(populatedRide._id),
      status: populatedRide.status,
      liveStatus: populatedRide.liveStatus,
      acceptedAt: populatedRide.acceptedAt,
    });
    return;
  }

  emitToRoom(getUserRoom(populatedRide.userId), 'rideAccepted', {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    type: populatedRide.serviceType || 'ride',
    serviceType: populatedRide.serviceType || 'ride',
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    otp: populatedRide.otp || '',
    vehicleIconType: populatedRide.vehicleIconType || '',
    vehicleIconUrl: populatedRide.vehicleIconUrl || '',
    driver: populatedRide.driverId,
    parcel: populatedRide.parcel || null,
  });

  emitToRoom(getUserRoom(populatedRide.userId), SOCKET_EVENTS.RIDE_STATE, {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    type: populatedRide.serviceType || 'ride',
    serviceType: populatedRide.serviceType || 'ride',
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    fare: populatedRide.fare,
    estimatedDistanceMeters: populatedRide.estimatedDistanceMeters || 0,
    estimatedDurationMinutes: populatedRide.estimatedDurationMinutes || 0,
    paymentMethod: populatedRide.paymentMethod,
    otp: populatedRide.otp || '',
    vehicleIconType: populatedRide.vehicleIconType || '',
    vehicleIconUrl: populatedRide.vehicleIconUrl || '',
    parcel: populatedRide.parcel || null,
    intercity: populatedRide.intercity || null,
    commissionAmount: populatedRide.commissionAmount,
    driverEarnings: populatedRide.driverEarnings,
    pickupLocation: populatedRide.pickupLocation,
    pickupAddress: populatedRide.pickupAddress || '',
    dropLocation: populatedRide.dropLocation,
    dropAddress: populatedRide.dropAddress || '',
    acceptedAt: populatedRide.acceptedAt,
    startedAt: populatedRide.startedAt,
    completedAt: populatedRide.completedAt,
    lastDriverLocation: populatedRide.lastDriverLocation?.coordinates?.length
      ? {
          type: populatedRide.lastDriverLocation.type,
          coordinates: populatedRide.lastDriverLocation.coordinates,
          heading: populatedRide.lastDriverLocation.heading,
          speed: populatedRide.lastDriverLocation.speed,
          updatedAt: populatedRide.lastDriverLocation.updatedAt,
        }
      : null,
    driver: populatedRide.driverId,
  });

  emitToRoom(getRideRoom(populatedRide._id), SOCKET_EVENTS.RIDE_STATUS_UPDATED, {
    rideId: String(populatedRide._id),
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    acceptedAt: populatedRide.acceptedAt,
  });

  emitToRoom(getDriverRoom(populatedRide.driverId._id), 'rideAccepted', {
    rideId: String(populatedRide._id),
    room: getRideRoom(populatedRide._id),
    status: populatedRide.status,
    liveStatus: populatedRide.liveStatus,
    acceptedAt: populatedRide.acceptedAt,
    otp: populatedRide.otp || '',
  });

  emitToRoom(getRideRoom(populatedRide._id), 'rideRequestClosed', {
    rideId: String(populatedRide._id),
        acceptedDriverId: String(populatedRide.driverId._id),
        notifiedDriverIds: state.notifiedDriverIds,
        reason: 'accepted-by-another-driver',
  });

  for (const driverId of state.notifiedDriverIds) {
    emitToDriver(driverId, 'rideRequestClosed', {
      rideId: String(populatedRide._id),
      acceptedDriverId: String(populatedRide.driverId._id),
      reason: 'accepted-by-another-driver',
    });
  }

  sendPushNotificationToEntities({
    userIds: [String(populatedRide.userId)],
    title: 'Ride accepted',
    body: populatedRide.driverId?.name
      ? `${populatedRide.driverId.name} accepted your request.`
      : 'A driver accepted your request.',
    data: {
      type: 'ride_accepted',
      rideId: String(populatedRide._id),
      serviceType: populatedRide.serviceType || 'ride',
      driverId: String(populatedRide.driverId?._id || ''),
    },
  }).catch((error) => {
    console.error('Failed to send user ride-accepted push notification', error);
  });
};

export const notifyRideBidUpdated = async ({ ride, bid }) => {
  const safeRide = ride?._id ? ride : await Ride.findById(ride?.rideId || ride);

  if (!safeRide) {
    return;
  }

  const payload = {
    rideId: String(safeRide._id),
    bookingMode: safeRide.bookingMode || 'normal',
    pricingNegotiationMode: safeRide.pricingNegotiationMode || 'none',
    biddingStatus: safeRide.biddingStatus || 'none',
    fare: Number(safeRide.fare || 0),
    baseFare: Number(safeRide.baseFare || safeRide.fare || 0),
    bidFloorFare: Number(safeRide.bidFloorFare ?? safeRide.baseFare ?? safeRide.fare ?? 0),
    userMaxBidFare: Number(safeRide.userMaxBidFare || safeRide.fare || 0),
    bidCeilingMaxFare: Number(safeRide.bidCeilingMaxFare || safeRide.userMaxBidFare || safeRide.fare || 0),
    bidStepAmount: Number(safeRide.bidStepAmount || 10),
    fareIncreaseWaitMinutes: Number(safeRide.fareIncreaseWaitMinutes || 0),
    nextFareIncreaseAt: safeRide.nextFareIncreaseAt || null,
    bid,
  };

  emitToRoom(getUserRoom(safeRide.userId), 'rideBidUpdated', payload);
  emitToRoom(getRideRoom(safeRide._id), 'rideBidUpdated', payload);
};

export const notifyRideBiddingUpdated = async (ride) => {
  const safeRide = ride?._id ? ride : await Ride.findById(ride);

  if (!safeRide) {
    return;
  }

  const payload = {
    rideId: String(safeRide._id),
    bookingMode: safeRide.bookingMode || 'normal',
    pricingNegotiationMode: safeRide.pricingNegotiationMode || 'none',
    biddingStatus: safeRide.biddingStatus || 'none',
    fare: Number(safeRide.fare || 0),
    baseFare: Number(safeRide.baseFare || safeRide.fare || 0),
    bidFloorFare: Number(safeRide.bidFloorFare ?? safeRide.baseFare ?? safeRide.fare ?? 0),
    userMaxBidFare: Number(safeRide.userMaxBidFare || safeRide.fare || 0),
    bidCeilingMaxFare: Number(safeRide.bidCeilingMaxFare || safeRide.userMaxBidFare || safeRide.fare || 0),
    bidStepAmount: Number(safeRide.bidStepAmount || 10),
    fareIncreaseWaitMinutes: Number(safeRide.fareIncreaseWaitMinutes || 0),
    nextFareIncreaseAt: safeRide.nextFareIncreaseAt || null,
  };

  emitToRoom(getUserRoom(safeRide.userId), 'rideBiddingUpdated', payload);
  emitToRoom(getRideRoom(safeRide._id), 'rideBiddingUpdated', payload);

  const dispatchState = getDispatchState(safeRide._id);
  for (const driverId of dispatchState.notifiedDriverIds) {
    emitToDriver(driverId, 'rideBiddingUpdated', payload);
  }
};

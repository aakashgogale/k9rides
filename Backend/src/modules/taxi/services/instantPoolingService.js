import mongoose from 'mongoose';
import { InstantPoolGroup } from '../admin/models/InstantPoolGroup.js';
import { Ride } from '../user/models/Ride.js';
import { Driver } from '../driver/models/Driver.js';
import { User } from '../user/models/User.js';
import { findOptimalRouteSequence } from './routeOptimizer.js';
import { getInstantPoolingSettings } from './transportSettingsService.js';
import { emitToRoom, getUserRoom, getDriverRoom, applyDriverWalletAdjustmentByReference } from './dispatchService.js';
import { getRideRoom } from './rideService.js';

/**
 * Audit log helper
 */
const auditLog = (event, metadata = {}) => {
  console.log(`[POOLING_AUDIT] Event: ${event}, Time: ${new Date().toISOString()}, Data:`, JSON.stringify(metadata));
};

/**
 * Creates a new pool group when the first passenger's request is accepted by a driver.
 */
export const createPoolGroup = async (driverId, vehicleTypeId, firstRide) => {
  const settings = await getInstantPoolingSettings();
  const driver = await Driver.findById(driverId);

  const newGroup = new InstantPoolGroup({
    driverId,
    vehicleTypeId,
    activeRides: [firstRide._id],
    totalCapacity: driver?.maxPoolSeats || 4,
    occupiedSeats: firstRide.poolSeats || 1,
    status: 'created',
    routeVersion: 1,
  });

  const optimalSeq = findOptimalRouteSequence(
    driver.location.coordinates,
    [firstRide],
    {
      maxDetourMeters: Number(settings.max_detour_meters || 5000),
      maxEtaIncreaseMinutes: Number(settings.max_eta_increase_minutes || 15),
    }
  );

  newGroup.routeSequence = optimalSeq;
  await newGroup.save();

  // Update Driver status
  await Driver.findByIdAndUpdate(driverId, {
    isOnRide: true,
    activePoolGroupId: newGroup._id,
    poolOccupiedSeats: firstRide.poolSeats || 1,
    activePoolRideCount: 1,
  });

  // Update first ride status
  firstRide.poolGroupId = newGroup._id;
  firstRide.status = 'accepted';
  firstRide.liveStatus = 'accepted';
  firstRide.driverId = driverId;
  firstRide.routeVersion = 1;
  await firstRide.save();

  auditLog('Pool Created', { poolGroupId: newGroup._id, driverId, rideId: firstRide._id });

  // Broadcast socket events
  emitToRoom(getDriverRoom(driverId), 'pool.created', { poolGroupId: newGroup._id, routeVersion: 1 });
  broadcastPoolUpdate(newGroup);

  return newGroup;
};

/**
 * Adds a passenger ride to an existing pool group if detour and seats permit.
 */
export const addRideToPoolGroup = async (poolGroupId, newRide) => {
  const group = await InstantPoolGroup.findById(poolGroupId).populate('activeRides');
  if (!group || group.status === 'completed' || group.status === 'cancelled') {
    return false;
  }

  const driver = await Driver.findById(group.driverId);
  const settings = await getInstantPoolingSettings();

  const requiredSeats = newRide.poolSeats || 1;

  // ponytail: guard against a driver with no GPS fix before routing (would throw on .coordinates).
  if (!driver?.location?.coordinates) {
    return false;
  }

  // ponytail: claim seats atomically so two concurrent joins can't overbook the vehicle.
  // The $expr guard rejects the update if occupiedSeats + requiredSeats would exceed capacity.
  const claimed = await InstantPoolGroup.findOneAndUpdate(
    {
      _id: poolGroupId,
      status: { $nin: ['completed', 'cancelled'] },
      // $ifNull so legacy groups without totalCapacity default to 4 instead of failing every claim.
      $expr: { $lte: [{ $add: ['$occupiedSeats', requiredSeats] }, { $ifNull: ['$totalCapacity', 4] }] },
    },
    { $inc: { occupiedSeats: requiredSeats } },
    { new: true }
  );
  if (!claimed) {
    return false; // full, or group gone
  }

  const releaseSeats = () =>
    InstantPoolGroup.updateOne({ _id: poolGroupId }, { $inc: { occupiedSeats: -requiredSeats } });

  // Everything after the seat claim must release the seats on ANY failure, or the claim leaks
  // and the group is permanently under-capacity.
  let updatedGroup;
  try {
    // Populate active rides with user details for sequence name rendering
    const populatedActiveRides = await Ride.find({
      _id: { $in: [...group.activeRides.map(r => r._id), newRide._id] }
    }).populate('userId', 'name');

    const optimalSeq = findOptimalRouteSequence(
      driver.location.coordinates,
      populatedActiveRides,
      {
        maxDetourMeters: Number(settings.max_detour_meters || 5000),
        maxEtaIncreaseMinutes: Number(settings.max_eta_increase_minutes || 15),
      }
    );

    // If sequence optimization returns empty, detour rules were violated — give the seats back.
    if (optimalSeq.length === 0) {
      await releaseSeats();
      return false;
    }

    // Atomically attach the ride + bump route version (avoids clobbering a concurrent join's array).
    updatedGroup = await InstantPoolGroup.findByIdAndUpdate(
      poolGroupId,
      {
        $push: { activeRides: newRide._id },
        $set: { routeSequence: optimalSeq, status: 'active' },
        $inc: { routeVersion: 1 },
      },
      { new: true }
    );

    // Update driver details
    await Driver.findByIdAndUpdate(group.driverId, {
      poolOccupiedSeats: updatedGroup.occupiedSeats,
      activePoolRideCount: updatedGroup.activeRides.length,
    });

    // Link ride to pool group
    newRide.poolGroupId = group._id;
    newRide.status = 'accepted';
    newRide.liveStatus = 'accepted';
    newRide.driverId = group.driverId;
    newRide.routeVersion = updatedGroup.routeVersion;
    await newRide.save();

    // Increment route version on existing rides too
    await Ride.updateMany(
      { _id: { $in: updatedGroup.activeRides } },
      { $set: { routeVersion: updatedGroup.routeVersion } }
    );
  } catch (err) {
    await releaseSeats().catch(() => {});
    throw err;
  }

  auditLog('Passenger Joined', { poolGroupId: group._id, rideId: newRide._id });

  // Emit joins and updates
  emitToRoom(getDriverRoom(group.driverId), 'pool.member.joined', {
    rideId: String(newRide._id),
    poolGroupId: String(group._id),
    routeVersion: updatedGroup.routeVersion,
  });

  for (const ride of group.activeRides) {
    if (String(ride._id) !== String(newRide._id)) {
      emitToRoom(getRideRoom(ride._id), 'pool.member.joined', {
        message: 'Another passenger has joined your shared ride.',
        routeVersion: updatedGroup.routeVersion,
      });
    }
  }

  broadcastPoolUpdate(updatedGroup);
  return true;
};

/**
 * Atomically detaches a ride from a pool group: pulls it from activeRides, decrements
 * occupiedSeats (floored at 0), and bumps routeVersion — all in one aggregation-pipeline
 * update so concurrent leaves/completions can't clobber each other (Uber/Ola-style seat
 * accounting). Returns the updated group (or null if it was gone).
 */
const detachRideFromGroupAtomic = async (poolGroupId, rideId, releasedSeats) => {
  const rideObjId = new mongoose.Types.ObjectId(String(rideId));
  return InstantPoolGroup.findByIdAndUpdate(
    poolGroupId,
    [
      {
        $set: {
          activeRides: {
            $filter: {
              input: { $ifNull: ['$activeRides', []] },
              as: 'r',
              cond: { $ne: ['$$r', rideObjId] },
            },
          },
          // Only release seats if the ride is actually still in the group, so a double-remove
          // (or a remove racing a completion of the same ride) can't over-decrement.
          occupiedSeats: {
            $max: [
              0,
              {
                $subtract: [
                  { $ifNull: ['$occupiedSeats', 0] },
                  { $cond: [{ $in: [rideObjId, { $ifNull: ['$activeRides', []] }] }, releasedSeats, 0] },
                ],
              },
            ],
          },
          routeVersion: { $add: [{ $ifNull: ['$routeVersion', 0] }, 1] },
        },
      },
    ],
    { new: true },
  );
};

/**
 * Conditionally closes a pool group and frees the driver — only the caller that actually flips
 * status to 'completed' releases the driver, so simultaneous last-passenger events don't double-run.
 */
const closePoolGroup = async (group) => {
  const closed = await InstantPoolGroup.findOneAndUpdate(
    { _id: group._id, status: { $ne: 'completed' } },
    { $set: { status: 'completed' } },
    { new: true },
  );
  if (closed) {
    await Driver.findByIdAndUpdate(group.driverId, {
      isOnRide: false,
      activePoolGroupId: null,
      poolOccupiedSeats: 0,
      activePoolRideCount: 0,
    });
  }
  return closed;
};

/**
 * Removes a passenger ride from a pool group (cancellation or reject).
 */
export const removeRideFromPoolGroup = async (poolGroupId, rideId, cancelReason = 'cancelled') => {
  const targetRide = await Ride.findById(rideId);
  const releasedSeats = targetRide?.poolSeats || 1;

  // Clean ride document
  if (targetRide) {
    targetRide.poolGroupId = null;
    targetRide.status = 'cancelled';
    targetRide.liveStatus = 'cancelled';
    await targetRide.save();
  }

  const group = await detachRideFromGroupAtomic(poolGroupId, rideId, releasedSeats);
  if (!group) return;

  auditLog('Passenger Left', { poolGroupId, rideId, reason: cancelReason });

  if (group.activeRides.length === 0) {
    const closed = await closePoolGroup(group);
    if (closed) {
      emitToRoom(getDriverRoom(group.driverId), 'pool.closed', { poolGroupId, routeVersion: group.routeVersion });
      auditLog('Pool Closed', { poolGroupId });
    }
    return;
  }

  // Re-optimize route with remaining rides (persist routeSequence via targeted $set, not a
  // full-doc save, so it can't clobber the atomic seat/version fields).
  const driver = await Driver.findById(group.driverId);
  const settings = await getInstantPoolingSettings();
  const remainingRides = await Ride.find({ _id: { $in: group.activeRides } }).populate('userId', 'name');

  if (driver?.location?.coordinates) {
    const optimalSeq = findOptimalRouteSequence(
      driver.location.coordinates,
      remainingRides,
      {
        maxDetourMeters: Number(settings.max_detour_meters || 5000),
        maxEtaIncreaseMinutes: Number(settings.max_eta_increase_minutes || 15),
      }
    );
    await InstantPoolGroup.updateOne({ _id: poolGroupId }, { $set: { routeSequence: optimalSeq } });
    group.routeSequence = optimalSeq;
  }

  await Driver.findByIdAndUpdate(group.driverId, {
    poolOccupiedSeats: group.occupiedSeats,
    activePoolRideCount: group.activeRides.length,
  });

  await Ride.updateMany(
    { _id: { $in: group.activeRides } },
    { $set: { routeVersion: group.routeVersion } }
  );

  emitToRoom(getDriverRoom(group.driverId), 'pool.member.left', {
    rideId,
    poolGroupId,
    routeVersion: group.routeVersion,
  });
  for (const ride of remainingRides) {
    emitToRoom(getRideRoom(ride._id), 'pool.member.left', {
      message: 'A co-rider left the shared ride.',
      routeVersion: group.routeVersion,
    });
  }

  broadcastPoolUpdate(group);
};

/**
 * Verifies individual passenger boarding OTP.
 */
export const verifyPassengerOtp = async (rideId, otpInput) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new Error('Ride not found');

  if (String(ride.otp) !== String(otpInput)) {
    throw new Error('Invalid verification OTP');
  }

  ride.status = 'ongoing';
  ride.liveStatus = 'started';
  ride.startedAt = new Date();
  await ride.save();

  auditLog('OTP Verified', { rideId });

  if (ride.poolGroupId) {
    const group = await InstantPoolGroup.findById(ride.poolGroupId);
    if (group) {
      // Mark pickup stop as completed
      group.routeSequence = group.routeSequence.map(stop => {
        if (String(stop.rideId) === String(rideId) && stop.type === 'pickup') {
          return { ...stop, status: 'completed' };
        }
        return stop;
      });
      group.routeVersion += 1;
      await group.save();

      emitToRoom(getRideRoom(rideId), 'otp.verified', { rideId, status: 'started' });
      broadcastPoolUpdate(group);
    }
  }

  return ride;
};

/**
 * Completes a passenger ride in the pool group and settles earnings/comissions.
 */
export const completePassengerRide = async (rideId) => {
  const ride = await Ride.findById(rideId);
  if (!ride) throw new Error('Ride not found');

  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    ride.status = 'completed';
    ride.liveStatus = 'completed';
    ride.completedAt = new Date();

    // Settle commission and driver earnings (Task 8, 9, 10)
    const baseFare = Number(ride.fare || 0);
    const settings = await getInstantPoolingSettings();
    
    // Platform commission calculations
    const commissionPercent = Number(settings.admin_commission_from_driver || 15);
    const adminCommission = Math.round((baseFare * commissionPercent) / 100);
    const driverEarnings = Math.max(0, baseFare - adminCommission);

    ride.commissionAmount = adminCommission;
    ride.driverEarnings = driverEarnings;
    await ride.save({ session });

    // ponytail: mirror the non-pool settlement (walletService) — for CASH rides the driver
    // already collected the fare in hand, so the wallet must be DEBITED the commission, not
    // credited the earnings (otherwise the driver is paid twice and the platform loses its cut).
    const isCash = String(ride.paymentMethod || '').toLowerCase() === 'cash';
    const walletAmount = isCash ? -adminCommission : driverEarnings;

    // Update driver wallet balance
    const walletRef = `pool-completion:${rideId}`;
    await applyDriverWalletAdjustmentByReference({
      driverId: ride.driverId,
      amount: walletAmount,
      rideId: ride._id,
      description: isCash
        ? `Commission for cash pooled ride ${String(ride._id).slice(-6)}`
        : `Earnings for pooled ride ${String(ride._id).slice(-6)}`,
      referenceKey: walletRef,
      session,
    });

    await User.findByIdAndUpdate(ride.userId, { currentRideId: null }, { session });

    await session.commitTransaction();
    auditLog('Trip Completed', { rideId, driverEarnings, adminCommission });
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }

  if (ride.poolGroupId) {
    // Atomic detach (pull + seat dec + version bump) — safe under concurrent drops/completions.
    const group = await detachRideFromGroupAtomic(ride.poolGroupId, rideId, ride.poolSeats || 1);
    if (group) {
      if (group.activeRides.length === 0) {
        const closed = await closePoolGroup(group);
        if (closed) {
          emitToRoom(getDriverRoom(group.driverId), 'pool.closed', {
            poolGroupId: group._id,
            routeVersion: group.routeVersion,
          });
          auditLog('Pool Closed', { poolGroupId: group._id });
        }
      } else {
        // Mark this ride's drop stop completed and persist routeSequence via targeted $set.
        const newSeq = (group.routeSequence || []).map((stop) => {
          const s = stop?.toObject ? stop.toObject() : stop;
          return (String(s.rideId) === String(rideId) && s.type === 'drop')
            ? { ...s, status: 'completed' }
            : s;
        });
        await InstantPoolGroup.updateOne({ _id: group._id }, { $set: { routeSequence: newSeq } });
        group.routeSequence = newSeq;

        await Driver.findByIdAndUpdate(group.driverId, {
          poolOccupiedSeats: group.occupiedSeats,
          activePoolRideCount: group.activeRides.length,
        });
        broadcastPoolUpdate(group);
      }

      emitToRoom(getRideRoom(rideId), 'trip.completed', { rideId, status: 'completed' });
    }
  }
};

/**
 * Broadcasts pool state updates to the driver and all passengers in the group.
 */
export const broadcastPoolUpdate = (group) => {
  const payload = {
    poolGroupId: String(group._id),
    driverId: String(group.driverId),
    status: group.status,
    occupiedSeats: group.occupiedSeats,
    totalCapacity: group.totalCapacity,
    routeVersion: group.routeVersion,
    routeSequence: group.routeSequence.map(stop => ({
      id: String(stop._id),
      type: stop.type,
      rideId: String(stop.rideId),
      address: stop.address,
      coordinates: stop.coordinates,
      etaMinutes: stop.etaMinutes,
      passengerName: stop.passengerName,
      status: stop.status,
    })),
  };

  // Broadcast to driver
  emitToRoom(getDriverRoom(group.driverId), 'pool.updated', payload);
  emitToRoom(getDriverRoom(group.driverId), 'route.updated', payload);

  // Broadcast to each passenger
  for (const rideId of group.activeRides) {
    emitToRoom(getRideRoom(rideId), 'pool.updated', payload);
    emitToRoom(getRideRoom(rideId), 'route.updated', payload);
  }
};

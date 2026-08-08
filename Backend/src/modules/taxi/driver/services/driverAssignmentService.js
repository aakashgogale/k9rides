import { Driver } from '../models/Driver.js';

/**
 * Cross-service busy-lock for a unified driver.
 *
 * A driver may hold exactly ONE active assignment at a time — a taxi ride OR a food delivery.
 * Both dispatchers acquire the lock atomically before assigning, so a driver can never be
 * double-booked across services. Pool rides are the deliberate exception (a driver runs one
 * pool GROUP that holds several rides), so pooled assignment does not use this lock.
 *
 * The lock lives on Driver.activeAssignment: { type:'ride'|'delivery', id, at } | null.
 */

/**
 * Atomically claim the lock. Succeeds only if the driver is currently free (activeAssignment null)
 * OR already holds this exact assignment (idempotent re-acquire). Returns true if the caller holds it.
 */
export const acquireDriverAssignment = async (driverId, type, id, session = null) => {
  if (!driverId || !type || !id) return false;
  const res = await Driver.findOneAndUpdate(
    {
      _id: driverId,
      $or: [
        { activeAssignment: null },
        { activeAssignment: { $exists: false } },
        { 'activeAssignment.type': type, 'activeAssignment.id': id },
      ],
    },
    { $set: { activeAssignment: { type, id, at: new Date() } } },
    { new: true, session },
  );
  return Boolean(res);
};

/**
 * Release the lock, but only if it still points at THIS assignment — so a stale release
 * (late completion of an old ride) can't clear a lock that a newer assignment already took.
 */
export const releaseDriverAssignment = async (driverId, id, session = null) => {
  if (!driverId || !id) return false;
  const res = await Driver.updateOne(
    { _id: driverId, 'activeAssignment.id': id },
    { $set: { activeAssignment: null } },
    { session },
  );
  return Boolean(res?.modifiedCount);
};

/** Force-clear the lock regardless of what it holds (admin/recovery use only). */
export const forceClearDriverAssignment = async (driverId, session = null) => {
  if (!driverId) return false;
  const res = await Driver.updateOne(
    { _id: driverId },
    { $set: { activeAssignment: null } },
    { session },
  );
  return Boolean(res?.modifiedCount);
};

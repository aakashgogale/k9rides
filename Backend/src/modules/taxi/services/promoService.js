import mongoose from 'mongoose';
import { ApiError } from '../../../utils/ApiError.js';
import { PromoCode } from '../admin/promotions/models/PromoCode.js';
import { PromoRedemption } from '../admin/promotions/models/PromoRedemption.js';
import { PromoUserCounter } from '../admin/promotions/models/PromoUserCounter.js';
import { Ride } from '../user/models/Ride.js';

const normalizeText = (value) => String(value ?? '').trim();

export const normalizePromoCode = (value) => normalizeText(value).toUpperCase();

const normalizeTransportType = (value) => {
  const normalized = normalizeText(value || 'taxi').toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'texi') return 'taxi';
  if (normalized === 'selfdrive') return 'self_drive';
  return normalized || 'taxi';
};

const toObjectIdOrThrow = (value, fieldName = 'id') => {
  if (!mongoose.isValidObjectId(value)) {
    throw new ApiError(400, `Invalid ${fieldName}`);
  }
  return new mongoose.Types.ObjectId(String(value));
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const getPromoServiceLocationIds = (promo) => {
  const locationIds = Array.isArray(promo?.service_location_ids) && promo.service_location_ids.length > 0
    ? promo.service_location_ids
    : promo?.service_location_id
      ? [promo.service_location_id]
      : [];

  return [...new Set(locationIds.map((value) => String(value || '').trim()).filter(Boolean))];
};

const getPromoAudienceType = (promo) => {
  const normalized = normalizeText(promo?.audience_type).toLowerCase().replace(/\s+/g, '_');
  if (['all', 'specific_user', 'new_users'].includes(normalized)) {
    return normalized;
  }

  if (promo?.user_specific === true) {
    return 'specific_user';
  }

  return 'all';
};

const isUserEligibleForPromoAudience = async ({ promo, userId }) => {
  const audienceType = getPromoAudienceType(promo);

  if (audienceType === 'specific_user') {
    if (!userId) {
      return { eligible: false, reason: 'USER_REQUIRED', message: 'User is required for this promo code' };
    }
    if (String(promo.user_id || '') !== String(userId)) {
      return { eligible: false, reason: 'USER_MISMATCH', message: 'Promo code is not valid for this user' };
    }
    return { eligible: true, audienceType };
  }

  if (audienceType === 'new_users') {
    if (!userId) {
      return { eligible: false, reason: 'USER_REQUIRED', message: 'User is required for this promo code' };
    }

    // ponytail: "new user" = no COMPLETED rides. Counting any ride (incl. searching/cancelled)
    // permanently locked out users whose only prior ride auto-cancelled while unmatched.
    const hasCompletedRide = await Ride.exists({ userId: toObjectIdOrThrow(userId, 'user id'), status: 'completed' });
    if (hasCompletedRide) {
      return { eligible: false, reason: 'NEW_USERS_ONLY', message: 'Promo code is only valid for new users' };
    }
  }

  return { eligible: true, audienceType };
};

export const computePromoDiscount = ({ fare, promo, userCounter }) => {
  const safeFare = Number(fare);
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    throw new ApiError(400, 'fare must be a positive number or zero');
  }

  const discountPercentage = clamp(Number(promo?.discount_percentage || 0), 0, 100);
  const rawDiscount = safeFare * (discountPercentage / 100);
  const maximumDiscountAmount = Math.max(0, Number(promo?.maximum_discount_amount || 0));

  const cappedDiscount = maximumDiscountAmount > 0 ? Math.min(rawDiscount, maximumDiscountAmount) : rawDiscount;

  const cumulativeCap = Math.max(0, Number(promo?.cumulative_max_discount_amount || 0));
  const usedCumulative = Math.max(0, Number(userCounter?.cumulative_discount_amount || 0));
  const remainingCumulative = cumulativeCap > 0 ? Math.max(0, cumulativeCap - usedCumulative) : null;

  const finalDiscount = remainingCumulative !== null ? Math.min(cappedDiscount, remainingCumulative) : cappedDiscount;
  const fareAfter = Math.max(0, safeFare - finalDiscount);

  return {
    fare_before_discount: safeFare,
    raw_discount: rawDiscount,
    capped_discount: cappedDiscount,
    discount_amount: finalDiscount,
    fare_after_discount: fareAfter,
    caps: {
      maximum_discount_amount: maximumDiscountAmount,
      cumulative_max_discount_amount: cumulativeCap,
      cumulative_used: usedCumulative,
      cumulative_remaining: remainingCumulative,
    },
    discount_percentage: discountPercentage,
  };
};

export const validatePromoForContext = async ({
  code,
  userId,
  fare,
  service_location_id,
  transport_type = 'taxi',
  now = new Date(),
}) => {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) {
    return { eligible: false, reason: 'CODE_REQUIRED', message: 'Promo code is required' };
  }

  const promo = await PromoCode.findOne({ code: normalizedCode }).lean();
  if (!promo) {
    return { eligible: false, reason: 'NOT_FOUND', message: 'Promo code not found' };
  }

  const transportType = normalizeTransportType(transport_type);
  const serviceLocationId = service_location_id ? String(service_location_id) : '';
  const promoServiceLocationIds = getPromoServiceLocationIds(promo);

  if (promo.active === false) {
    return { eligible: false, reason: 'INACTIVE', message: 'Promo code is inactive' };
  }

  if (promo.from_date && now < new Date(promo.from_date)) {
    return { eligible: false, reason: 'NOT_STARTED', message: 'Promo code is not active yet' };
  }

  if (promo.to_date && now > new Date(promo.to_date)) {
    return { eligible: false, reason: 'EXPIRED', message: 'Promo code has expired' };
  }

  if (!serviceLocationId) {
    return { eligible: false, reason: 'SERVICE_LOCATION_REQUIRED', message: 'service_location_id is required' };
  }

  if (promoServiceLocationIds.length > 0 && !promoServiceLocationIds.includes(serviceLocationId)) {
    return {
      eligible: false,
      reason: 'SERVICE_LOCATION_MISMATCH',
      message: 'Promo code is not valid for this service location',
    };
  }

  if (promo.transport_type && promo.transport_type !== 'all' && promo.transport_type !== transportType) {
    return { eligible: false, reason: 'TRANSPORT_TYPE_MISMATCH', message: 'Promo code is not valid for this transport type' };
  }

  const audienceEligibility = await isUserEligibleForPromoAudience({ promo, userId });
  if (!audienceEligibility.eligible) {
    return audienceEligibility;
  }

  const minimumTripAmount = Math.max(0, Number(promo.minimum_trip_amount || 0));
  const safeFare = Number(fare);
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    return { eligible: false, reason: 'INVALID_FARE', message: 'fare must be a positive number or zero' };
  }
  if (safeFare < minimumTripAmount) {
    return { eligible: false, reason: 'MIN_TRIP', message: `Minimum trip amount is ${minimumTripAmount}` };
  }

  const [userCounter, promoFresh] = await Promise.all([
    userId && mongoose.isValidObjectId(userId)
      ? PromoUserCounter.findOne({ promo_id: promo._id, user_id: toObjectIdOrThrow(userId, 'user id') }).lean()
      : Promise.resolve(null),
    PromoCode.findById(promo._id).select('usage_count max_uses_total uses_per_user').lean(),
  ]);

  const maxUsesTotal = Math.max(0, Number(promoFresh?.max_uses_total || promo.max_uses_total || 0));
  const usageCount = Math.max(0, Number(promoFresh?.usage_count || promo.usage_count || 0));
  if (maxUsesTotal > 0 && usageCount >= maxUsesTotal) {
    return { eligible: false, reason: 'MAX_USES_REACHED', message: 'Promo code usage limit reached' };
  }

  const usesPerUser = Math.max(1, Number(promoFresh?.uses_per_user || promo.uses_per_user || 1));
  const userUses = Math.max(0, Number(userCounter?.uses_count || 0));
  if (userId && userUses >= usesPerUser) {
    return { eligible: false, reason: 'USER_MAX_USES_REACHED', message: 'Promo code usage limit reached for user' };
  }

  const breakdown = computePromoDiscount({ fare: safeFare, promo, userCounter });
  if (breakdown.discount_amount <= 0) {
    return { eligible: false, reason: 'NO_DISCOUNT', message: 'Promo code does not provide a discount for this fare' };
  }

  return {
    eligible: true,
    promo: {
      _id: promo._id,
      code: promo.code,
      service_location_id: promo.service_location_id,
      service_location_ids: promoServiceLocationIds,
      transport_type: promo.transport_type,
      user_specific: getPromoAudienceType(promo) === 'specific_user',
      audience_type: audienceEligibility.audienceType,
      user_id: promo.user_id || '',
      minimum_trip_amount: Number(promo.minimum_trip_amount || 0),
      maximum_discount_amount: Number(promo.maximum_discount_amount || 0),
      cumulative_max_discount_amount: Number(promo.cumulative_max_discount_amount || 0),
      discount_percentage: Number(promo.discount_percentage || 0),
      uses_per_user: Number(promo.uses_per_user || 1),
      max_uses_total: Number(promo.max_uses_total || 0),
      usage_count: Number(usageCount || 0),
      active: promo.active !== false,
      from_date: promo.from_date,
      to_date: promo.to_date,
    },
    breakdown,
  };
};

export const applyPromoToRideInTransaction = async ({
  session,
  ride,
  userId,
  code,
  fare,
  service_location_id,
  transport_type = 'taxi',
  surgeAmount = 0,
}) => {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) {
    throw new ApiError(400, 'Promo code is required');
  }
  if (!service_location_id) {
    throw new ApiError(400, 'service_location_id is required when applying promo');
  }
  if (!userId) {
    throw new ApiError(400, 'User is required when applying promo');
  }

  const transportType = normalizeTransportType(transport_type);
  const serviceLocationId = toObjectIdOrThrow(service_location_id, 'service location id');
  const userObjectId = toObjectIdOrThrow(userId, 'user id');

  const promo = await PromoCode.findOne({ code: normalizedCode }).session(session);
  if (!promo) {
    throw new ApiError(404, 'Promo code not found');
  }

  const now = new Date();
  if (promo.active === false) {
    throw new ApiError(400, 'Promo code is inactive');
  }
  if (promo.from_date && now < promo.from_date) {
    throw new ApiError(400, 'Promo code is not active yet');
  }
  if (promo.to_date && now > promo.to_date) {
    throw new ApiError(400, 'Promo code has expired');
  }

  const promoServiceLocationIds = getPromoServiceLocationIds(promo);
  if (promoServiceLocationIds.length > 0 && !promoServiceLocationIds.includes(String(serviceLocationId))) {
    throw new ApiError(400, 'Promo code is not valid for this service location');
  }

  if (promo.transport_type !== 'all' && promo.transport_type !== transportType) {
    throw new ApiError(400, 'Promo code is not valid for this transport type');
  }

  const audienceEligibility = await isUserEligibleForPromoAudience({ promo, userId });
  if (!audienceEligibility.eligible) {
    throw new ApiError(400, audienceEligibility.message);
  }

  const safeFare = Number(fare);
  const minimumTripAmount = Math.max(0, Number(promo.minimum_trip_amount || 0));
  if (!Number.isFinite(safeFare) || safeFare < 0) {
    throw new ApiError(400, 'fare must be a positive number or zero');
  }
  if (safeFare < minimumTripAmount) {
    throw new ApiError(400, `Minimum trip amount is ${minimumTripAmount}`);
  }

  const maxUsesTotal = Math.max(0, Number(promo.max_uses_total || 0));
  if (maxUsesTotal > 0 && Number(promo.usage_count || 0) >= maxUsesTotal) {
    throw new ApiError(409, 'Promo code usage limit reached');
  }

  const userCounter = await PromoUserCounter.findOne({ promo_id: promo._id, user_id: userObjectId }).session(session);
  const usesPerUser = Math.max(1, Number(promo.uses_per_user || 1));
  if (userCounter && Number(userCounter.uses_count || 0) >= usesPerUser) {
    throw new ApiError(409, 'Promo code usage limit reached for user');
  }

  const breakdown = computePromoDiscount({ fare: safeFare, promo, userCounter });
  if (breakdown.discount_amount <= 0) {
    throw new ApiError(400, 'Promo code does not provide a discount for this fare');
  }

  const promoUpdateQuery = { _id: promo._id };
  if (maxUsesTotal > 0) {
    promoUpdateQuery.usage_count = { $lt: maxUsesTotal };
  }

  const promoUpdated = await PromoCode.findOneAndUpdate(promoUpdateQuery, { $inc: { usage_count: 1 } }, { returnDocument: 'after', session });
  if (!promoUpdated) {
    throw new ApiError(409, 'Promo code usage limit reached');
  }

  const cumulativeCap = Math.max(0, Number(promo.cumulative_max_discount_amount || 0));
  const cumulativeCeiling = cumulativeCap > 0 ? cumulativeCap - breakdown.discount_amount : null;

  if (!userCounter) {
    if (cumulativeCap > 0 && breakdown.discount_amount > cumulativeCap) {
      throw new ApiError(409, 'Promo code cumulative discount cap reached for user');
    }

    await PromoUserCounter.create(
      [
        {
          promo_id: promo._id,
          user_id: userObjectId,
          uses_count: 1,
          cumulative_discount_amount: breakdown.discount_amount,
        },
      ],
      { session },
    );
  } else {
    const counterQuery = { _id: userCounter._id, uses_count: { $lt: usesPerUser } };
    if (cumulativeCeiling !== null) {
      counterQuery.cumulative_discount_amount = { $lte: cumulativeCeiling };
    }

    const counterUpdated = await PromoUserCounter.findOneAndUpdate(
      counterQuery,
      { $inc: { uses_count: 1, cumulative_discount_amount: breakdown.discount_amount } },
      { returnDocument: 'after', session },
    );

    if (!counterUpdated) {
      throw new ApiError(409, 'Promo code usage limit reached for user');
    }
  }

  await PromoRedemption.create(
    [
      {
        promo_id: promo._id,
        code: promo.code,
        user_id: userObjectId,
        ride_id: ride._id,
        service_location_id: serviceLocationId,
        transport_type: promo.transport_type || transportType,
        fare_before_discount: breakdown.fare_before_discount,
        discount_amount: breakdown.discount_amount,
        fare_after_discount: breakdown.fare_after_discount,
        discount_percentage_snapshot: breakdown.discount_percentage,
        maximum_discount_amount_snapshot: breakdown.caps.maximum_discount_amount,
        cumulative_max_discount_amount_snapshot: breakdown.caps.cumulative_max_discount_amount,
        uses_per_user_snapshot: usesPerUser,
        max_uses_total_snapshot: maxUsesTotal,
        status: 'applied',
        idempotency_key: normalizeText(`ride:${ride._id}:promo:${promo._id}`),
      },
    ],
    { session },
  );

  ride.promo = {
    code: promo.code,
    promo_id: promo._id,
    discount_amount: breakdown.discount_amount,
    fare_before_discount: breakdown.fare_before_discount,
    fare_after_discount: breakdown.fare_after_discount,
    service_location_id: serviceLocationId,
    transport_type: transportType,
    applied_at: new Date(),
  };
  ride.fare = breakdown.fare_after_discount + Math.max(0, Number(surgeAmount || 0));

  await ride.save({ session });

  return { promo: promoUpdated.toObject(), breakdown };
};

export const listAvailablePromosForUser = async ({
  userId,
  service_location_id,
  transport_type = 'taxi',
  now = new Date(),
  limit = 50,
}) => {
  const serviceLocationId = toObjectIdOrThrow(service_location_id, 'service location id');
  const transportType = normalizeTransportType(transport_type);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const query = {
    active: true,
    from_date: { $lte: now },
    to_date: { $gte: now },
    transport_type: { $in: ['all', transportType] },
    $and: [
      {
        $or: [
          { service_location_id: serviceLocationId },
          { service_location_ids: serviceLocationId },
        ],
      },
    ],
  };

  if (userId) {
    query.$and.push({
      $or: [
        { audience_type: 'all' },
        { audience_type: { $exists: false }, user_specific: { $ne: true } },
        { audience_type: 'specific_user', user_id: String(userId) },
        { audience_type: { $exists: false }, user_specific: true, user_id: String(userId) },
        { audience_type: 'new_users' },
      ],
    });
  } else {
    query.$and.push({
      $or: [
        { audience_type: 'all' },
        { audience_type: { $exists: false }, user_specific: { $ne: true } },
      ],
    });
  }

  const promos = await PromoCode.find(query).sort({ createdAt: -1 }).limit(safeLimit).lean();
  const userObjectId = userId && mongoose.isValidObjectId(userId) ? toObjectIdOrThrow(userId, 'user id') : null;
  const hasCompletedRide = userObjectId ? Boolean(await Ride.exists({ userId: userObjectId, status: 'completed' })) : false;

  return promos
    .filter((promo) => {
      const audienceType = getPromoAudienceType(promo);
      if (audienceType === 'new_users') {
        return userObjectId ? !hasCompletedRide : false;
      }
      if (audienceType === 'specific_user') {
        return userId ? String(promo.user_id || '') === String(userId) : false;
      }
      return true;
    })
    .map((promo) => ({
      _id: promo._id,
      code: promo.code,
      transport_type: promo.transport_type,
      service_location_id: promo.service_location_id,
      service_location_ids: getPromoServiceLocationIds(promo),
      user_specific: getPromoAudienceType(promo) === 'specific_user',
      audience_type: getPromoAudienceType(promo),
      minimum_trip_amount: Number(promo.minimum_trip_amount || 0),
      maximum_discount_amount: Number(promo.maximum_discount_amount || 0),
      cumulative_max_discount_amount: Number(promo.cumulative_max_discount_amount || 0),
      discount_percentage: Number(promo.discount_percentage || 0),
      uses_per_user: Number(promo.uses_per_user || 1),
      max_uses_total: Number(promo.max_uses_total || 0),
      from_date: promo.from_date,
      to_date: promo.to_date,
    }));
};


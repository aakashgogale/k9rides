import mongoose from 'mongoose';
import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodFeeSettings } from '../../admin/models/feeSettings.model.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodDeliverySurgeZone } from '../../admin/models/deliverySurgeZone.model.js';
import { FoodDeliveryCommissionRule } from '../../admin/models/deliveryCommissionRule.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { FoodItem } from '../../admin/models/food.model.js';
import { ValidationError } from '../../../../core/auth/errors.js';
import { haversineKm } from './order.helpers.js';

const MAX_ITEM_QTY = 50;

/**
 * Resolves order items against the restaurant's live menu and returns copies with
 * SERVER-authoritative prices/names. Never trust client-supplied prices: without this
 * a client could post price:1 for an expensive dish and be charged ₹1.
 * Also validates ownership, availability, variant, and quantity bounds.
 * @param {string|import('mongoose').Types.ObjectId} restaurantId
 * @param {Array<object>} items
 * @returns {Promise<Array<object>>}
 */
export async function resolveAuthoritativeItems(restaurantId, items) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) throw new ValidationError('Order must contain at least one item');

  const ids = [...new Set(list.map((it) => String(it?.itemId || '')).filter(Boolean))]
    .filter((id) => mongoose.isValidObjectId(id));
  if (ids.length === 0) throw new ValidationError('Invalid order items');

  const menuItems = await FoodItem.find({ _id: { $in: ids }, restaurantId }).lean();
  const byId = new Map(menuItems.map((m) => [String(m._id), m]));

  return list.map((it) => {
    const menu = byId.get(String(it?.itemId || ''));
    if (!menu) throw new ValidationError('One or more items are not available at this restaurant');
    if (menu.isActive === false || menu.isAvailable === false || menu.approvalStatus !== 'approved') {
      throw new ValidationError(`"${menu.name}" is currently unavailable`);
    }

    const qty = Number(it?.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) {
      throw new ValidationError(`Invalid quantity for "${menu.name}" (1-${MAX_ITEM_QTY} allowed)`);
    }

    let price = Number(menu.price);
    let variantName = '';
    if (it?.variantId) {
      const variant = (menu.variants || []).find((v) => String(v._id) === String(it.variantId));
      if (!variant) throw new ValidationError(`Selected option for "${menu.name}" is not available`);
      price = Number(variant.price);
      variantName = variant.name;
    }

    return {
      ...it,
      itemId: menu._id,
      name: menu.name,
      price,
      quantity: qty,
      variantName: variantName || it?.variantName || '',
    };
  });
}

function extractCoords(addressLike) {
  const coords = addressLike?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [lng, lat] = coords;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return [Number(lng), Number(lat)];
}

function isPointInPolygon(lat, lng, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = Number(polygon[i]?.longitude);
    const yi = Number(polygon[i]?.latitude);
    const xj = Number(polygon[j]?.longitude);
    const yj = Number(polygon[j]?.latitude);
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

async function detectZoneIdFromAddress(addressLike) {
  const coords = extractCoords(addressLike);
  if (!coords) return null;
  const [lng, lat] = coords;
  const zones = await FoodZone.find({ isActive: true }).select('_id coordinates').lean();
  const matchedZone = (zones || []).find((zone) => isPointInPolygon(lat, lng, zone?.coordinates || []));
  return matchedZone?._id ? String(matchedZone._id) : null;
}

export async function resolveOrderZoneId(dto = {}, restaurant = null) {
  const detectedZoneId = await detectZoneIdFromAddress(dto?.address || dto?.deliveryAddress);
  if (detectedZoneId && mongoose.Types.ObjectId.isValid(detectedZoneId)) {
    return detectedZoneId;
  }
  if (dto?.zoneId && mongoose.Types.ObjectId.isValid(dto.zoneId)) {
    return String(dto.zoneId);
  }
  if (restaurant?.zoneId && mongoose.Types.ObjectId.isValid(restaurant.zoneId)) {
    return String(restaurant.zoneId);
  }
  return null;
}

async function resolveDistanceRule(distanceKm) {
  if (!Number.isFinite(Number(distanceKm)) || Number(distanceKm) < 0) return null;
  const rules = await FoodDeliveryCommissionRule.find({ status: { $ne: false } }).lean();
  if (!rules.length) return null;
  const d = Number(distanceKm);
  const sorted = [...rules].sort((a, b) => Number(a.minDistance || 0) - Number(b.minDistance || 0));
  const matched = sorted.find((r) => {
    const min = Number(r.minDistance || 0);
    const max = r.maxDistance == null ? null : Number(r.maxDistance);
    return d >= min && (max == null || d < max);
  });
  if (matched) return matched;

  const lowerRule = [...sorted]
    .reverse()
    .find((r) => d >= Number(r.minDistance || 0));

  return lowerRule || sorted[0] || null;
}

export async function calculateOrderPricing(userId, dto) {
  const restaurant = await FoodRestaurant.findById(dto.restaurantId)
    .select("status zoneId location")
    .lean();
  if (!restaurant) throw new ValidationError("Restaurant not found");
  if (restaurant.status !== "approved")
    throw new ValidationError("Restaurant not available");

  // Resolve prices from the live menu — never trust client-supplied item prices.
  const items = await resolveAuthoritativeItems(dto.restaurantId, dto.items);
  dto.items = items;
  const subtotal = items.reduce(
    (sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 1),
    0,
  );

  const feeDoc = await FoodFeeSettings.findOne({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();
    
  const feeSettings = feeDoc || {
    platformFee: 0,
    deliveryFeeComputationMode: 'distance_order_value',
    gstRate: 0,
    deliveryPartnerIncentiveRule: {
      isEnabled: false,
      minOrderAmount: 0,
      incentivePercent: 0,
    }
  };

  const packagingFee = 0;
  const configuredPlatformFee = Number(feeSettings.platformFee);
  const platformFee = (!Number.isFinite(configuredPlatformFee) || configuredPlatformFee < 0)
    ? 0
    : Math.round(configuredPlatformFee * 100) / 100;

  const incentiveRule = feeSettings.deliveryPartnerIncentiveRule || {
    isEnabled: false,
    minOrderAmount: 0,
    incentivePercent: 0,
  };

  const mode = String(feeSettings.deliveryFeeComputationMode || '');
  let deliveryFee = 0;
  let deliveryFeeBreakdown = null;
  let adminDeliveryCommissionPercent = 0;
  let adminDeliveryCommissionAmount = 0;
  let riderDeliveryEarningAfterAdminCommission = 0;
  let adminDeliveryCommissionEnabled = false;
  let deliveryPartnerIncentiveEnabled = Boolean(incentiveRule.isEnabled);
  let deliveryPartnerIncentivePercent = Math.round((Number(incentiveRule.incentivePercent || 0) * 100)) / 100;
  let deliveryPartnerIncentiveAmount = 0;
  let deliveryPartnerIncentiveEligible = false;

  if (mode === 'distance_order_value') {
    const restCoords = extractCoords(restaurant);
    const customerCoords = extractCoords(dto?.address || dto?.deliveryAddress);
    
    let distanceRule = null;
    let distanceKm = 0;
    
    if (restCoords && customerCoords) {
      const [rLng, rLat] = restCoords;
      const [cLng, cLat] = customerCoords;
      distanceKm = haversineKm(rLat, rLng, cLat, cLng);
      distanceRule = await resolveDistanceRule(distanceKm);
    } else {
      // Fallback: If coordinates are missing, assume base distance (0 km) to apply base delivery fee
      distanceRule = await resolveDistanceRule(0);
    }
    
    if (distanceRule) {
        const commissionRows = Array.isArray(feeSettings.distanceSlabAdminDeliveryCommission)
          ? feeSettings.distanceSlabAdminDeliveryCommission
          : [];
        const adminCommissionRow = commissionRows.find((r) => String(r.distanceRuleId) === String(distanceRule._id));
        const minDistance = Number(distanceRule.minDistance || 0);
        const isBaseSlab = minDistance <= 0;
        const userDeliveryFee = Math.round((Number(distanceRule.userDeliveryFee || 0) * 100)) / 100;
        const perKmRate = Number(distanceRule.commissionPerKm || 0);
        const fixedPayout = Math.round((Number(distanceRule.basePayout || 0) * 100)) / 100;

        if (userDeliveryFee > 0) {
          deliveryFee = userDeliveryFee;
        } else {
          const chargeableDistanceKm = Number(distanceKm || 0);
          deliveryFee = Math.round(Math.max(0, perKmRate * chargeableDistanceKm) * 100) / 100;
        }

        adminDeliveryCommissionEnabled = adminCommissionRow?.isEnabled === true;
        adminDeliveryCommissionPercent = adminDeliveryCommissionEnabled
          ? Math.round((Number(adminCommissionRow?.adminDeliveryCommissionPercent || 0) * 100)) / 100
          : 0;
        adminDeliveryCommissionAmount = Math.round((deliveryFee * (adminDeliveryCommissionPercent / 100)) * 100) / 100;
        riderDeliveryEarningAfterAdminCommission = Math.round(Math.max(0, deliveryFee - adminDeliveryCommissionAmount) * 100) / 100;
        deliveryFeeBreakdown = {
          source: 'distance_slab',
          distanceKm: Math.round(Number(distanceKm || 0) * 100) / 100,
          distanceRuleId: String(distanceRule._id),
          distanceRange: {
            minDistance,
            maxDistance: distanceRule.maxDistance == null ? null : Number(distanceRule.maxDistance)
          },
          orderValue: subtotal,
          appliedDeliveryFee: Number(deliveryFee || 0),
          feeComputation: isBaseSlab ? 'base_slab_commission_per_km_source' : 'commission_per_km_x_total_distance',
          userDeliveryFee,
          basePayout: fixedPayout,
          commissionPerKm: perKmRate,
          adminDeliveryCommissionPercent,
          adminDeliveryCommissionAmount,
          riderDeliveryEarningAfterAdminCommission,
          feeSource: isBaseSlab ? 'distance_base_slab' : 'distance_non_base_slab'
        };
      }
  }

  const incentiveThreshold = Math.round((Number(incentiveRule.minOrderAmount || 0) * 100)) / 100;
  deliveryPartnerIncentiveEligible =
    deliveryPartnerIncentiveEnabled &&
    Number.isFinite(subtotal) &&
    subtotal >= incentiveThreshold &&
    deliveryPartnerIncentivePercent > 0;
  deliveryPartnerIncentiveAmount = deliveryPartnerIncentiveEligible
    ? Math.round((subtotal * (deliveryPartnerIncentivePercent / 100)) * 100) / 100
    : 0;

  const gstRate = Number(feeSettings.gstRate);
  const validGstRate = (!Number.isFinite(gstRate) || gstRate < 0) ? 0 : gstRate;
  const tax = Math.round(subtotal * (validGstRate / 100));

  let discount = 0;
  let appliedCoupon = null;
  const codeRaw = dto.couponCode
    ? String(dto.couponCode).trim().toUpperCase()
    : "";

  if (codeRaw) {
    const now = new Date();
    const offer = await FoodOffer.findOne({ couponCode: codeRaw }).lean();
    if (offer) {
      const statusOk = offer.status === "active";
      const startOk = !offer.startDate || now >= new Date(offer.startDate);
      const endOk = !offer.endDate || now < new Date(offer.endDate);
      const scopeOk =
        offer.restaurantScope !== "selected" ||
        String(offer.restaurantId || "") === String(dto.restaurantId || "");
      const minOk = subtotal >= (Number(offer.minOrderValue) || 0);
      let usageOk = true;
      if (
        Number(offer.usageLimit) > 0 &&
        Number(offer.usedCount || 0) >= Number(offer.usageLimit)
      ) {
        usageOk = false;
      }

      let perUserOk = true;
      if (userId && Number(offer.perUserLimit) > 0) {
        const usage = await FoodOfferUsage.findOne({
          offerId: offer._id,
          userId,
        }).lean();
        if (usage && Number(usage.count) >= Number(offer.perUserLimit)) {
          perUserOk = false;
        }
      }

      let firstOrderOk = true;
      if (userId && offer.customerScope === "first-time") {
        const c = await FoodOrder.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });
        firstOrderOk = c === 0;
      }
      if (userId && offer.isFirstOrderOnly === true) {
        const c2 = await FoodOrder.countDocuments({
          userId: new mongoose.Types.ObjectId(userId),
        });
        if (c2 > 0) firstOrderOk = false;
      }

      const allowed =
        statusOk &&
        startOk &&
        endOk &&
        scopeOk &&
        minOk &&
        usageOk &&
        perUserOk &&
        firstOrderOk;

      if (allowed) {
        if (offer.discountType === "percentage") {
          const raw = subtotal * (Number(offer.discountValue) / 100);
          const capped = Number(offer.maxDiscount)
            ? Math.min(raw, Number(offer.maxDiscount))
            : raw;
          discount = Math.max(0, Math.min(subtotal, Math.floor(capped)));
        } else {
          discount = Math.max(
            0,
            Math.min(subtotal, Math.floor(Number(offer.discountValue) || 0)),
          );
        }
        appliedCoupon = { code: codeRaw, discount };
      }
    }
  }

  const zoneIdForSurge = await resolveOrderZoneId(dto, restaurant);
  let surgeAmount = 0;
  if (zoneIdForSurge) {
    const surgeConfig = await FoodDeliverySurgeZone.findOne({ zoneId: zoneIdForSurge }).lean();
    if (surgeConfig?.isEnabled) {
      surgeAmount = Math.round((Number(surgeConfig.surgeAmount || 0) * 100)) / 100;
    }
  }

  const total = Math.max(
    0,
    subtotal + packagingFee + deliveryFee + platformFee + tax + surgeAmount - discount,
  );

  return {
    pricing: {
      subtotal,
      tax,
      packagingFee,
      deliveryFee,
      deliveryFeeBreakdown,
      adminDeliveryCommissionEnabled,
      adminDeliveryCommissionPercent,
      adminDeliveryCommissionAmount,
      riderDeliveryEarningAfterAdminCommission,
      deliveryPartnerIncentiveEnabled,
      deliveryPartnerIncentivePercent,
      deliveryPartnerIncentiveAmount,
      deliveryPartnerIncentiveEligible,
      platformFee,
      surgeAmount,
      discount,
      total,
      currency: "INR",
      couponCode: appliedCoupon?.code || codeRaw || null,
      appliedCoupon,
    },
  };
}

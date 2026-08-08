import mongoose from 'mongoose';
import { FoodOrder, FoodSettings } from '../models/order.model.js';
// import { paymentSnapshotFromOrder } from './foodOrderPayment.service.js';
import { logger } from '../../../../utils/logger.js';
import { FoodUser } from '../../../../core/users/user.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import { FoodDeliveryPartner } from '../../delivery/models/deliveryPartner.model.js';
import { FoodZone } from '../../admin/models/zone.model.js';
import { ValidationError, ForbiddenError, NotFoundError } from '../../../../core/auth/errors.js';
import { buildPaginationOptions, buildPaginatedResult } from '../../../../utils/helpers.js';
import { FoodOffer } from '../../admin/models/offer.model.js';
import { FoodOfferUsage } from '../../admin/models/offerUsage.model.js';
import { FoodDeliverySurgeZone } from '../../admin/models/deliverySurgeZone.model.js';
import { FoodRestaurantCommission } from '../../admin/models/restaurantCommission.model.js';
import { FoodTransaction } from '../models/foodTransaction.model.js';
import { FoodSupportTicket } from '../../user/models/supportTicket.model.js';
import { config } from '../../../../config/env.js';
import {
    createRazorpayCheckoutOrder,
    verifyPaymentSignature,
    isRazorpayConfigured,
    initiateRazorpayRefund,
    fetchRazorpayPayment
} from '../helpers/razorpay.helper.js';
import { getIO, rooms } from '../../../../config/socket.js';
import { addOrderJob } from '../../../../queues/producers/order.producer.js';
import { fetchPolyline } from '../utils/googleMaps.js';
import { getFirebaseDB } from '../../../../config/firebase.js';
import * as foodTransactionService from './foodTransaction.service.js';
import * as userWalletService from '../../user/services/userWallet.service.js';
import { calculateOrderPricing, resolveOrderZoneId, resolveAuthoritativeItems } from './order-pricing.service.js';
import * as dispatchService from './order-dispatch.service.js';
import * as deliveryService from './order-delivery.service.js';
import * as paymentService from './order-payment.service.js';
import {
  enqueueOrderEvent,
  generateFourDigitDeliveryOtp,
  sanitizeOrderForExternal,
  emitDeliveryDropOtpToUser,
  notifyOwnersSafely,
  notifyOwnerSafely,
  buildOrderIdentityFilter,
  toGeoPoint,
  pushStatusHistory,
  normalizeOrderForClient,
  applyAggregateRating,
  buildDeliverySocketPayload,
  notifyRestaurantNewOrder,
  isStatusAdvance,
} from './order.helpers.js';
// 🗑️ Moved to foodTransaction.service.js to centralize finance logic.

async function getZoneSurgeSnapshot(zoneId) {
  if (!zoneId) return { surgeAmount: 0, isEnabled: false };
  const config = await FoodDeliverySurgeZone.findOne({ zoneId }).lean();
  if (!config?.isEnabled) return { surgeAmount: 0, isEnabled: false };
  const surgeAmount = Math.round((Number(config?.surgeAmount || 0) * 100)) / 100;
  return { surgeAmount: surgeAmount > 0 ? surgeAmount : 0, isEnabled: true };
}

/** Append-only food_order_payments row; never blocks main flow on failure */
// 🗑️ Deprecated in favor of FoodTransaction system.

// ----- Settings -----
export async function getDispatchSettings() {
  return dispatchService.getDispatchSettings();
}

export async function updateDispatchSettings(dispatchMode, adminId) {
  return dispatchService.updateDispatchSettings(dispatchMode, adminId);
}

// ----- Calculate (validation + return pricing from payload) -----
export async function calculateOrder(userId, dto) {
  return calculateOrderPricing(userId, dto);
}

// Helper to safely convert string to ObjectId or throw ValidationError (400)
function toObjectId(id, fieldName = 'ID') {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  if (typeof id !== 'string' || !/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new ValidationError(`Invalid ${fieldName} format`);
  }
  return new mongoose.Types.ObjectId(id);
}

// ----- Create order -----
export async function createOrder(userId, dto) {
  try {
    const restaurantId = toObjectId(dto.restaurantId, 'Restaurant ID');
    const restaurant = await FoodRestaurant.findById(restaurantId)
      .select("status restaurantName zoneId location isAcceptingOrders")
      .lean();
    
    if (!restaurant) throw new ValidationError("Restaurant not found");
    if (restaurant.status !== "approved")
      throw new ValidationError("Restaurant not accepting orders");
    if (restaurant.isAcceptingOrders === false)
      throw new ValidationError("Restaurant not accepting orders");

    const settings = await getDispatchSettings();
    const dispatchMode = settings.dispatchMode;

    const deliveryAddress = {
      label: dto.address?.label || "Home",
      name: dto.address?.name || dto.address?.fullName || dto.customerName || "",
      fullName: dto.address?.fullName || dto.address?.name || dto.customerName || "",
      street: dto.address?.street || "",
      additionalDetails: dto.address?.additionalDetails || "",
      city: dto.address?.city || "",
      state: dto.address?.state || "",
      zipCode: dto.address?.zipCode || "",
      phone: dto.address?.phone || "",
      location: dto.address?.location?.coordinates
        ? { type: "Point", coordinates: dto.address.location.coordinates }
        : undefined,
    };

    const paymentMethod = dto.paymentMethod === "card" ? "razorpay" : dto.paymentMethod;
    const isCash = paymentMethod === "cash";
    const isWallet = paymentMethod === "wallet";

    if (isCash) {
      const user = await FoodUser.findById(userId).select("isBlockedFromCOD").lean();
      if (user?.isBlockedFromCOD) {
        throw new ValidationError("Cash on Delivery (COD) is blocked for your account. Please use online payment.");
      }
    }

    // Resolve server-authoritative prices from the live menu before anything reads dto.items
    // (the saved order.items, subtotal, and payout math all derive from this).
    dto.items = await resolveAuthoritativeItems(restaurantId, dto.items);

    // Ensure pricing is present and consistent.
    const computedSubtotal = (dto.items || []).reduce((sum, item) => {
      const price = Number(item?.price);
      const qty = Number(item?.quantity);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
      return sum + Math.max(0, price) * Math.max(0, qty);
    }, 0);

    const pricingResult = await calculateOrderPricing(userId, {
      ...dto,
      restaurantId: String(restaurantId),
      address: dto.address || dto.deliveryAddress,
      deliveryAddress: dto.deliveryAddress || dto.address,
    });
    if (!pricingResult?.pricing) {
      throw new ValidationError("Unable to calculate order pricing from fee settings");
    }
    const normalizedPricing = {
      subtotal: Number(pricingResult.pricing.subtotal ?? computedSubtotal) || 0,
      tax: Number(pricingResult.pricing.tax ?? 0) || 0,
      packagingFee: Number(pricingResult.pricing.packagingFee ?? 0) || 0,
      deliveryFee: Number(pricingResult.pricing.deliveryFee ?? 0) || 0,
      deliveryFeeBreakdown: pricingResult.pricing.deliveryFeeBreakdown || null,
      adminDeliveryCommissionEnabled: Boolean(pricingResult.pricing.adminDeliveryCommissionEnabled || false),
      adminDeliveryCommissionPercent: Number(pricingResult.pricing.adminDeliveryCommissionPercent ?? 0) || 0,
      adminDeliveryCommissionAmount: Number(pricingResult.pricing.adminDeliveryCommissionAmount ?? 0) || 0,
      riderDeliveryEarningAfterAdminCommission: Number(pricingResult.pricing.riderDeliveryEarningAfterAdminCommission ?? 0) || 0,
      deliveryPartnerIncentiveEnabled: Boolean(pricingResult.pricing.deliveryPartnerIncentiveEnabled || false),
      deliveryPartnerIncentivePercent: Number(pricingResult.pricing.deliveryPartnerIncentivePercent ?? 0) || 0,
      deliveryPartnerIncentiveAmount: Number(pricingResult.pricing.deliveryPartnerIncentiveAmount ?? 0) || 0,
      deliveryPartnerIncentiveEligible: Boolean(pricingResult.pricing.deliveryPartnerIncentiveEligible || false),
      platformFee: Number(pricingResult.pricing.platformFee ?? 0) || 0,
      surgeAmount: Number(pricingResult.pricing.surgeAmount ?? 0) || 0,
      discount: Number(pricingResult.pricing.discount ?? 0) || 0,
      total: Number(pricingResult.pricing.total ?? 0) || 0,
      currency: String(pricingResult.pricing.currency || "INR"),
      couponCode: pricingResult.pricing.couponCode || null,
      appliedCoupon: pricingResult.pricing.appliedCoupon || null,
    };

    const resolvedOrderZoneId = await resolveOrderZoneId(
      {
        ...dto,
        address: dto.address || dto.deliveryAddress,
        deliveryAddress: dto.deliveryAddress || dto.address,
      },
      restaurant
    );
    const orderZoneId = resolvedOrderZoneId
      ? toObjectId(resolvedOrderZoneId, 'Zone ID')
      : toObjectId(restaurant.zoneId, 'Restaurant Zone ID');
    const surgeSnapshot = await getZoneSurgeSnapshot(orderZoneId);
    normalizedPricing.surgeAmount = surgeSnapshot.surgeAmount;

    const computedTotal = Math.max(
      0,
      (Number.isFinite(normalizedPricing.subtotal) ? normalizedPricing.subtotal : 0) +
        (Number.isFinite(normalizedPricing.tax) ? normalizedPricing.tax : 0) +
        (Number.isFinite(normalizedPricing.packagingFee) ? normalizedPricing.packagingFee : 0) +
        (Number.isFinite(normalizedPricing.deliveryFee) ? normalizedPricing.deliveryFee : 0) +
        (Number.isFinite(normalizedPricing.platformFee) ? normalizedPricing.platformFee : 0) +
        (Number.isFinite(normalizedPricing.surgeAmount) ? normalizedPricing.surgeAmount : 0) -
        (Number.isFinite(normalizedPricing.discount) ? normalizedPricing.discount : 0),
    );

    normalizedPricing.total = Math.round(computedTotal * 100) / 100;

    if (isCash) {
      const { FoodFeeSettings } = await import('../../admin/models/feeSettings.model.js');
      const feeDoc = await FoodFeeSettings.findOne({ isActive: true }).sort({ createdAt: -1 });
      const codOrderLimit = feeDoc?.codOrderLimit;
      
      if (codOrderLimit !== undefined && codOrderLimit !== null && normalizedPricing.total >= codOrderLimit) {
        throw new ValidationError(`Cash on Delivery is not allowed for orders of ₹${codOrderLimit} or more.`);
      }

      // Also check maxAvailableCashLimit of online delivery boy wallets if applicable
      const { FoodDeliveryPartner } = await import('../../delivery/models/deliveryPartner.model.js');
      const { getDeliveryPartnerWalletEnhanced } = await import('../../delivery/services/deliveryFinance.service.js');
      const onlinePartners = await FoodDeliveryPartner.find({ availabilityStatus: 'online' }).lean();
      
      // ponytail: with zero online partners there is nobody who can collect the cash, so COD
      // must be rejected — NOT treated as an unlimited cash limit (the old behaviour let COD
      // orders through with no courier able to fulfil them). availabilityStatus is a maintained
      // enum (online/offline), so an empty result reliably means "no one online".
      if (onlinePartners.length === 0) {
        throw new ValidationError("Cash on Delivery is currently unavailable as no delivery partners are online.");
      }

      let maxAvailableCashLimit = 0;
      for (const partner of onlinePartners) {
        try {
          const wallet = await getDeliveryPartnerWalletEnhanced(partner._id);
          if (wallet.availableCashLimit > maxAvailableCashLimit) {
            maxAvailableCashLimit = wallet.availableCashLimit;
          }
        } catch (e) {
          // Ignore
        }
      }

      if (normalizedPricing.total > maxAvailableCashLimit) {
        throw new ValidationError("Cash on Delivery is currently unavailable due to delivery partner wallet limits.");
      }
    }

    if (paymentMethod === "razorpay" && !isRazorpayConfigured()) {
      throw new ValidationError("Razorpay payment gateway is not configured");
    }

    const payment = {
      method: paymentMethod,
      status: isCash ? "cod_pending" : isWallet ? "paid" : "created",
      amountDue: normalizedPricing.total || 0,
      razorpay: {},
      qr: {},
    };

    const riderBasePay = Math.round((Number(normalizedPricing.deliveryFeeBreakdown?.basePayout || 0) * 100)) / 100;
    const riderDeliveryFeeShare = Math.round((Number(normalizedPricing.riderDeliveryEarningAfterAdminCommission || 0) * 100)) / 100;
    const riderSurgePay = Number(normalizedPricing.surgeAmount) || 0;
    const riderIncentivePay = Math.round((Number(normalizedPricing.deliveryPartnerIncentiveAmount || 0) * 100)) / 100;
    const riderTotalPayout = Math.round((riderBasePay + riderSurgePay + riderDeliveryFeeShare + riderIncentivePay) * 100) / 100;
    const riderEarning = riderTotalPayout;
    
    // Calculate restaurant commission from subtotal
    let restaurantCommission = 0;
    try {
      const snapshot = await foodTransactionService.getRestaurantCommissionSnapshot({
        pricing: normalizedPricing,
        restaurantId: restaurantId
      });
      restaurantCommission = Number(snapshot?.commissionAmount) || 0;
    } catch (err) {
      logger.error(`Commission calculation failed for order: ${err.message}`);
    }

    normalizedPricing.restaurantCommission = restaurantCommission;

    const platformProfit = Math.max(
      0,
      (Number.isFinite(normalizedPricing.deliveryFee) ? normalizedPricing.deliveryFee : 0) +
        (Number.isFinite(normalizedPricing.platformFee) ? normalizedPricing.platformFee : 0) +
        (Number.isFinite(normalizedPricing.surgeAmount) ? normalizedPricing.surgeAmount : 0) +
        restaurantCommission -
        riderTotalPayout,
    );

    const initialStatus = (paymentMethod === "razorpay" || paymentMethod === "card") ? "pending_payment" : "created";

    const order = new FoodOrder({
      userId: toObjectId(userId, 'User ID'),
      restaurantId: restaurantId,
      zoneId: orderZoneId,
      items: (dto.items || []).map(item => ({
        ...item,
        itemId: toObjectId(item.itemId, 'Item ID')
      })),
      deliveryAddress,
      customerName: String(dto.customerName || deliveryAddress.fullName || ""),
      customerPhone: String(dto.customerPhone || deliveryAddress.phone || ""),
      pricing: normalizedPricing,
      payment,
      orderStatus: initialStatus,
      dispatch: { modeAtCreation: dispatchMode, status: "unassigned" },
      statusHistory: [
        {
          at: new Date(),
          byRole: "SYSTEM",
          from: "",
          to: initialStatus,
          note: initialStatus === "pending_payment" ? "Order created, awaiting payment" : "Order placed",
        },
      ],
      note: String(dto.note || ""),
      sendCutlery: dto.sendCutlery !== false,
      deliveryFleet: String(dto.deliveryFleet || "standard"),
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      riderBasePay: Number(riderBasePay) || 0,
      riderSurgePay: Number(riderSurgePay) || 0,
      riderDeliveryFeeShare: Number(riderDeliveryFeeShare) || 0,
      riderIncentivePay: Number(riderIncentivePay) || 0,
      riderTotalPayout: Number(riderTotalPayout) || 0,
      riderEarning: Number(riderEarning) || 0,
      platformProfit: Number(platformProfit) || 0,
    });

    let razorpayPayload = null;

    if (paymentMethod === "razorpay") {
      const amountPaise = Math.round((normalizedPricing.total || 0) * 100);
      try {
        razorpayPayload = await createRazorpayCheckoutOrder(amountPaise, "INR", order._id.toString());
        payment.razorpay = { orderId: razorpayPayload.orderId, paymentId: "", signature: "" };
        payment.status = "created";
        // Update order payment state before saving
        order.payment = payment;
      } catch (err) {
        logger.error(`Razorpay order creation failed: ${err.message}`);
        throw new ValidationError(err?.message || "Payment gateway error");
      }
    }

    if (isWallet) {
      // ponytail: debit the wallet BEFORE persisting the order. Saving a 'paid' wallet order and
      // deducting afterwards left a window where a crash produced a paid order with no debit.
      // order._id exists at instantiation, so the ledger reference is valid pre-save.
      await userWalletService.deductWalletBalance(userId, order.pricing.total, `Payment for order #${order.order_id || order._id}`, { orderId: order._id });
    }

    await order.save();

    // Phase 2: Create initial transaction (Non-blocking but logged)
    try {
      await foodTransactionService.createInitialTransaction(order);
    } catch (err) {
      logger.error(`[CRITICAL] Initial transaction failed for order ${order._id}: ${err.message}`);
      // We don't throw here to avoid failing the whole order if transaction logging fails
    }

    // Realtime + push notifications.
    try {
      const isAwaitingOnlinePayment =
        String(paymentMethod || "").toLowerCase() === "razorpay" &&
        String(payment?.status || "").toLowerCase() !== "paid";
        
      await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
        title: isAwaitingOnlinePayment
          ? "Complete Payment to Confirm Order"
          : "Order Confirmed! 🍔",
        body: isAwaitingOnlinePayment
          ? `Order #${order.order_id || order._id} is created. Please complete payment to send it to ${restaurant.restaurantName || "the restaurant"}.`
          : `Your order #${order.order_id || order._id} from ${restaurant.restaurantName || "the restaurant"} has been placed successfully.`,
        image: "https://i.ibb.co/5GzXz7r/K9 Rides-Brand-Image.png",
        data: {
          type: isAwaitingOnlinePayment ? "order_created_pending_payment" : "order_created",
          orderId: String(order._id),
          orderMongoId: order._id.toString(),
          link: `/food/user/orders/${order._id.toString()}`,
        },
      });

      // Restaurant gets new-order request only when payment flow is eligible.
      await notifyRestaurantNewOrder(order);
    } catch (err) {
      logger.warn(`Notifications failed for order ${order._id}: ${err.message}`);
    }

    // Handle Coupon usage — base it on the coupon the SERVER actually applied (not a client
    // field, which used to be stripped so usage never incremented / discount was dropped), and
    // enforce the global usage cap atomically so it can't be exceeded under concurrency.
    const appliedCouponCode = normalizedPricing.appliedCoupon?.code
      ? String(normalizedPricing.appliedCoupon.code).trim().toUpperCase()
      : "";
    if (appliedCouponCode) {
      try {
        const offer = await FoodOffer.findOne({ couponCode: appliedCouponCode }).lean();
        if (offer) {
          const capFilter = Number(offer.usageLimit) > 0
            ? { _id: offer._id, usedCount: { $lt: Number(offer.usageLimit) } }
            : { _id: offer._id };
          const incRes = await FoodOffer.updateOne(capFilter, { $inc: { usedCount: 1 } });
          if (incRes.matchedCount === 0) {
            logger.warn(`Coupon ${appliedCouponCode} hit its usage limit during a concurrent order (order ${order._id}).`);
          }
          await FoodOfferUsage.updateOne(
            { offerId: offer._id, userId: toObjectId(userId, 'User ID') },
            { $inc: { count: 1 }, $set: { lastUsedAt: new Date() } },
            { upsert: true },
          );
        }
      } catch (err) {
        logger.error(`Coupon usage update failed: ${err.message}`);
      }
    }

    const saved = normalizeOrderForClient(order);
    return { order: saved, razorpay: razorpayPayload };
  } catch (err) {
    logger.error(`Order placement error: ${err.message}`, { stack: err.stack, userId, dto });
    if (err instanceof ValidationError || err instanceof ForbiddenError || err instanceof NotFoundError) {
      throw err;
    }
    // Transform system errors to Generic validation error with 500 logging
    throw new ValidationError(err.message || "Something went wrong while placing your order. Please try again.");
  }
}

// ----- Verify payment -----
export async function verifyPayment(userId, dto) {
  const identity = buildOrderIdentityFilter(dto.orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (order.payment.status === "paid")
    return { order: normalizeOrderForClient(order), payment: order.payment };

  // Bind the signature to THIS order's Razorpay order id. Without this, a valid
  // signature from any other (e.g. cheap) order could be replayed to mark this one paid.
  const expectedRzpOrderId = order.payment?.razorpay?.orderId;
  if (!expectedRzpOrderId || String(dto.razorpayOrderId) !== String(expectedRzpOrderId)) {
    throw new ValidationError("Payment verification failed: order mismatch");
  }

  const valid = verifyPaymentSignature(
    dto.razorpayOrderId,
    dto.razorpayPaymentId,
    dto.razorpaySignature,
  );
  if (!valid) throw new ValidationError("Payment verification failed");

  // Confirm the payment was actually captured for the amount we charged (skips mock payments in dev).
  if (!String(dto.razorpayPaymentId || "").startsWith("mock_")) {
    try {
      const rzpPayment = await fetchRazorpayPayment(dto.razorpayPaymentId);
      const capturedPaise = Number(rzpPayment?.amount || 0);
      const expectedPaise = Math.round(Number(order.payment.amountDue || 0) * 100);
      const capturedOk = ["captured", "authorized"].includes(String(rzpPayment?.status || ""));
      if (String(rzpPayment?.order_id || "") !== String(expectedRzpOrderId)) {
        throw new ValidationError("Payment verification failed: order mismatch");
      }
      if (!capturedOk || capturedPaise < expectedPaise) {
        throw new ValidationError("Payment verification failed: amount or status mismatch");
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError("Unable to verify payment with gateway. Please try again.");
    }
  }

  order.payment.status = "paid";
  order.payment.razorpay.paymentId = dto.razorpayPaymentId;
  order.payment.razorpay.signature = dto.razorpaySignature;
  
  const from = order.orderStatus;
  order.orderStatus = "created";

  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from: from,
    to: "created",
    note: "Payment verified, order confirmed",
  });
  await order.save();

  await foodTransactionService.updateTransactionStatus(order._id, 'captured', {
    status: 'captured',
    razorpayPaymentId: dto.razorpayPaymentId,
    razorpaySignature: dto.razorpaySignature,
    recordedByRole: "USER",
    recordedById: new mongoose.Types.ObjectId(userId)
  });

  // After online payment is verified, now notify restaurant about the new order.
  await notifyRestaurantNewOrder(order);

  // Notify Customer about payment success
  await notifyOwnersSafely([{ ownerType: "USER", ownerId: userId }], {
    title: "Payment Successful! ✅",
    body: `We have received your payment of ₹${order.payment.amountDue} for Order #${order._id.toString()}.`,
    image: "https://i.ibb.co/5GzXz7r/K9 Rides-Brand-Image.png",
    data: {
      type: "payment_success",
      orderId: String(order._id.toString()),
      orderMongoId: String(order._id),
    },
  });


  return { order: normalizeOrderForClient(order), payment: order.payment };
}

// ----- Auto-assign -----

/**
 * Start or continue a smart cascading dispatch.
 * @param {string} orderId - Mongo ID of the order.
 * @param {object} options - Options (retry count, etc)
 */
export async function tryAutoAssign(orderId, options = {}) {
    return dispatchService.tryAutoAssign(orderId, options);
}

/**
 * Triggered by worker after 60 seconds of zero response.
 */
export async function processDispatchTimeout(orderId, partnerId, options = {}) {
    return dispatchService.processDispatchTimeout(orderId, partnerId, options);
}

// ----- User: list, get, cancel -----
export async function listOrdersUser(userId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = { 
    userId: new mongoose.Types.ObjectId(userId),
    orderStatus: { $ne: 'pending_payment' }
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate(
        "restaurantId",
        "restaurantName profileImage coverImages slug area city location rating totalRatings",
      )
      .populate("dispatch.deliveryPartnerId", "name phone rating totalRatings")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  return buildPaginatedResult({
    docs: docs.map((doc) => normalizeOrderForClient(doc)),
    total,
    page,
    limit,
  });
}

export async function getOrderById(
  orderId,
  { userId, restaurantId, deliveryPartnerId, admin } = {},
) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne(identity)
    .populate(
      "restaurantId",
      "restaurantName ownerPhone profileImage area city location rating totalRatings primaryContactNumber",
    )
    .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber rating totalRatings profileImage avatar")
    .populate("userId", "name fullName phone email")
    .select("+deliveryOtp")
    .lean();
  if (!order) throw new NotFoundError("Order not found");

  if (admin) return normalizeOrderForClient(order);

  const orderUserId = order.userId?._id?.toString() || order.userId?.toString();
  const orderRestaurantId = order.restaurantId?._id?.toString() || order.restaurantId?.toString();
  const orderPartnerId = order.dispatch?.deliveryPartnerId?._id?.toString() || order.dispatch?.deliveryPartnerId?.toString();

  if (userId && orderUserId !== userId.toString())
    throw new ForbiddenError("Not your order");
  if (restaurantId && orderRestaurantId !== restaurantId.toString())
    throw new ForbiddenError("Not your restaurant order");
  if (deliveryPartnerId && orderPartnerId !== deliveryPartnerId.toString())
    throw new ForbiddenError("Not assigned to you");

  if (deliveryPartnerId || restaurantId) {
    return sanitizeOrderForExternal(order);
  }

  if (userId) {
    const drop = order.deliveryVerification?.dropOtp || {};
    const secret = String(order.deliveryOtp || "").trim();
    const out = normalizeOrderForClient(order);
    delete out.deliveryOtp;
    out.deliveryVerification = {
      ...(order.deliveryVerification || {}),
      dropOtp: {
        required: Boolean(drop.required),
        verified: Boolean(drop.verified),
      },
    };
    if (!drop.verified && secret) {
      out.handoverOtp = secret;
    }
    return out;
  }

  return sanitizeOrderForExternal(order);
}

export async function getDropOtpUser(orderId, userId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");
  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  }).select("+deliveryOtp");
  if (!order) throw new NotFoundError("Order not found");

  const phase = order.deliveryState?.currentPhase;
  const status = order.orderStatus;
  const eligiblePhases = ["at_drop", "en_route_to_delivery"];
  const isEligible = eligiblePhases.includes(phase) || status === "picked_up";

  if (!isEligible) {
    throw new ValidationError(
      "Rider is still at the restaurant. Wait for them to pick up your order to see the OTP."
    );
  }

  return { otp: order.deliveryOtp };
}

/**
 * Watchdog: Recovers orders stuck in 'assigned' or 'preparing' status for too long.
 * Should be called on server startup.
 */
export async function recoverStuckOrders() {
  const now = new Date();
  const FIVE_MIN = 5 * 60 * 1000;
  const TWO_MIN = 2 * 60 * 1000;

  try {
    // 1. Stuck in 'assigned' (partner never accepted) for > 2m
    const stuckAssigned = await FoodOrder.find({
      'dispatch.status': 'assigned',
      'dispatch.acceptedAt': { $exists: false },
      'dispatch.assignedAt': { $lt: new Date(now - TWO_MIN) },
      orderStatus: { $nin: ['delivered', 'cancelled_by_user', 'cancelled_by_restaurant'] }
    });

    if (stuckAssigned.length > 0) {
      logger.info(`Watchdog: Healing ${stuckAssigned.length} stuck assigned orders.`);
      for (const order of stuckAssigned) {
        // Reset status to unassigned and re-trigger auto-assign
        order.dispatch.status = 'unassigned';
        order.dispatch.deliveryPartnerId = null;
        await order.save();
        await tryAutoAssign(order._id);
      }
    }

    // 2. Clear old dispatching locks (cleanup in case of crash)
    await FoodOrder.updateMany(
      { 'dispatch.dispatchingAt': { $lt: new Date(now - FIVE_MIN) } },
      { $unset: { 'dispatch.dispatchingAt': '' } }
    );

  } catch (err) {
    logger.error(`Watchdog recovery error: ${err.message}`);
  }
}

export async function resyncState(userId, role) {
  if (role === "USER") {
    const order = await FoodOrder.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orderStatus: {
        $nin: [
          "delivered",
          "cancelled_by_user",
          "cancelled_by_restaurant",
          "cancelled_by_admin",
        ],
      },
    })
      .select("+deliveryOtp")
      .sort({ createdAt: -1 })
      .lean();

    if (order) {
      const out = normalizeOrderForClient(order);
      // Re-add handover OTP if order is picked up
      if (
        (order.deliveryState?.currentPhase === "at_drop" || order.orderStatus === "picked_up") &&
        !order.deliveryVerification?.dropOtp?.verified &&
        order.deliveryOtp
      ) {
        out.handoverOtp = order.deliveryOtp;
      }
      return { activeOrder: out };
    }
    return { activeOrder: null };
  }

  if (role === "DELIVERY_PARTNER") {
    const order = await FoodOrder.findOne({
      "dispatch.deliveryPartnerId": new mongoose.Types.ObjectId(userId),
      "dispatch.status": { $in: ["assigned", "accepted"] },
      orderStatus: {
        $nin: ["delivered", "cancelled_by_user", "cancelled_by_restaurant"],
      },
    })
      .populate("restaurantId")
      .lean();
    return { activeOrder: order ? sanitizeOrderForExternal(order) : null };
  }

  return {};
}

/**
 * Idempotently refunds a paid order at most once. Atomically claims the refund
 * (none/failed -> pending) before calling the gateway, so a restaurant-cancel racing a
 * user-cancel/webhook can't both issue a refund. Mirrors the authoritative state back onto
 * the in-memory `order` so the caller's trailing save() doesn't clobber it.
 * @param {import('mongoose').Document} order
 * @param {string|import('mongoose').Types.ObjectId} refundUserId user to credit for wallet refunds
 */
async function processOrderRefundOnce(order, refundUserId) {
  if (String(order.payment?.status || "").toLowerCase() !== "paid") return;
  const method = String(order.payment?.method || "").toLowerCase();
  if (method !== "razorpay" && method !== "wallet") return;
  if (method === "razorpay" && !order.payment?.razorpay?.paymentId) return;

  // Atomic claim — only the first caller flips refund.status into 'pending'.
  const claimed = await FoodOrder.findOneAndUpdate(
    {
      _id: order._id,
      "payment.status": "paid",
      "payment.refund.status": { $nin: ["pending", "processed"] },
    },
    { $set: { "payment.refund.status": "pending", "payment.refund.amount": order.pricing.total } },
    { new: true },
  );
  if (!claimed) {
    // Another flow owns the refund; sync in-memory state from DB to avoid clobbering on save().
    const fresh = await FoodOrder.findById(order._id).select("payment").lean();
    if (fresh?.payment) {
      order.payment.status = fresh.payment.status;
      order.payment.refund = fresh.payment.refund;
    }
    return;
  }

  let refundPatch;
  try {
    if (method === "razorpay") {
      const refundResult = await initiateRazorpayRefund(order.payment.razorpay.paymentId, order.pricing.total);
      refundPatch = refundResult.success
        ? { "payment.status": "refunded", "payment.refund": { status: "processed", amount: order.pricing.total, refundId: refundResult.refundId, processedAt: new Date() } }
        : { "payment.refund": { status: "failed", amount: order.pricing.total } };
    } else {
      await userWalletService.refundWalletBalance(refundUserId, order.pricing.total, `Refund for cancelled order #${order.order_id || order._id}`, { orderId: order._id });
      refundPatch = { "payment.status": "refunded", "payment.refund": { status: "processed", amount: order.pricing.total, processedAt: new Date() } };
    }
  } catch (err) {
    logger.error(`Refund processing error for Order ${order._id}: ${err.message}`);
    refundPatch = { "payment.refund": { status: "failed", amount: order.pricing.total } };
  }

  await FoodOrder.updateOne({ _id: order._id }, { $set: refundPatch });
  if (refundPatch["payment.status"]) order.payment.status = refundPatch["payment.status"];
  order.payment.refund = refundPatch["payment.refund"];
}

export async function cancelOrder(orderId, userId, reason) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");

  const allowed = ["created"];
  if (!allowed.includes(order.orderStatus))
    throw new ValidationError("Order cannot be cancelled");

  const from = order.orderStatus;
  order.orderStatus = "cancelled_by_user";
  pushStatusHistory(order, {
    byRole: "USER",
    byId: userId,
    from,
    to: "cancelled_by_user",
    note: reason || "",
  });

  const paymentMethod = String(order.payment?.method || "cash").toLowerCase();
  const paymentStatus = String(order.payment?.status || "cod_pending").toLowerCase();

  // Automated refund on user cancel — idempotent + race-safe (see processOrderRefundOnce).
  await processOrderRefundOnce(order, userId);

  await order.save();

  enqueueOrderEvent("order_cancelled_by_user", {
    orderMongoId: order._id?.toString?.(),
    orderId: order._id.toString(),
    userId,
    reason: reason || "",
  });

  // Sync transaction status
  try {
    const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
    const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
    const isOnlinePaid =
      finalPaymentMethod === "razorpay" &&
      (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
    await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_user', {
        status: isOnlinePaid ? 'refunded' : 'failed',
        note: `Order cancelled by user: ${reason || "No reason"}`,
        recordedByRole: 'USER',
        recordedById: userId
    });
  } catch (err) {
    logger.warn(`cancelOrder transaction sync failed: ${err?.message || err}`);
  }

  // Notify User and Restaurant about the cancellation
  const finalPaymentMethod = String(order.payment?.method || paymentMethod || "cash").toLowerCase();
  const finalPaymentStatus = String(order.payment?.status || paymentStatus || "cod_pending").toLowerCase();
  const isOnlinePaid =
    finalPaymentMethod === "razorpay" &&
    (finalPaymentStatus === "paid" || finalPaymentStatus === "refunded");
  const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
  
  await notifyOwnersSafely(
    [
      { ownerType: "USER", ownerId: userId },
      { ownerType: "RESTAURANT", ownerId: order.restaurantId },
    ],
    {
      title: "Order Cancelled ❌",
      body: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`,
      image: "https://i.ibb.co/5GzXz7r/K9 Rides-Brand-Image.png",
      data: {
        type: "order_cancelled",
        orderId: String(order._id.toString()),
        orderMongoId: String(order._id),
      },
    },
  );

  // Real-time: status update via socket
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        message: `Order #${order.order_id || order._id} has been cancelled successfully.${refundDetail}`
      };
      io.to(rooms.user(userId)).emit("order_status_update", payload);
      io.to(rooms.restaurant(order.restaurantId)).emit("order_status_update", payload);
    }
  } catch (err) {
    logger.warn(`cancelOrder socket emit failed: ${err?.message || err}`);
  }

  return normalizeOrderForClient(order);
}

export async function submitOrderRatings(orderId, userId, dto) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  if (String(order.orderStatus) !== "delivered") {
    throw new ValidationError("You can rate only delivered orders");
  }

  const hasDeliveryPartner = !!order.dispatch?.deliveryPartnerId;
  if (hasDeliveryPartner && !dto.deliveryPartnerRating) {
    throw new ValidationError("Delivery partner rating is required");
  }

  const restaurantAlreadyRated = Number.isFinite(
    Number(order?.ratings?.restaurant?.rating),
  );
  const deliveryAlreadyRated = Number.isFinite(
    Number(order?.ratings?.deliveryPartner?.rating),
  );
  if (restaurantAlreadyRated || (hasDeliveryPartner && deliveryAlreadyRated)) {
    throw new ValidationError("Ratings already submitted for this order");
  }

  const now = new Date();
  order.ratings = order.ratings || {};
  order.ratings.restaurant = {
    rating: dto.restaurantRating,
    comment: dto.restaurantComment || "",
    ratedAt: now,
  };

  if (hasDeliveryPartner) {
    order.ratings.deliveryPartner = {
      rating: dto.deliveryPartnerRating,
      comment: dto.deliveryPartnerComment || "",
      ratedAt: now,
    };
  }

  await Promise.all([
    applyAggregateRating(
      FoodRestaurant,
      order.restaurantId,
      dto.restaurantRating,
    ),
    hasDeliveryPartner
      ? applyAggregateRating(
          FoodDeliveryPartner,
          order.dispatch.deliveryPartnerId,
          dto.deliveryPartnerRating,
        )
      : Promise.resolve(),
  ]);

    await order.save();
    enqueueOrderEvent('order_ratings_submitted', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        userId,
        restaurantRating: dto.restaurantRating,
        deliveryPartnerRating: hasDeliveryPartner ? dto.deliveryPartnerRating : null
    });
}

export async function updateOrderInstructions(orderId, userId, instructions) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne({
    ...identity,
    userId: new mongoose.Types.ObjectId(userId),
  });
  if (!order) throw new NotFoundError("Order not found");
  
  const allowedStatuses = ['created', 'confirmed', 'preparing'];
  if (!allowedStatuses.includes(order.orderStatus)) {
    throw new ValidationError("Instructions can no longer be updated for this order");
  }

  order.note = String(instructions || "").trim();
  await order.save();
  return order;
}

// ----- Restaurant -----
export async function listOrdersRestaurant(restaurantId, query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };
  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .populate("userId", "name phone email profileImage")
      .populate("dispatch.deliveryPartnerId", "name fullName phone phoneNumber")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  return buildPaginatedResult({ docs: docs.map(d => normalizeOrderForClient(d)), total, page, limit });
}

export async function updateOrderStatusRestaurant(
  orderId,
  restaurantId,
  orderStatus,
  note = "",
) {
  const identity = buildOrderIdentityFilter(orderId);
  let order = await FoodOrder.findOne({
    ...identity,
    restaurantId: new mongoose.Types.ObjectId(restaurantId),
  });
  if (!order) throw new NotFoundError("Order not found");

  // A restaurant may only drive the kitchen-side statuses. picked_up / delivered are owned by
  // the delivery flow (partner assignment + drop-OTP in completeDelivery) and must not be
  // settable here, or a restaurant could mark an order delivered with no courier/OTP.
  const RESTAURANT_ALLOWED_STATUSES = new Set([
    "confirmed",
    "preparing",
    "ready_for_pickup",
    "cancelled_by_restaurant",
  ]);
  if (!RESTAURANT_ALLOWED_STATUSES.has(orderStatus)) {
    throw new ValidationError(`Restaurants cannot set order status to '${orderStatus}'.`);
  }

  const from = order.orderStatus;
  if (!isStatusAdvance(from, orderStatus)) {
    throw new ValidationError(
      `Current order status '${from}' is further ahead than '${orderStatus}'. Order cannot be moved backwards.`
    );
  }

  order.orderStatus = orderStatus;
  if (note && String(note).trim()) {
    order.note = String(note).trim();
  }

  pushStatusHistory(order, {
    byRole: "RESTAURANT",
    byId: restaurantId,
    from,
    to: orderStatus,
    note: note || "",
  });
  await order.save();

  // Custom messages / titles for status updates
  let title = `Order ${order._id.toString()} updated`;
  let body = `Status changed to ${String(orderStatus).replace(/_/g, " ")}`;

  if (orderStatus === "confirmed") {
    title = "Order Accepted! 🧑‍🍳";
    body = "The restaurant has accepted your order and is starting to prepare it.";
  } else if (orderStatus === "preparing") {
    title = "Food is being prepared! 🍳";
    body = "Your food is currently being prepared by the restaurant.";
  } else if (orderStatus === "ready_for_pickup") {
    title = "Food is ready! 🛍️";
    body = "Your order is ready and waiting to be picked up.";
  } else if (String(orderStatus).includes("cancel")) {
    const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
    const refundDetail = isOnlinePaid ? ` Your refund of ₹${order.pricing.total} is being processed and will be credited to your original payment method within 5-7 working days.` : "";
    
    title = "Order Cancelled ❌";
    body = (note && String(note).trim()) ? note : `Unfortunately, your order has been cancelled by the restaurant.${refundDetail}`;
  }

  // Real-time: status update to restaurant room.
  try {
    const io = getIO();
    if (io) {
      console.log(
        `[DEBUG] Emitting status update to restaurant ${restaurantId} and user ${order.userId}: ${orderStatus}`,
      );
      const payload = {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        orderStatus: order.orderStatus,
        note: order.note || note || "",
        title,
        message: body,
      };
      
      const restRoom = rooms.restaurant(restaurantId);
      const userRoom = rooms.user(order.userId);
      
      console.log(`[DEBUG] Emitting order_status_update to rooms: ${restRoom}, ${userRoom}`);
      io.to(restRoom).emit("order_status_update", payload);
      io.to(userRoom).emit("order_status_update", payload);
      
      // Notify assigned rider via socket if they exist
      const assignedRiderId = order.dispatch?.deliveryPartnerId;
      if (assignedRiderId) {
          const riderRoom = rooms.delivery(assignedRiderId);
          console.log(`[DEBUG] Emitting order_status_update to rider room: ${riderRoom}`);
          io.to(riderRoom).emit("order_status_update", payload);
      }
    }

    const notifyList = [
      { ownerType: "USER", ownerId: order.userId },
      { ownerType: "RESTAURANT", ownerId: restaurantId },
    ];

    const assignedRiderId = order.dispatch?.deliveryPartnerId;
    if (assignedRiderId) {
      notifyList.push({ ownerType: "DELIVERY_PARTNER", ownerId: assignedRiderId });
    }

    let riderTitle = `Order #${order.order_id || order._id} updated`;
    let riderBody = `The order status is now ${String(orderStatus).replace(/_/g, " ")}.`;

    if (String(orderStatus).includes("cancel")) {
      riderTitle = "Order Cancelled ❌";
      riderBody = `Order #${order.order_id || order._id} has been cancelled. Please stop your current task.`;
      
      // Sync transaction status
      try {
        const isOnlinePaid = order.payment.method === "razorpay" && (order.payment.status === "paid" || order.payment.status === "refunded");
        await foodTransactionService.updateTransactionStatus(order._id, 'cancelled_by_restaurant', {
            status: isOnlinePaid ? 'refunded' : 'failed',
            note: `Order cancelled by restaurant/admin`,
            recordedByRole: 'RESTAURANT',
            recordedById: restaurantId
        });
      } catch (err) {
        logger.warn(`updateOrderStatusRestaurant transaction sync failed: ${err?.message || err}`);
      }
    }

    await notifyOwnersSafely(
      notifyList,
      {
        title: title,
        body: body,
        image: "https://i.ibb.co/5GzXz7r/K9 Rides-Brand-Image.png",
        data: {
          type: "order_status_update",
          orderId: order._id.toString(),
          orderMongoId: order._id?.toString?.() || "",
          orderStatus: String(orderStatus || ""),
          link: `/food/user/orders/${order._id?.toString?.() || ""}`,
        },
      },
    );
  } catch (err) {
    console.error("[DEBUG] Error emitting status update to restaurant:", err);
  }

  // Real-time: delivery request / ready notifications.
  try {
    const io = getIO();
    if (io) {
      // On accept (confirmed or preparing) -> request delivery partners via central logic
      if (
        (String(orderStatus) === "preparing" || String(orderStatus) === "confirmed") && 
        (String(from) !== "preparing" && String(from) !== "confirmed")
      ) {
        console.log(
          `[DEBUG] Order ${order._id.toString()} status changed to '${orderStatus}'. Triggering central delivery dispatch.`,
        );
        
        try {
            await tryAutoAssign(order._id);
            // Refresh local order state after assignment search
            order = await FoodOrder.findById(order._id); 
        } catch (err) {
            console.error(`[DEBUG] Auto-assign in updateOrderStatusRestaurant failed:`, err);
        }
      }

            // When ready for pickup -> ping assigned delivery partner.
            if (String(orderStatus) === 'ready_for_pickup' && String(from) !== 'ready_for_pickup') {
                console.log(`[DEBUG] Order ${order._id.toString()} changed to 'ready_for_pickup'.`);
                const assignedId = order.dispatch?.deliveryPartnerId?.toString?.() || order.dispatch?.deliveryPartnerId;
                if (assignedId) {
                    console.log(`[DEBUG] Notifying assigned partner ${assignedId} that order is ready.`);
                    const restaurant = await FoodRestaurant.findById(order.restaurantId).select('restaurantName location addressLine1 area city state').lean();
                    const payload = buildDeliverySocketPayload(order, restaurant);
                    logger.info(
                      `[DeliveryDispatch] Emitting order_ready to ${rooms.delivery(assignedId)} for order ${order._id.toString()}`,
                    );
                    io.to(rooms.delivery(assignedId)).emit('order_ready', payload);
                } else {
                    console.log(`[DEBUG] Order ${order._id.toString()} is ready but no partner assigned.`);
                }
            }
        }
    } catch (err) {
        console.error('[DEBUG] Error in delivery notification logic:', err);
    }

    enqueueOrderEvent('restaurant_order_status_updated', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        restaurantId,
        from,
        to: orderStatus
    });

    // ✅ NEW: Automated Razorpay Refund on Restaurant Cancel
    // Triggers if the restaurant sets status to a cancelled state (e.g., cancelled_by_restaurant)
    // Automated refund on restaurant cancel — idempotent + race-safe (see processOrderRefundOnce).
    if (String(orderStatus).includes("cancel")) {
      await processOrderRefundOnce(order, order.userId);
      await order.save();
    }

    return normalizeOrderForClient(order);
}

/**
 * Manually re-trigger delivery partner search for a restaurant order.
 * Only allowed if status is preparing/ready and no partner has accepted yet.
 */
export async function resendDeliveryNotificationRestaurant(orderId, restaurantId) {
    return dispatchService.resendDeliveryNotificationRestaurant(orderId, restaurantId);
}

export async function getCurrentTripDelivery(deliveryPartnerId) {
  return deliveryService.getCurrentTripDelivery(deliveryPartnerId);
}

// ----- Delivery: available, accept, reject, status -----
export async function listOrdersAvailableDelivery(deliveryPartnerId, query) {
  return deliveryService.listOrdersAvailableDelivery(deliveryPartnerId, query);
}

export async function acceptOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.acceptOrderDelivery(orderId, deliveryPartnerId);
}

export async function rejectOrderDelivery(orderId, deliveryPartnerId) {
  return deliveryService.rejectOrderDelivery(orderId, deliveryPartnerId);
}

export async function confirmReachedPickupDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedPickupDelivery(orderId, deliveryPartnerId);
}

/**
 * Slide to confirm pickup (Bill uploaded)
 */
export async function confirmPickupDelivery(
  orderId,
  deliveryPartnerId,
  billImageUrl,
) {
  return deliveryService.confirmPickupDelivery(
    orderId,
    deliveryPartnerId,
    billImageUrl,
  );
}

export async function confirmReachedDropDelivery(orderId, deliveryPartnerId) {
  return deliveryService.confirmReachedDropDelivery(orderId, deliveryPartnerId);
}

export async function verifyDropOtpDelivery(orderId, deliveryPartnerId, otp) {
  return deliveryService.verifyDropOtpDelivery(orderId, deliveryPartnerId, otp);
}

export async function completeDelivery(orderId, deliveryPartnerId, body = {}) {
  return deliveryService.completeDelivery(orderId, deliveryPartnerId, body);
}



export async function updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus) {
  return deliveryService.updateOrderStatusDelivery(orderId, deliveryPartnerId, orderStatus);
}

// ----- COD QR collection -----
export async function createCollectQr(
  orderId,
  deliveryPartnerId,
  customerInfo = {},
) {
  return paymentService.createCollectQr(orderId, deliveryPartnerId, customerInfo);
}


export async function getPaymentStatus(orderId, deliveryPartnerId) {
  return paymentService.getPaymentStatus(orderId, deliveryPartnerId);
}

export async function switchToCash(orderId, deliveryPartnerId) {
  return paymentService.switchToCash(orderId, deliveryPartnerId);
}


// ----- Admin -----
export async function listOrdersAdmin(query) {
  const { page, limit, skip } = buildPaginationOptions(query);
  const filter = {
    $or: [
      { "payment.method": { $in: ["cash", "wallet"] } },
      { "payment.status": { $in: ["paid", "authorized", "captured", "settled", "refunded"] } },
    ],
  };

  const rawStatus =
    typeof query.status === "string" ? query.status.trim().toLowerCase() : "";
  const cancelledBy =
    typeof query.cancelledBy === "string"
      ? query.cancelledBy.trim().toLowerCase()
      : "";
  const restaurantIdRaw =
    typeof query.restaurantId === "string" ? query.restaurantId.trim() : "";
  const startDateRaw =
    typeof query.startDate === "string" ? query.startDate.trim() : "";
  const endDateRaw =
    typeof query.endDate === "string" ? query.endDate.trim() : "";

  if (rawStatus && rawStatus !== "all") {
    switch (rawStatus) {
      case "pending":
        filter.orderStatus = { $in: ["created", "confirmed"] };
        break;
      case "accepted":
        filter.orderStatus = "confirmed";
        break;
      case "processing":
        filter.orderStatus = { $in: ["preparing", "ready_for_pickup"] };
        break;
      case "food-on-the-way":
        filter.orderStatus = "picked_up";
        break;
      case "delivered":
        filter.orderStatus = "delivered";
        break;
      case "canceled":
      case "cancelled":
        filter.orderStatus = {
          $in: [
            "cancelled_by_user",
            "cancelled_by_restaurant",
            "cancelled_by_admin",
          ],
        };
        break;
      case "restaurant-cancelled":
        filter.orderStatus = "cancelled_by_restaurant";
        break;
      case "payment-failed":
        filter["payment.status"] = "failed";
        break;
      case "refunded":
        filter["payment.status"] = "refunded";
        break;
      case "offline-payments":
        filter["payment.method"] = "cash";
        filter.orderStatus = { $in: ["created", "confirmed", "delivered"] };
        break;
      case "scheduled":
        filter.scheduledAt = { $ne: null };
        break;
      default:
        break;
    }
  }

  if (cancelledBy) {
    if (cancelledBy === "restaurant") {
      filter.orderStatus = "cancelled_by_restaurant";
    } else if (cancelledBy === "user" || cancelledBy === "customer") {
      filter.orderStatus = "cancelled_by_user";
    }
  }

  if (restaurantIdRaw && mongoose.Types.ObjectId.isValid(restaurantIdRaw)) {
    filter.restaurantId = new mongoose.Types.ObjectId(restaurantIdRaw);
  }

  if (startDateRaw || endDateRaw) {
    const createdAt = {};
    const start = startDateRaw ? new Date(startDateRaw) : null;
    const end = endDateRaw ? new Date(endDateRaw) : null;
    if (start && !Number.isNaN(start.getTime())) {
      createdAt.$gte = start;
    }
    if (end && !Number.isNaN(end.getTime())) {
      createdAt.$lte = end;
    }
    if (Object.keys(createdAt).length > 0) {
      filter.createdAt = createdAt;
    }
  }

  const [docs, total] = await Promise.all([
    FoodOrder.find(filter)
      .select("+deliveryOtp")
      .populate("userId", "name phone email")
      .populate("restaurantId", "restaurantName area city ownerPhone")
      .populate("dispatch.deliveryPartnerId", "name phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FoodOrder.countDocuments(filter),
  ]);
  const paginated = buildPaginatedResult({ docs: docs.map(d => normalizeOrderForClient(d)), total, page, limit });
  return { ...paginated, orders: paginated.data };
}

export async function assignDeliveryPartnerAdmin(
  orderId,
  deliveryPartnerId,
  adminId,
) {
  const order = await FoodOrder.findById(orderId);
  if (!order) throw new NotFoundError("Order not found");
  if (order.dispatch.status === "accepted")
    throw new ValidationError("Order already accepted by partner");

  const partner = await FoodDeliveryPartner.findById(deliveryPartnerId)
    .select("status")
    .lean();
  if (!partner || partner.status !== "approved")
    throw new ValidationError("Delivery partner not available");

    order.dispatch.status = 'assigned';
    order.dispatch.deliveryPartnerId = new mongoose.Types.ObjectId(deliveryPartnerId);
    order.dispatch.assignedAt = new Date();
    pushStatusHistory(order, { byRole: 'ADMIN', byId: adminId, from: order.dispatch.status, to: 'assigned' });
    await order.save();
    enqueueOrderEvent('delivery_partner_assigned', {
        orderMongoId: order._id?.toString?.(),
        orderId: order._id.toString(),
        deliveryPartnerId,
        adminId
    });
    return normalizeOrderForClient(order);
}

export async function deleteOrderAdmin(orderId, adminId) {
  const identity = buildOrderIdentityFilter(orderId);
  if (!identity) throw new ValidationError("Order id required");

  const order = await FoodOrder.findOne(identity).lean();
  if (!order) throw new NotFoundError("Order not found");

  // Keep support tickets but detach deleted order reference.
  await Promise.all([
    FoodSupportTicket.updateMany(
      { orderId: order._id },
      { $set: { orderId: null } },
    ),
    FoodTransaction.deleteOne({
      $or: [{ orderId: order._id }, { orderReadableId: String(order._id.toString()) }],
    }),
    FoodOrder.deleteOne({ _id: order._id }),
  ]);

  // Remove realtime tracking node if present.
  try {
    const db = getFirebaseDB();
    if (db && order?.orderId) {
      await db.ref(`active_orders/${order._id.toString()}`).remove();
    }
  } catch (err) {
    logger.warn(`Delete order firebase cleanup failed: ${err?.message || err}`);
  }

  // Notify connected apps so stale UI entries can disappear without refresh.
  try {
    const io = getIO();
    if (io) {
      const payload = {
        orderMongoId: String(order._id),
        orderId: String(order._id.toString() || ""),
        deletedBy: "ADMIN",
        adminId: adminId ? String(adminId) : null,
      };

      if (order.userId) io.to(rooms.user(order.userId)).emit("order_deleted", payload);
      if (order.restaurantId) io.to(rooms.restaurant(order.restaurantId)).emit("order_deleted", payload);
      if (order.dispatch?.deliveryPartnerId) {
        io.to(rooms.delivery(order.dispatch.deliveryPartnerId)).emit("order_deleted", payload);
      }
    }
  } catch (err) {
    logger.warn(`Delete order socket emit failed: ${err?.message || err}`);
  }

  enqueueOrderEvent("order_deleted_by_admin", {
    orderMongoId: String(order._id),
    orderId: String(order._id.toString() || ""),
    adminId: adminId ? String(adminId) : null,
  });

  return {
    deleted: true,
    orderId: String(order._id.toString() || ""),
    orderMongoId: String(order._id),
  };
}


/**
 * Single source of truth for food order statuses and their forward-progression priority.
 * Previously these strings + the priority map were duplicated across order.helpers.js, the
 * validators, and inline arrays in the dispatch/delivery services, which let them drift.
 * Import from here rather than re-declaring.
 */

export const ORDER_STATUS = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  CREATED: 'created',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  REACHED_PICKUP: 'reached_pickup',
  PICKED_UP: 'picked_up',
  REACHED_DROP: 'reached_drop',
  DELIVERED: 'delivered',
  CANCELLED_BY_USER: 'cancelled_by_user',
  CANCELLED_BY_RESTAURANT: 'cancelled_by_restaurant',
  CANCELLED_BY_ADMIN: 'cancelled_by_admin',
});

/** Higher = further along. Terminal (cancel/delivered) handled specially in isStatusAdvance. */
export const STATUS_PRIORITY = Object.freeze({
  [ORDER_STATUS.CREATED]: 10,
  [ORDER_STATUS.CONFIRMED]: 20,
  [ORDER_STATUS.PREPARING]: 30,
  [ORDER_STATUS.READY_FOR_PICKUP]: 40,
  [ORDER_STATUS.REACHED_PICKUP]: 50,
  [ORDER_STATUS.PICKED_UP]: 60,
  [ORDER_STATUS.REACHED_DROP]: 70,
  [ORDER_STATUS.DELIVERED]: 80,
  [ORDER_STATUS.CANCELLED_BY_USER]: 100,
  [ORDER_STATUS.CANCELLED_BY_RESTAURANT]: 100,
  [ORDER_STATUS.CANCELLED_BY_ADMIN]: 100,
});

/** Statuses a restaurant is permitted to set (kitchen-side only; pickup/delivery is driver-owned). */
export const RESTAURANT_SETTABLE_STATUSES = Object.freeze([
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.PREPARING,
  ORDER_STATUS.READY_FOR_PICKUP,
  ORDER_STATUS.CANCELLED_BY_RESTAURANT,
]);

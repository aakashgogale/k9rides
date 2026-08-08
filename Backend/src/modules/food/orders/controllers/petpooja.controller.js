import { FoodOrder } from '../models/order.model.js';
import { FoodRestaurant } from '../../restaurant/models/restaurant.model.js';
import * as orderService from '../services/order.service.js';
import { buildOrderIdentityFilter } from '../services/order.helpers.js';
import { getPetpoojaSettings } from '../services/petpooja.service.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Handles incoming webhooks from Petpooja POS to update order states on K9.
 */
export async function petpoojaWebhookController(req, res, next) {
    try {
        const settings = await getPetpoojaSettings();
        if (!settings.enabled) {
            return res.status(503).json({ success: false, message: 'Petpooja integration is disabled' });
        }

        const body = req.body || {};
        const { order_id, status, reason, outlet_code } = body;

        logger.info(`[Petpooja Webhook] Received webhook payload: ${JSON.stringify(body)}`);

        if (!order_id || !status) {
            return res.status(400).json({ success: false, message: 'Missing required fields: order_id and status' });
        }

        // 1. Resolve order
        const identity = buildOrderIdentityFilter(order_id);
        if (!identity) {
            return res.status(400).json({ success: false, message: 'Invalid order ID format' });
        }

        const order = await FoodOrder.findOne(identity);
        if (!order) {
            logger.warn(`[Petpooja Webhook] Order not found for ID: ${order_id}`);
            return res.status(404).json({ success: false, message: `Order ${order_id} not found` });
        }

        // 2. Validate restaurant and outlet code mapping
        const restaurant = await FoodRestaurant.findById(order.restaurantId)
            .select('petpoojaEnabled petpoojaOutletId')
            .lean();

        if (!restaurant || !restaurant.petpoojaEnabled) {
            logger.warn(`[Petpooja Webhook] Petpooja not active for restaurant associated with order ${order_id}`);
            return res.status(403).json({ success: false, message: 'Petpooja integration not active for this restaurant' });
        }

        // Guard: check that webhook outlet code matches restaurant's registered outlet code
        if (outlet_code && String(restaurant.petpoojaOutletId) !== String(outlet_code)) {
            logger.warn(`[Petpooja Webhook] Outlet mismatch for order ${order_id}: expected ${restaurant.petpoojaOutletId}, got ${outlet_code}`);
            return res.status(400).json({ success: false, message: 'Outlet code mismatch' });
        }

        const restaurantId = order.restaurantId.toString();
        const userId = order.userId.toString();
        const normalizedStatus = String(status).trim().toLowerCase();

        logger.info(`[Petpooja Webhook] Processing status transition for order ${order.order_id} to '${normalizedStatus}'`);

        // 3. Process status update
        if (normalizedStatus === 'confirmed' || normalizedStatus === 'accepted') {
            await orderService.updateOrderStatusRestaurant(order._id, restaurantId, 'confirmed', 'Accepted via Petpooja POS');
        } else if (normalizedStatus === 'preparing') {
            await orderService.updateOrderStatusRestaurant(order._id, restaurantId, 'preparing', 'Preparing via Petpooja POS');
        } else if (normalizedStatus === 'ready' || normalizedStatus === 'ready_for_pickup') {
            await orderService.updateOrderStatusRestaurant(order._id, restaurantId, 'ready_for_pickup', 'Ready via Petpooja POS');
        } else if (normalizedStatus === 'cancelled' || normalizedStatus === 'rejected') {
            // Note: cancelOrder triggers Razorpay / Wallet automatic refund logic internally
            await orderService.cancelOrder(order._id, userId, reason || 'Cancelled via Petpooja POS');
        } else {
            logger.warn(`[Petpooja Webhook] Unmapped status received: ${status}`);
            return res.status(400).json({ success: false, message: `Unmapped status '${status}'` });
        }

        return res.status(200).json({ success: true, message: 'Order status updated successfully' });

    } catch (err) {
        logger.error(`[Petpooja Webhook] Error processing webhook callback: ${err.message}`, { stack: err.stack });
        // Return 500 so Petpooja knows to retry, but log it properly
        return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
    }
}

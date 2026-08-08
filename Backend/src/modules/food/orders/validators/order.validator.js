import { z } from 'zod';
import { ValidationError } from '../../../../core/auth/errors.js';

const orderItemSchema = z.object({
    itemId: z.string().min(1, 'Item id required'),
    name: z.string().min(1, 'Item name required'),
    variantId: z.string().optional(),
    variantName: z.string().optional(),
    variantPrice: z.number().min(0).optional(),
    price: z.number().min(0),
    quantity: z.number().int().min(1),
    isVeg: z.boolean().optional().default(true),
    image: z.string().optional(),
    notes: z.string().optional()
});

const addressSchema = z.object({
    label: z.enum(['Home', 'Office', 'Other']).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().min(1, 'Street required'),
    additionalDetails: z.string().optional(),
    city: z.string().min(1, 'City required'),
    state: z.string().min(1, 'State required'),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const calculateAddressSchema = z.object({
    label: z.enum(['Home', 'Office', 'Other']).optional(),
    name: z.string().optional(),
    fullName: z.string().optional(),
    street: z.string().optional(),
    additionalDetails: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    phone: z.string().optional(),
    formattedAddress: z.string().optional(),
    address: z.string().optional(),
    location: z
        .object({
            type: z.literal('Point').optional(),
            coordinates: z.tuple([z.number(), z.number()]).optional()
        })
        .optional()
});

const pricingSchema = z.object({
    subtotal: z.number().min(0),
    tax: z.number().min(0).optional(),
    packagingFee: z.number().min(0).optional(),
    deliveryFee: z.number().min(0).optional(),
    platformFee: z.number().min(0).optional(),
    surgeAmount: z.number().min(0).optional(),
    discount: z.number().min(0).optional(),
    total: z.number().min(0),
    currency: z.string().optional()
});

function zodMessage(error) {
    const first = error?.issues?.[0] || error?.errors?.[0];
    const path = first?.path?.length ? first.path.join('.') : '';
    return path ? `${path}: ${first?.message || 'Validation failed'}` : first?.message || 'Validation failed';
}

function normalizePaymentMethod(value) {
    const method = String(value || '').trim().toLowerCase();
    if (['cod', 'cash_on_delivery'].includes(method)) return 'cash';
    if (['online', 'online_payment', 'digital', 'upi', 'card'].includes(method)) return 'razorpay';
    return method;
}

export function validateCalculateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        restaurantId: z.string().min(1, 'Restaurant id required'),
        address: addressSchema.optional(),
        deliveryAddress: addressSchema.optional(),
        deliveryAddressId: z.string().optional(),
        deliveryAddress: calculateAddressSchema.optional(),
        address: calculateAddressSchema.optional(),
        zoneId: z.string().optional(),
        couponCode: z.string().optional(),
        deliveryFleet: z.string().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    const data = result.data;
    if (data.deliveryAddress && !data.address) {
        return {
            ...data,
            address: data.deliveryAddress
        };
    }
    return data;
}

export function validateCreateOrderDto(body) {
    const schema = z.object({
        items: z.array(orderItemSchema).min(1, 'At least one item required'),
        address: addressSchema,
        restaurantId: z.string().min(1, 'Restaurant id required'),
        restaurantName: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        pricing: pricingSchema,
        deliveryFleet: z.string().optional(),
        note: z.string().optional(),
        sendCutlery: z.boolean().optional(),
        // 'razorpay_qr' means COD-style flow, but payment is collected via Razorpay QR at delivery.
        paymentMethod: z.preprocess(
            normalizePaymentMethod,
            z.enum(['cash', 'razorpay', 'razorpay_qr', 'wallet'])
        ),
        couponCode: z.string().optional(),
        zoneId: z.string().nullable().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateVerifyPaymentDto(body) {
    const schema = z.object({
        orderId: z.string().min(1, 'Order id required'),
        razorpayOrderId: z.string().min(1, 'Razorpay order id required'),
        razorpayPaymentId: z.string().min(1, 'Razorpay payment id required'),
        razorpaySignature: z.string().min(1, 'Razorpay signature required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateCancelOrderDto(body) {
    const schema = z.object({
        reason: z.string().optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateOrderStatusDto(body) {
    const schema = z.object({
        orderStatus: z.enum([
            'confirmed',
            'preparing',
            'ready_for_pickup',
            'picked_up',
            'delivered',
            'cancelled_by_restaurant'
        ]),
        note: z.string().optional()
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateAssignDeliveryDto(body) {
    const schema = z.object({
        deliveryPartnerId: z.string().min(1, 'Delivery partner id required')
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateDispatchSettingsDto(body) {
    const schema = z.object({
        dispatchMode: z.enum(['auto', 'manual'])
    });
    const result = schema.safeParse(body);
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

export function validateOrderRatingsDto(body) {
    const schema = z.object({
        restaurantRating: z.number().min(1).max(5),
        deliveryPartnerRating: z.number().min(1).max(5).optional(),
        restaurantComment: z.string().max(500).optional(),
        deliveryPartnerComment: z.string().max(500).optional()
    });
    const result = schema.safeParse(body || {});
    if (!result.success) {
        throw new ValidationError(zodMessage(result.error));
    }
    return result.data;
}

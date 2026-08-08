import mongoose from 'mongoose';

const foodPetpoojaSyncLogSchema = new mongoose.Schema(
    {
        orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodOrder', required: true, index: true },
        restaurantId: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodRestaurant', required: true, index: true },
        status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending', index: true },
        attempts: { type: Number, default: 0 },
        lastAttemptAt: { type: Date },
        error: { type: String, default: '' },
        payloadSent: { type: mongoose.Schema.Types.Mixed },
        responseReceived: { type: mongoose.Schema.Types.Mixed },
        petpoojaOrderId: { type: String, default: '', index: true },
        invoiceNo: { type: String, default: '' },
        invoiceUrl: { type: String, default: '' },
    },
    { collection: 'food_petpooja_sync_logs', timestamps: true }
);

// Add unique index on orderId to prevent duplicate sync log creation
foodPetpoojaSyncLogSchema.index({ orderId: 1 }, { unique: true });

export const FoodPetpoojaSyncLog = mongoose.model('FoodPetpoojaSyncLog', foodPetpoojaSyncLogSchema);

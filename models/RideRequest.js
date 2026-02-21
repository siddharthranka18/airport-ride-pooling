const mongoose = require('mongoose');

const rideRequestSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  pickupLocation: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: { 
      type: [Number],
      required: true,
      // coordinates: [longitude, latitude]
      validate: {
        validator: function(coordinates) {
          return coordinates.length === 2 &&
                 coordinates[0] >= -180 && coordinates[0] <= 180 &&
                 coordinates[1] >= -90 && coordinates[1] <= 90;
        },
        message: 'Invalid coordinates format'
      }
    }
  },
  dropoffLocation: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number],
      required: true,
      // coordinates: [longitude, latitude]
      validate: {
        validator: function(coordinates) {
          return coordinates.length === 2 &&
                 coordinates[0] >= -180 && coordinates[0] <= 180 &&
                 coordinates[1] >= -90 && coordinates[1] <= 90;
        },
        message: 'Invalid coordinates format'
      }
    }
  },
  detourTolerance: { //
    type: Number,
    required: true,
    min: 0, //minimum luggage is 0
    default: 5 // minutes
  },
  luggageCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  status: {
    type: String,
    enum: ['pending', 'matched', 'completed', 'cancelled'],
    default: 'pending'
  },
  price: {
    type: Number,
    min: 0,
    default: 0
  },
  pricingBreakdown: {
    baseFare: {
      type: Number,
      default: 0
    },
    distanceCost: {
      type: Number,
      default: 0
    },
    surgeMultiplier: {
      type: Number,
      default: 1.0
    },
    poolDiscountFactor: {
      type: Number,
      default: 1.0
    }
  }
}, {
  timestamps: true
});

// Add 2dsphere geospatial indexes for efficient location queries
rideRequestSchema.index({ pickupLocation: '2dsphere' });
rideRequestSchema.index({ dropoffLocation: '2dsphere' });

module.exports = mongoose.model('RideRequest', rideRequestSchema);
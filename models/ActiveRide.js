const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema({
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
  luggageCount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
});

const activeRideSchema = new mongoose.Schema({
  cabId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cab',
    required: true,
    // Note: 'unique' moved to the schema level index below for better partial filtering
    index: true 
  },
  passengers: [passengerSchema],
  currentRoute: {
    type: {
      type: String,
      enum: ['LineString'],
      required: true
    },
    coordinates: {
      type: [[Number]],
      required: true,
      validate: {
        validator: function(coordinates) {
          return coordinates.every(coord => 
            coord.length === 2 &&
            coord[0] >= -180 && coord[0] <= 180 &&
            coord[1] >= -90 && coord[1] <= 90
          );
        },
        message: 'Invalid route coordinates format'
      }
    }
  },
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active',
    index: true
  },
  totalPrice: {
    type: Number,
    min: 0,
    default: 0
  }
}, {
  timestamps: true,
  optimisticConcurrency: true
});

// CRITICAL: Geospatial indexes for the matching engine
activeRideSchema.index({ 'passengers.pickupLocation': '2dsphere' });

// CRITICAL: The "Circuit Breaker" 
// Ensures a Cab can only be in ONE 'active' ride at a time.
// This prevents the infinite loop where multiple bots claim the same cab.
activeRideSchema.index(
  { cabId: 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { status: 'active' } 
  }
);

module.exports = mongoose.model('ActiveRide', activeRideSchema);
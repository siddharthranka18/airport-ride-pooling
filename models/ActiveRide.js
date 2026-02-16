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
    required: true
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
      // coordinates: [[longitude, latitude], [longitude, latitude], ...]
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
    default: 'active'
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

// Add 2dsphere geospatial indexes for efficient location queries
activeRideSchema.index({ 'passengers.pickupLocation': '2dsphere' });
activeRideSchema.index({ 'passengers.dropoffLocation': '2dsphere' });

module.exports = mongoose.model('ActiveRide', activeRideSchema);
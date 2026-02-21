const mongoose = require('mongoose');

const cabSchema = new mongoose.Schema({
  driverName: {
    type: String,
    required: true,
    trim: true
  },
  licensePlate: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  capacity: {
    type: Number,
    required: true,
    min: 1
  },
  currentLocation: {
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
  }
}, {
  timestamps: true,
  optimisticConcurrency: true //its solving the prblm of two passengers booking dame seat in cab it will lock it and accp tthe first request
});

// Add 2dsphere geospatial index for efficient location queries
cabSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('Cab', cabSchema);
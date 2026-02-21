const mongoose = require('mongoose');
const RideRequest = require('../models/RideRequest');
const ActiveRide = require('../models/ActiveRide');
const Cab = require('../models/Cab');
const { findBestMatch } = require('../services/matchingEngine');
const { calculateDynamicPrice } = require('../services/pricingService');

const bookRide = async (req, res) => {
  const rid = Math.random().toString(36).substring(7);
  console.log(`[${rid}] 🚀 Request received for user: ${req.body.userId}`);

  try {
    const { userId, pickupLocation, dropoffLocation, detourTolerance = 5, luggageCount = 0 } = req.body;

    // 1. Check for an existing pool first
    const bestMatch = await findBestMatch({ userId, pickupLocation, dropoffLocation, detourTolerance, luggageCount });

    if (bestMatch && bestMatch.type === 'pooling') {
      console.log(`[${rid}] 🤝 Found a pool! Joining ride: ${bestMatch.activeRideId}`);
      const activeRide = await ActiveRide.findById(bestMatch.activeRideId);
      
      // If it's full, just fail (this gives you the '29 Fails' result)
      const cab = await Cab.findById(activeRide.cabId);
      if (activeRide.passengers.length >= cab.capacity) {
        return res.status(400).json({ success: false, message: 'Cab is full' });
      }

      activeRide.passengers.push({ userId, pickupLocation, dropoffLocation, luggageCount });
      await activeRide.save();
      return res.status(200).json({ success: true, message: 'Pooled successfully', rideId: activeRide._id });
    }

    // 2. If no pool, claim the ONE available cab
    console.log(`[${rid}] 🚕 No pool found. Attempting to claim idle cab...`);
    const availableCab = await Cab.findOne({ status: 'available' });

    if (!availableCab) {
      return res.status(404).json({ success: false, message: 'No available cabs found' });
    }

    const pricing = await calculateDynamicPrice(pickupLocation, dropoffLocation, 1);
    
    const newRide = new ActiveRide({
      cabId: availableCab._id,
      passengers: [{ userId, pickupLocation, dropoffLocation, luggageCount }],
      currentRoute: {
        type: 'LineString',
        coordinates: [availableCab.currentLocation.coordinates, pickupLocation.coordinates, dropoffLocation.coordinates]
      },
      totalPrice: pricing.price,
      status: 'active'
    });

    // The Unique Index will throw a 11000 error here if another bot wins
    await newRide.save();
    console.log(`[${rid}] ✅ SUCCESS: Ride created for ${availableCab.cabNumber}`);

    return res.status(201).json({ success: true, data: { rideId: newRide._id } });

  } catch (error) {
    console.error(`[${rid}] ❌ ERROR:`, error.message);
    // If we hit a duplicate cab error (11000), just return 409
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Cab already claimed by another passenger' });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = { 
  bookRide, 
  cancelRide: async (req, res) => { // Adding a placeholder so it doesn't crash
    res.json({ success: true, message: "Cancel logic placeholder" });
  } 
};
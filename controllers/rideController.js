const mongoose = require('mongoose');
const RideRequest = require('../models/RideRequest');
const ActiveRide = require('../models/ActiveRide');
const Cab = require('../models/Cab');
const { findBestMatch } = require('../services/matchingEngine');
const { calculateDynamicPrice } = require('../services/pricingService');

/**
 * Book a ride for a user
 * This endpoint handles the core ride pooling logic with optimistic concurrency control
 */
const bookRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const {
      userId,
      pickupLocation,
      dropoffLocation,
      detourTolerance = 5,
      luggageCount = 0
    } = req.body;

    // Validate required fields
    if (!userId || !pickupLocation || !dropoffLocation) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, pickupLocation, dropoffLocation'
      });
    }

    // Validate GeoJSON format
    if (!pickupLocation.type || !pickupLocation.coordinates || 
        pickupLocation.type !== 'Point' || pickupLocation.coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pickupLocation format. Expected GeoJSON Point with [longitude, latitude]'
      });
    }

    if (!dropoffLocation.type || !dropoffLocation.coordinates ||
        dropoffLocation.type !== 'Point' || dropoffLocation.coordinates.length !== 2) {
      return res.status(400).json({
        success: false,
        message: 'Invalid dropoffLocation format. Expected GeoJSON Point with [longitude, latitude]'
      });
    }

    // Create new ride request
    const rideRequest = new RideRequest({
      userId,
      pickupLocation,
      dropoffLocation,
      detourTolerance,
      luggageCount
    });

    await rideRequest.save({ session });

    // Find the best match using our matching engine
    const bestMatch = await findBestMatch(rideRequest);

    if (!bestMatch) {
      // No suitable match found, create a new active ride with this user
      const availableCab = await Cab.findOne({
        capacity: { $gte: 1 }
      }).session(session);

      if (!availableCab) {
        return res.status(404).json({
          success: false,
          message: 'No available cabs found'
        });
      }

      // Calculate dynamic price for solo ride
      const pricingResult = await calculateDynamicPrice(
        pickupLocation,
        dropoffLocation,
        1 // solo passenger
      );

      if (!pricingResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to calculate ride price'
        });
      }

      const newActiveRide = new ActiveRide({
        cabId: availableCab._id,
        passengers: [{
          userId,
          pickupLocation,
          dropoffLocation,
          luggageCount
        }],
        currentRoute: {
          type: 'LineString',
          coordinates: [
            availableCab.currentLocation.coordinates,
            pickupLocation.coordinates,
            dropoffLocation.coordinates
          ]
        },
        totalPrice: pricingResult.price
      });

      // Update ride request with pricing information
      rideRequest.status = 'matched';
      rideRequest.price = pricingResult.price;
      rideRequest.pricingBreakdown = pricingResult.breakdown;

      await newActiveRide.save({ session });
      await rideRequest.save({ session });
      await session.commitTransaction();

      return res.status(201).json({
        success: true,
        message: 'New ride created successfully',
        data: {
          rideId: newActiveRide._id,
          cabId: availableCab._id,
          driverName: availableCab.driverName,
          estimatedTime: bestMatch?.estimatedTime || 15,
          route: newActiveRide.currentRoute.coordinates,
          price: pricingResult.price,
          pricingBreakdown: pricingResult.breakdown,
          priceFormula: pricingResult.formula
        }
      });
    }

    // Handle the booking with optimistic concurrency control
    let bookingResult = null;
    let maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries && !bookingResult) {
      try {
        if (bestMatch.type === 'pooling') {
          // Add passenger to existing active ride
          const activeRide = await ActiveRide.findById(bestMatch.activeRideId).session(session);
          
          if (!activeRide || activeRide.status !== 'active') {
            throw new Error('Active ride not found or no longer active');
          }

          // Check if there's still space (another request might have filled it)
          const currentPassengerCount = activeRide.passengers.length;
          const cab = await Cab.findById(activeRide.cabId).session(session);
          
          if (currentPassengerCount >= cab.capacity) {
            throw new Error('Cab capacity filled during booking process');
          }

          // Add new passenger to the active ride
          activeRide.passengers.push({
            userId,
            pickupLocation,
            dropoffLocation,
            luggageCount
          });
          
          activeRide.currentRoute.coordinates = bestMatch.route;
          activeRide.updatedAt = new Date();

          // Calculate dynamic price for pooled ride
          const newPassengerCount = activeRide.passengers.length;
          const pricingResult = await calculateDynamicPrice(
            pickupLocation,
            dropoffLocation,
            newPassengerCount
          );

          if (!pricingResult.success) {
            throw new Error('Failed to calculate pooled ride price');
          }

          // Update total ride price
          activeRide.totalPrice = pricingResult.price;

          // CRITICAL: Optimistic locking - if version mismatch occurs, catch and retry
          await activeRide.save({ session });

          // Update ride request with pricing information
          rideRequest.status = 'matched';
          rideRequest.price = pricingResult.price;
          rideRequest.pricingBreakdown = pricingResult.breakdown;

          await rideRequest.save({ session });
          
          bookingResult = {
            success: true,
            message: 'Ride pooled successfully',
            data: {
              rideId: activeRide._id,
              cabId: activeRide.cabId,
              driverName: cab.driverName,
              estimatedTime: bestMatch.estimatedTime,
              route: bestMatch.route,
              passengerCount: activeRide.passengers.length,
              price: pricingResult.price,
              pricingBreakdown: pricingResult.breakdown,
              priceFormula: pricingResult.formula,
              poolDiscountApplied: newPassengerCount > 1
            }
          };

        } else {
          // Create new active ride for idle cab
          const cab = await Cab.findById(bestMatch.cabId).session(session);
          
          // Calculate dynamic price for new solo ride
          const pricingResult = await calculateDynamicPrice(
            pickupLocation,
            dropoffLocation,
            1 // solo passenger
          );

          if (!pricingResult.success) {
            throw new Error('Failed to calculate new ride price');
          }

          const newActiveRide = new ActiveRide({
            cabId: cab._id,
            passengers: [{
              userId,
              pickupLocation,
              dropoffLocation,
              luggageCount
            }],
            currentRoute: {
              type: 'LineString',
              coordinates: bestMatch.route
            },
            totalPrice: pricingResult.price
          });

          // Update ride request with pricing information
          rideRequest.status = 'matched';
          rideRequest.price = pricingResult.price;
          rideRequest.pricingBreakdown = pricingResult.breakdown;

          // CRITICAL: Optimistic locking - if version mismatch occurs, catch and retry
          await newActiveRide.save({ session });
          await rideRequest.save({ session });

          bookingResult = {
            success: true,
            message: 'New ride created successfully',
            data: {
              rideId: newActiveRide._id,
              cabId: cab._id,
              driverName: cab.driverName,
              estimatedTime: bestMatch.estimatedTime,
              route: bestMatch.route,
              price: pricingResult.price,
              pricingBreakdown: pricingResult.breakdown,
              priceFormula: pricingResult.formula
            }
          };
        }

      } catch (error) {
        if (error.name === 'VersionError' || error.message.includes('version')) {
          // CRITICAL CONCURRENCY HANDLING: VersionError means another request modified the document
          // Retry the matching process to find a new optimal match
          console.log(`Version conflict detected, retrying booking (attempt ${retryCount + 1}/${maxRetries})`);
          
          retryCount++;
          
          // Re-run matching engine to get updated state
          const updatedMatch = await findBestMatch(rideRequest);
          if (!updatedMatch) {
            // No more matches available after retry
            bookingResult = {
              success: false,
              message: 'No available rides found after retry. Please try again.',
              statusCode: 409
            };
            break;
          }
          
          bestMatch.activeRideId = updatedMatch.activeRideId;
          bestMatch.route = updatedMatch.route;
          bestMatch.estimatedTime = updatedMatch.estimatedTime;
          
        } else {
          // Other errors (validation, not found, etc.) - don't retry
          throw error;
        }
      }
    }

    if (!bookingResult) {
      // Max retries exceeded
      await session.abortTransaction();
      return res.status(409).json({
        success: false,
        message: 'Ride booking failed due to high demand. Please try again.',
        statusCode: 409
      });
    }

    await session.commitTransaction();
    return res.status(bookingResult.statusCode || 200).json(bookingResult);

  } catch (error) {
    await session.abortTransaction();
    
    console.error('Error booking ride:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate booking detected'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error during ride booking'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Cancel a ride booking
 * Handles both cancelling individual passengers and entire rides
 */
const cancelRide = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { rideId, userId } = req.params;

    if (!rideId || !userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: rideId and userId'
      });
    }

    const activeRide = await ActiveRide.findById(rideId).session(session);
    
    if (!activeRide) {
      return res.status(404).json({
        success: false,
        message: 'Active ride not found'
      });
    }

    if (activeRide.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a ride that is not active'
      });
    }

    // Find the passenger index
    const passengerIndex = activeRide.passengers.findIndex(
      p => p.userId.toString() === userId
    );

    if (passengerIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Passenger not found in this ride'
      });
    }

    // Remove the passenger
    activeRide.passengers.splice(passengerIndex, 1);

    // If no passengers left, cancel the entire ride
    if (activeRide.passengers.length === 0) {
      activeRide.status = 'cancelled';
      activeRide.updatedAt = new Date();
      
      await activeRide.save({ session });
      
      await session.commitTransaction();
      
      return res.json({
        success: true,
        message: 'Ride cancelled successfully (no passengers remaining)'
      });
    }

    // If passengers remain, recalculate the route
    const remainingPassengers = activeRide.passengers;
    const cab = await Cab.findById(activeRide.cabId).session(session);
    
    // Recalculate optimal route for remaining passengers
    const recalculatedRoute = calculateOptimalRouteForPassengers(
      remainingPassengers,
      cab.currentLocation.coordinates
    );

    activeRide.currentRoute.coordinates = recalculatedRoute;
    activeRide.updatedAt = new Date();

    // CRITICAL: Optimistic locking - handle version conflicts
    await activeRide.save({ session });
    
    await session.commitTransaction();
    
    return res.json({
      success: true,
      message: 'Passenger removed from ride successfully',
      data: {
        remainingPassengers: activeRide.passengers.length,
        newRoute: recalculatedRoute
      }
    });

  } catch (error) {
    await session.abortTransaction();
    
    console.error('Error cancelling ride:', error);
    
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Ride was modified by another request. Please refresh and try again.'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error during ride cancellation'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Helper function to calculate optimal route for remaining passengers
 * This is a simplified version - in practice, you'd use more sophisticated TSP algorithms
 */
const calculateOptimalRouteForPassengers = (passengers, cabLocation) => {
  // Simple implementation: cab -> first pickup -> first dropoff -> second pickup -> etc.
  const route = [cabLocation];
  
  passengers.forEach(passenger => {
    route.push(passenger.pickupLocation.coordinates);
    route.push(passenger.dropoffLocation.coordinates);
  });
  
  return route;
};

module.exports = {
  bookRide,
  cancelRide
};
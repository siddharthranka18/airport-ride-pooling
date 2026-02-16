const express = require('express');
const { bookRide, cancelRide } = require('../controllers/rideController');

const router = express.Router();

/**
 * @route   POST /api/rides/book
 * @desc    Book a new ride with smart pooling
 * @access  Public
 * 
 * Request Body:
 * {
 *   "userId": "507f1f77bcf86cd799439011",
 *   "pickupLocation": {
 *     "type": "Point",
 *     "coordinates": [-122.4194, 37.7749]
 *   },
 *   "dropoffLocation": {
 *     "type": "Point", 
 *     "coordinates": [-122.3867, 37.6205]
 *   },
 *   "detourTolerance": 10,
 *   "luggageCount": 2
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Ride pooled successfully",
 *   "data": {
 *     "rideId": "507f1f77bcf86cd799439012",
 *     "cabId": "507f1f77bcf86cd799439013",
 *     "driverName": "Driver 1",
 *     "estimatedTime": 15.5,
 *     "route": [[-122.4194, 37.7749], [-122.4200, 37.7755], ...],
 *     "passengerCount": 2
 *   }
 * }
 */
router.post('/book', bookRide);

/**
 * @route   DELETE /api/rides/:rideId/cancel/:userId
 * @desc    Cancel a ride booking for a specific user
 * @access  Public
 * 
 * Path Parameters:
 * - rideId: The ID of the active ride
 * - userId: The ID of the user to remove from the ride
 * 
 * Response:
 * {
 *   "success": true,
 *   "message": "Passenger removed from ride successfully",
 *   "data": {
 *     "remainingPassengers": 1,
 *     "newRoute": [[-122.4194, 37.7749], [-122.4200, 37.7755], ...]
 *   }
 * }
 */
router.delete('/:rideId/cancel/:userId', cancelRide);

module.exports = router;
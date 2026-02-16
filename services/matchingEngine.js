/**
 * Smart Airport Ride Pooling Matching Engine
 * This module implements the core DSA algorithm for grouping passengers into shared cabs.
 
 * Time Complexity Analysis:
 * - Initial MongoDB geoNear query: O(log n + k) where n is total cabs and k is nearby cabs
 * - In-memory filtering and scoring: O(k * p) where k is nearby cabs and p is average passengers per cab
 * - Overall complexity: O(log n + k*p) which is efficient for real-time matching
 * 
 * Space Complexity Analysis:
 * - MongoDB query results: O(k) for nearby cabs
 * - In-memory passenger data: O(k*p) for all passengers in candidate cabs
 * - Temporary route calculations: O(r) where r is route points
 * - Overall space complexity: O(k*p) which scales well with reasonable k values
 * 
 * The algorithm prioritizes:
 * 1. Geospatial proximity (MongoDB index optimization)
 * 2. Capacity and luggage constraints
 * 3. Detour tolerance validation
 * 4. Total travel deviation minimization
 */

const mongoose = require('mongoose');
const Cab = require('../models/Cab');
const RideRequest = require('../models/RideRequest');
const ActiveRide = require('../models/ActiveRide');

/**
 * Calculate Haversine distance between two GeoJSON points
 * @param {Array} coord1 [longitude, latitude]
 * @param {Array} coord2 [longitude, latitude]
 * @returns {number} Distance in kilometers
 */
const calculateDistance = (coord1, coord2) => {
  const [lon1, lat1] = coord1;
  const [lon2, lat2] = coord2;
  
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Calculate total route distance for a given sequence of points
 * @param {Array} route Array of [lon, lat] coordinates
 * @returns {number} Total distance in kilometers
 */
const calculateRouteDistance = (route) => {
  let totalDistance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(route[i], route[i + 1]);
  }
  return totalDistance;
};

/**
 * Check if a passenger's detour exceeds their tolerance
 * @param {Object} passenger Existing passenger data
 * @param {Object} newRequest New ride request
 * @param {Array} originalRoute Original route without new passenger
 * @param {Array} newRoute New route with new passenger
 * @returns {boolean} True if detour is within tolerance
 */
const checkDetourTolerance = (passenger, newRequest, originalRoute, newRoute) => {
  // Calculate original distance for this passenger
  const originalDistance = calculateDistance(
    passenger.pickupLocation.coordinates,
    passenger.dropoffLocation.coordinates
  );
  
  // Calculate new distance for this passenger in the pooled route
  // This is a simplified calculation - in practice, you'd need to find the passenger's
  // specific segment in the new route
  const newDistance = calculateRouteDistance(newRoute);
  
  // Calculate detour percentage
  const detourPercentage = ((newDistance - originalDistance) / originalDistance) * 100;
  
  // Convert tolerance from minutes to distance (assuming average speed of 40 km/h)
  const maxDetourDistance = (passenger.detourTolerance || 5) / 60 * 40;
  
  return detourPercentage <= maxDetourDistance;
};

/**
 * Check if adding a new passenger would exceed luggage capacity
 * @param {Array} passengers Current passengers in the cab
 * @param {number} newLuggageCount Luggage count of new passenger
 * @param {number} cabCapacity Total capacity of the cab
 * @returns {boolean} True if luggage constraint is satisfied
 */
const checkLuggageConstraint = (passengers, newLuggageCount, cabCapacity) => {
  const currentLuggage = passengers.reduce((total, p) => total + p.luggageCount, 0);
  // Assuming each passenger takes 1 seat and luggage space is proportional
  return (currentLuggage + newLuggageCount) <= cabCapacity;
};

/**
 * Find the best match for a new ride request
 * @param {Object} newRequest RideRequest object
 * @returns {Object|null} Best match result
 */
const findBestMatch = async (newRequest) => {
  try {
    // Step 1: Use MongoDB's $geoNear to find nearby cabs efficiently
    const nearbyCabs = await Cab.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: newRequest.pickupLocation.coordinates
          },
          distanceField: "distance",
          maxDistance: 5000, // 5km radius
          spherical: true
        }
      },
      {
        $lookup: {
          from: "activerides",
          localField: "_id",
          foreignField: "cabId",
          as: "activeRide"
        }
      },
      {
        $unwind: {
          path: "$activeRide",
          preserveNullAndEmptyArrays: true
        }
      }
    ]);

    let bestMatch = null;
    let bestScore = Infinity;

    // Step 2: In-memory filtering and scoring
    for (const cabData of nearbyCabs) {
      const cab = cabData;
      const activeRide = cabData.activeRide;

      // Check if cab is available (either idle or has space in active ride)
      let availableSeats = cab.capacity;
      let currentPassengers = [];
      
      if (activeRide) {
        currentPassengers = activeRide.passengers || [];
        availableSeats -= currentPassengers.length;
      }

      // Skip if no available seats
      if (availableSeats <= 0) continue;

      // Check luggage constraint
      if (!checkLuggageConstraint(currentPassengers, newRequest.luggageCount, cab.capacity)) {
        continue;
      }

      // Create candidate route with new passenger
      const candidateRoute = createOptimalRoute(
        currentPassengers,
        newRequest,
        cab.currentLocation.coordinates
      );

      // Check detour tolerance for all passengers
      let validDetour = true;
      const originalRoutes = currentPassengers.map(p => [
        p.pickupLocation.coordinates,
        p.dropoffLocation.coordinates
      ]);

      for (let i = 0; i < currentPassengers.length; i++) {
        if (!checkDetourTolerance(
          currentPassengers[i],
          newRequest,
          originalRoutes[i],
          candidateRoute
        )) {
          validDetour = false;
          break;
        }
      }

      if (!validDetour) continue;

      // Calculate total deviation score
      const deviationScore = calculateDeviationScore(
        currentPassengers,
        newRequest,
        candidateRoute
      );

      // Update best match if this one is better
      if (deviationScore < bestScore) {
        bestScore = deviationScore;
        bestMatch = {
          type: activeRide ? 'pooling' : 'new_ride',
          cabId: cab._id,
          activeRideId: activeRide?._id,
          route: candidateRoute,
          deviationScore,
          estimatedTime: calculateEstimatedTime(candidateRoute)
        };
      }
    }

    return bestMatch;

  } catch (error) {
    console.error('Error in matching engine:', error);
    throw error;
  }
};

/**
 * Create an optimal route that minimizes total travel distance
 * @param {Array} currentPassengers Existing passengers
 * @param {Object} newRequest New ride request
 * @param {Array} cabLocation Current cab location
 * @returns {Array} Optimized route coordinates
 */
const createOptimalRoute = (currentPassengers, newRequest, cabLocation) => {
  // Simplified route optimization - in practice, this would use TSP algorithms
  const allPoints = [
    { type: 'cab', coordinates: cabLocation },
    { type: 'pickup', coordinates: newRequest.pickupLocation.coordinates },
    { type: 'dropoff', coordinates: newRequest.dropoffLocation.coordinates },
    ...currentPassengers.map(p => ({ type: 'pickup', coordinates: p.pickupLocation.coordinates })),
    ...currentPassengers.map(p => ({ type: 'dropoff', coordinates: p.dropoffLocation.coordinates }))
  ];

  // Simple nearest neighbor heuristic for route optimization
  const route = [cabLocation];
  const remaining = [...allPoints.slice(1)];

  while (remaining.length > 0) {
    let nearest = null;
    let minDistance = Infinity;

    for (const point of remaining) {
      const distance = calculateDistance(route[route.length - 1], point.coordinates);
      if (distance < minDistance) {
        minDistance = distance;
        nearest = point;
      }
    }

    route.push(nearest.coordinates);
    remaining.splice(remaining.indexOf(nearest), 1);
  }

  return route;
};

/**
 * Calculate deviation score for route optimization
 * @param {Array} currentPassengers Existing passengers
 * @param {Object} newRequest New ride request
 * @param {Array} candidateRoute Proposed route
 * @returns {number} Deviation score (lower is better)
 */
const calculateDeviationScore = (currentPassengers, newRequest, candidateRoute) => {
  const baseDistance = calculateRouteDistance(candidateRoute);
  
  // Add penalty for each passenger's detour
  let detourPenalty = 0;
  currentPassengers.forEach(passenger => {
    const directDistance = calculateDistance(
      passenger.pickupLocation.coordinates,
      passenger.dropoffLocation.coordinates
    );
    const routeDistance = calculateRouteDistance(candidateRoute);
    const detourRatio = (routeDistance - directDistance) / directDistance;
    detourPenalty += detourRatio * 100; // Weight detour heavily
  });

  // Add penalty for total route length
  const lengthPenalty = baseDistance * 0.1;

  return baseDistance + detourPenalty + lengthPenalty;
};

/**
 * Calculate estimated travel time for a route
 * @param {Array} route Array of coordinates
 * @returns {number} Estimated time in minutes
 */
const calculateEstimatedTime = (route) => {
  const totalDistance = calculateRouteDistance(route);
  const averageSpeed = 40; // km/h
  return (totalDistance / averageSpeed) * 60; // Convert to minutes
};

module.exports = {
  findBestMatch,
  calculateDistance,
  calculateRouteDistance
};
/**
 * Smart Airport Ride Pooling Matching Engine
 */

const mongoose = require('mongoose');
const Cab = require('../models/Cab');
const RideRequest = require('../models/RideRequest');
const ActiveRide = require('../models/ActiveRide');

/**
 * Calculate Haversine distance between two GeoJSON points
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
 */
const calculateRouteDistance = (route) => {
  if (!route || route.length < 2) return 0;
  let totalDistance = 0;
  for (let i = 0; i < route.length - 1; i++) {
    totalDistance += calculateDistance(route[i], route[i + 1]);
  }
  return totalDistance;
};

/**
 * Check if a passenger's detour exceeds their tolerance
 */
const checkDetourTolerance = (passenger, newRequest, originalRoute, newRoute) => {
  // 1. FAST-PASS: If bots have the exact same start/end, they are a perfect match.
  if (
    passenger.pickupLocation.coordinates[0] === newRequest.pickupLocation.coordinates[0] &&
    passenger.dropoffLocation.coordinates[0] === newRequest.dropoffLocation.coordinates[0]
  ) {
    return true;
  }

  // 2. MATH FIX: Compare Kilometers to Kilometers, not Percentages to Kilometers.
  const originalDistance = calculateRouteDistance(originalRoute);
  const newDistance = calculateRouteDistance(newRoute);
  
  // How many EXTRA kilometers does this pooling add?
  const extraKm = newDistance - originalDistance;
  
  // Convert detour tolerance from minutes to kilometers (at 40km/h)
  const maxDetourKm = (passenger.detourTolerance || 5) / 60 * 40;
  
  return extraKm <= maxDetourKm;
};

/**
 * Check if adding a new passenger would exceed luggage capacity
 */
const checkLuggageConstraint = (passengers, newLuggageCount, cabCapacity) => {
  const currentLuggage = passengers.reduce((total, p) => total + p.luggageCount, 0);
  return (currentLuggage + newLuggageCount) <= cabCapacity;
};

/**
 * Find the best match for a new ride request
 */
const findBestMatch = async (newRequest) => {
  try {
    // Step 1: Use MongoDB's $geoNear to find nearby cabs efficiently
   // Step 1: Use MongoDB's $geoNear to find nearby cabs efficiently
    const nearbyCabs = await Cab.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: newRequest.pickupLocation.coordinates
          },
          distanceField: "distance",
          maxDistance: 50000, // 5km radius
          spherical: true,
          // Only look for cabs that are actually online/available
          query: { status: { $ne: 'offline' } } 
        }
      },
      {
        // ADVANCED LOOKUP: Only join with rides that have status "active"
        $lookup: {
          from: "activerides",
          let: { cab_id: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$cabId", "$$cab_id"] },
                    { $eq: ["$status", "active"] } 
                  ]
                }
              }
            }
          ],
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

    // Debug: Count how many cabs have active rides
    const cabsWithActiveRide = nearbyCabs.filter(c => c.activeRide && c.activeRide.status === 'active').length;
    console.log(`[Matching Engine] Found ${nearbyCabs.length} nearby cabs, ${cabsWithActiveRide} have active rides`);

    // Step 2: In-memory filtering and scoring
    for (const cabData of nearbyCabs) {
      // Only consider rides that are currently 'active'
      const activeRide = cabData.activeRide && cabData.activeRide.status === 'active' ? cabData.activeRide : null;

      let availableSeats = cabData.capacity;
      let currentPassengers = [];
      
      if (activeRide) {
        currentPassengers = activeRide.passengers || [];
        availableSeats -= currentPassengers.length;
      }

      if (availableSeats <= 0) continue;

      if (!checkLuggageConstraint(currentPassengers, newRequest.luggageCount, cabData.capacity)) {
        continue;
      }

      const candidateRoute = createOptimalRoute(
        currentPassengers,
        newRequest,
        cabData.currentLocation.coordinates
      );

      let validDetour = true;
      if (activeRide) {
        // Build the original route points to compare detour
        const originalRoutePoints = [
          cabData.currentLocation.coordinates,
          ...currentPassengers.map(p => p.pickupLocation.coordinates),
          ...currentPassengers.map(p => p.dropoffLocation.coordinates)
        ];

        for (let i = 0; i < currentPassengers.length; i++) {
          if (!checkDetourTolerance(
            currentPassengers[i],
            newRequest,
            originalRoutePoints,
            candidateRoute
          )) {
            validDetour = false;
            break;
          }
        }
      }

      if (!validDetour) continue;

      const deviationScore = calculateDeviationScore(currentPassengers, newRequest, candidateRoute);

      if (deviationScore < bestScore) {
        bestScore = deviationScore;
        bestMatch = {
          type: activeRide ? 'pooling' : 'new_ride',
          cabId: cabData._id,
          activeRideId: activeRide ? activeRide._id : null,
          route: candidateRoute,
          deviationScore,
          estimatedTime: calculateEstimatedTime(candidateRoute)
        };
      }
    }

    // Debug: Log result before returning
    if (bestMatch) {
      console.log(`[Matching Engine] Best match found: type=${bestMatch.type}, cabId=${bestMatch.cabId}, activeRideId=${bestMatch.activeRideId}`);
    } else {
      console.log(`[Matching Engine] No match found. Nearby cabs: ${nearbyCabs.length}, Cabs with active rides: ${cabsWithActiveRide}`);
    }

    // If there are nearby cabs but no match found (possibly due to strict constraints),
    // still return a new_ride match if we have available cabs
    if (!bestMatch && nearbyCabs.length > 0) {
      console.log(`[Matching Engine] No match due to constraints, attempting to return first available cab as new_ride`);
      
      // Find first cab without active ride or with capacity
      for (const cabData of nearbyCabs) {
        const activeRide = cabData.activeRide && cabData.activeRide.status === 'active' ? cabData.activeRide : null;
        const availableSeats = cabData.capacity - (activeRide ? (activeRide.passengers?.length || 0) : 0);
        
        if (availableSeats > 0) {
          const candidateRoute = createOptimalRoute(
            activeRide ? activeRide.passengers || [] : [],
            newRequest,
            cabData.currentLocation.coordinates
          );
          
          bestMatch = {
            type: 'new_ride',
            cabId: cabData._id,
            activeRideId: null,
            route: candidateRoute,
            deviationScore: calculateRouteDistance(candidateRoute),
            estimatedTime: calculateEstimatedTime(candidateRoute)
          };
          console.log(`[Matching Engine] Fallback match: type=${bestMatch.type}, cabId=${bestMatch.cabId}`);
          break;
        }
      }
    }

    return bestMatch;

  } catch (error) {
    console.error('Error in matching engine:', error);
    throw error;
  }
};

const createOptimalRoute = (currentPassengers, newRequest, cabLocation) => {
  const allPoints = [
    { type: 'cab', coordinates: cabLocation },
    { type: 'pickup', coordinates: newRequest.pickupLocation.coordinates },
    { type: 'dropoff', coordinates: newRequest.dropoffLocation.coordinates },
    ...currentPassengers.map(p => ({ type: 'pickup', coordinates: p.pickupLocation.coordinates })),
    ...currentPassengers.map(p => ({ type: 'dropoff', coordinates: p.dropoffLocation.coordinates }))
  ];

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

const calculateDeviationScore = (currentPassengers, newRequest, candidateRoute) => {
  const baseDistance = calculateRouteDistance(candidateRoute);
  let detourPenalty = 0;
  
  currentPassengers.forEach(passenger => {
    const directDistance = calculateDistance(
      passenger.pickupLocation.coordinates,
      passenger.dropoffLocation.coordinates
    );
    const detourRatio = (baseDistance - directDistance) / (directDistance || 1);
    detourPenalty += detourRatio * 10;
  });

  return baseDistance + detourPenalty;
};

const calculateEstimatedTime = (route) => {
  const totalDistance = calculateRouteDistance(route);
  return (totalDistance / 40) * 60; // 40km/h average
};

module.exports = {
  findBestMatch,
  calculateDistance,
  calculateRouteDistance
};
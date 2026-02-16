/**
 * Dynamic Pricing Service for Smart Airport Ride Pooling
 * 
 * This service implements a sophisticated pricing algorithm that considers:
 * 1. Base Fare: Standard minimum charge
 * 2. Distance Multiplier: Based on actual travel distance
 * 3. Pool Discount: Incentivizes ride sharing by reducing individual cost
 * 4. Surge Multiplier: Dynamic pricing based on supply/demand ratio
 * 
 * Pricing Formula:
 * Final Price = (Base Fare + (Distance * Distance Rate)) * Surge Multiplier * Pool Discount Factor
 */

const mongoose = require('mongoose');
const Cab = require('../models/Cab');
const RideRequest = require('../models/RideRequest');
const ActiveRide = require('../models/ActiveRide');

// Pricing constants - these can be configured based on business requirements
const PRICING_CONFIG = {
  BASE_FARE: 5.00,           // Minimum base fare in USD
  DISTANCE_RATE: 2.50,       // Cost per kilometer
  POOL_DISCOUNT_RATE: 0.15,  // 15% discount per additional passenger
  SURGE_THRESHOLD: 0.3,      // When available cabs < 30%, apply surge
  MAX_SURGE_MULTIPLIER: 3.0, // Maximum surge multiplier
  MIN_SURGE_MULTIPLIER: 1.0  // Minimum surge multiplier (no surge)
};

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
 * Calculate the surge multiplier based on current supply/demand
 * @returns {Promise<number>} Surge multiplier (1.0 to MAX_SURGE_MULTIPLIER)
 */
const calculateSurgeMultiplier = async () => {
  try {
    // Count available cabs (those not in active rides)
    const totalCabs = await Cab.countDocuments();
    
    // Count cabs currently in active rides
    const activeCabs = await ActiveRide.distinct('cabId');
    const availableCabs = totalCabs - activeCabs.length;
    
    // Count pending ride requests
    const pendingRequests = await RideRequest.countDocuments({ status: 'pending' });
    
    // Calculate supply/demand ratio
    const supplyDemandRatio = availableCabs / Math.max(pendingRequests, 1); // Avoid division by zero
    
    // Apply surge logic
    if (supplyDemandRatio < PRICING_CONFIG.SURGE_THRESHOLD) {
      // High demand, low supply - apply surge pricing
      const surgeFactor = 1 + (PRICING_CONFIG.SURGE_THRESHOLD - supplyDemandRatio) * 10;
      return Math.min(surgeFactor, PRICING_CONFIG.MAX_SURGE_MULTIPLIER);
    }
    
    return PRICING_CONFIG.MIN_SURGE_MULTIPLIER; // No surge
    
  } catch (error) {
    console.error('Error calculating surge multiplier:', error);
    return PRICING_CONFIG.MIN_SURGE_MULTIPLIER; // Default to no surge on error
  }
};

/**
 * Calculate pool discount factor based on number of passengers
 * @param {number} passengerCount - Number of passengers in the ride
 * @returns {number} Discount factor (1.0 = no discount, 0.85 = 15% discount)
 */
const calculatePoolDiscountFactor = (passengerCount) => {
  if (passengerCount <= 1) {
    return 1.0; // No discount for solo rides
  }
  
  // Apply discount for each additional passenger
  const discount = passengerCount * PRICING_CONFIG.POOL_DISCOUNT_RATE;
  const discountFactor = Math.max(1.0 - discount, 0.5); // Minimum 50% of base price
  
  return discountFactor;
};

/**
 * Calculate dynamic price for a ride
 * @param {Object} pickupLocation GeoJSON Point with coordinates
 * @param {Object} dropoffLocation GeoJSON Point with coordinates
 * @param {number} passengerCount Number of passengers in the ride
 * @returns {Promise<Object>} Pricing details
 */
const calculateDynamicPrice = async (pickupLocation, dropoffLocation, passengerCount = 1) => {
  try {
    // Step 1: Calculate base distance cost
    const distance = calculateDistance(
      pickupLocation.coordinates,
      dropoffLocation.coordinates
    );
    
    const distanceCost = distance * PRICING_CONFIG.DISTANCE_RATE;
    
    // Step 2: Calculate surge multiplier based on current market conditions
    const surgeMultiplier = await calculateSurgeMultiplier();
    
    // Step 3: Calculate pool discount factor
    const poolDiscountFactor = calculatePoolDiscountFactor(passengerCount);
    
    // Step 4: Apply the complete pricing formula
    // Final Price = (Base Fare + Distance Cost) * Surge Multiplier * Pool Discount Factor
    const basePrice = PRICING_CONFIG.BASE_FARE + distanceCost;
    const surgePrice = basePrice * surgeMultiplier;
    const finalPrice = surgePrice * poolDiscountFactor;
    
    // Round to 2 decimal places
    const roundedPrice = Math.round(finalPrice * 100) / 100;
    
    return {
      success: true,
      price: roundedPrice,
      breakdown: {
        baseFare: PRICING_CONFIG.BASE_FARE,
        distanceCost: Math.round(distanceCost * 100) / 100,
        distanceKm: Math.round(distance * 100) / 100,
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
        poolDiscountFactor: Math.round(poolDiscountFactor * 100) / 100,
        passengerCount
      },
      formula: `(${PRICING_CONFIG.BASE_FARE} + ${Math.round(distanceCost * 100) / 100}) × ${Math.round(surgeMultiplier * 100) / 100} × ${Math.round(poolDiscountFactor * 100) / 100} = ${roundedPrice}`
    };
    
  } catch (error) {
    console.error('Error calculating dynamic price:', error);
    return {
      success: false,
      error: 'Failed to calculate price',
      price: null
    };
  }
};

/**
 * Get current market conditions for transparency
 * @returns {Promise<Object>} Market condition details
 */
const getMarketConditions = async () => {
  try {
    const totalCabs = await Cab.countDocuments();
    const activeCabs = await ActiveRide.distinct('cabId');
    const availableCabs = totalCabs - activeCabs.length;
    const pendingRequests = await RideRequest.countDocuments({ status: 'pending' });
    const surgeMultiplier = await calculateSurgeMultiplier();
    
    return {
      success: true,
      marketConditions: {
        totalCabs,
        availableCabs,
        activeCabs: activeCabs.length,
        pendingRequests,
        supplyDemandRatio: availableCabs / Math.max(pendingRequests, 1),
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
        isSurgeActive: surgeMultiplier > PRICING_CONFIG.MIN_SURGE_MULTIPLIER
      }
    };
    
  } catch (error) {
    console.error('Error getting market conditions:', error);
    return {
      success: false,
      error: 'Failed to get market conditions'
    };
  }
};

/**
 * Calculate estimated price without database operations (for quick estimates)
 * @param {Object} pickupLocation GeoJSON Point with coordinates
 * @param {Object} dropoffLocation GeoJSON Point with coordinates
 * @param {number} passengerCount Number of passengers
 * @param {number} surgeMultiplier Optional surge multiplier (defaults to 1.0)
 * @returns {Object} Estimated price details
 */
const calculateEstimatedPrice = (pickupLocation, dropoffLocation, passengerCount = 1, surgeMultiplier = 1.0) => {
  try {
    const distance = calculateDistance(
      pickupLocation.coordinates,
      dropoffLocation.coordinates
    );
    
    const distanceCost = distance * PRICING_CONFIG.DISTANCE_RATE;
    const poolDiscountFactor = calculatePoolDiscountFactor(passengerCount);
    
    const basePrice = PRICING_CONFIG.BASE_FARE + distanceCost;
    const finalPrice = basePrice * surgeMultiplier * poolDiscountFactor;
    
    const roundedPrice = Math.round(finalPrice * 100) / 100;
    
    return {
      success: true,
      price: roundedPrice,
      breakdown: {
        baseFare: PRICING_CONFIG.BASE_FARE,
        distanceCost: Math.round(distanceCost * 100) / 100,
        distanceKm: Math.round(distance * 100) / 100,
        surgeMultiplier: Math.round(surgeMultiplier * 100) / 100,
        poolDiscountFactor: Math.round(poolDiscountFactor * 100) / 100,
        passengerCount
      }
    };
    
  } catch (error) {
    console.error('Error calculating estimated price:', error);
    return {
      success: false,
      error: 'Failed to calculate estimated price',
      price: null
    };
  }
};

module.exports = {
  calculateDynamicPrice,
  calculateEstimatedPrice,
  getMarketConditions,
  calculateDistance,
  calculateSurgeMultiplier,
  calculatePoolDiscountFactor
};
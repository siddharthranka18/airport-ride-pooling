const axios = require('axios');
const mongoose = require('mongoose');

const API_URL = 'http://localhost:3000/api/rides/book';

async function runAirportStressTest() {
    console.log("✈️  Preparing 30 passengers at the airport terminal...");
    
    // Helper to generate a single request
    const createRequest = () => {
        const fakeUserId = new mongoose.Types.ObjectId().toString();
        return {
            userId: fakeUserId,
            pickupLocation: { type: "Point", coordinates: [77.1025, 28.5562] },
            dropoffLocation: { type: "Point", coordinates: [77.2090, 28.6139] },
            detourTolerance: 5,
            luggageCount: 1
        };
    };

    let successCount = 0;
    let failCount = 0;

    console.log("🚀 PHASE 1: Launching the 'Lead Passenger' to establish the cab...");
    
    try {
        const leadResponse = await axios.post(API_URL, createRequest());
        console.log("✅ Cab Claimed! Ride ID:", leadResponse.data.data.rideId);
        successCount++;
    } catch (err) {
        console.error("❌ Lead passenger failed to claim a cab:", err.response?.data || err.message);
        failCount++;
        return; // No point in continuing if we can't get a single cab
    }

    // Give the database a brief moment (500ms) to index the new ActiveRide
    console.log("⏳ Waiting for database indexing...");
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log("👥 PHASE 2: Firing remaining 29 passengers for carpooling...");
    
    const poolRequests = [];
    for (let i = 0; i < 29; i++) {
        poolRequests.push(axios.post(API_URL, createRequest()));
    }

    const results = await Promise.allSettled(poolRequests);

    results.forEach(result => {
        if (result.status === 'fulfilled') {
            successCount++;
        } else {
            failCount++;
            // Log specific error to see if it's "Cab capacity filled" or a server crash
            console.log("Rejected:", result.reason.response?.data?.message || result.reason.message);
        }
    });

    console.log("--------------------------------------------------");
    console.log(`🏁 FINAL SUMMARY`);
    console.log(`✅ Successful Bookings: ${successCount}`);
    console.log(`❌ Failed Bookings: ${failCount}`);
    console.log("--------------------------------------------------");
    
    if (successCount === 4) {
        console.log("🎉 SUCCESS: Cab capacity (4) was perfectly utilized!");
    }
}

runAirportStressTest();
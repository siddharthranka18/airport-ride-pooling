# ✈️ Smart Airport Ride Pooling API

A high-performance Node.js backend that intelligently groups airport passengers heading in similar directions into shared cabs. The system features real-time route optimization, dynamic surge pricing, and database-level concurrency protection to prevent double-booking under high load.

---

## 📋 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [API Reference](#-api-reference)
- [System Design](#-system-design)
- [Pricing Model](#-pricing-model)
- [Concurrency & Race Conditions](#-concurrency--race-conditions)
- [Stress Testing](#-stress-testing)
- [Project Structure](#-project-structure)

---

## ✨ Features

- 🤝 **Smart Ride Pooling** — Automatically groups passengers with compatible routes
- 🗺️ **Geospatial Matching** — MongoDB `$geoNear` aggregation finds nearby cabs in one efficient DB call
- 📐 **Route Optimization** — Nearest-neighbor greedy algorithm builds optimal multi-stop routes
- ⏱️ **Detour Tolerance** — Respects each passenger's personal max detour threshold
- 🧳 **Luggage Constraints** — Enforces cab luggage capacity across all pooled passengers
- 💸 **Dynamic Pricing** — Surge multiplier based on live supply/demand + pool discount for sharing
- 🔒 **Race-Condition Safe** — MongoDB partial unique index prevents double-booking under concurrent load
- 🧪 **Built-in Stress Test** — Simulates 30 concurrent passengers to validate concurrency guarantees

---

## 🏗️ Architecture

```
HTTP Request
     │
     ▼
Express Server (server.js)
     │
     ▼
Routes (rideRoutes.js)          /api/rides/book
     │                          /api/rides/:rideId/cancel/:userId
     ▼
Controller (rideController.js)
     │
     ├──► Matching Engine (matchingEngine.js)   ← finds best cab / pool
     │
     └──► Pricing Service (pricingService.js)   ← calculates dynamic fare
     │
     ▼
MongoDB via Mongoose
  ├── User         (passenger identity)
  ├── Cab          (vehicle fleet + GPS)
  ├── RideRequest  (booking snapshots)
  └── ActiveRide   (live rides with embedded passengers + route)
```

---

## 🛠️ Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js |
| Web Framework | Express.js v5 |
| Database | MongoDB |
| ODM | Mongoose v9 |
| Geospatial | MongoDB 2dsphere indexes + `$geoNear` |
| HTTP Client | Axios (stress test) |

---

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- MongoDB running locally on port `27017`

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/airport-ride-pooling.git
cd airport-ride-pooling

# Install dependencies
npm install
```

### Seed the Database

Populates 5 users and 5 cabs with random GPS coordinates near San Francisco International Airport.

```bash
node seed.js
```

### Start the Server

```bash
node server.js
# Server running on port 3000
# Connected to MongoDB
```

---

## 📡 API Reference

### Book a Ride
```
POST /api/rides/book
```

**Request Body**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "pickupLocation": {
    "type": "Point",
    "coordinates": [-122.4194, 37.7749]
  },
  "dropoffLocation": {
    "type": "Point",
    "coordinates": [-122.3867, 37.6205]
  },
  "detourTolerance": 10,
  "luggageCount": 1
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `userId` | ObjectId | required | Passenger's user ID |
| `pickupLocation` | GeoJSON Point | required | `[longitude, latitude]` |
| `dropoffLocation` | GeoJSON Point | required | `[longitude, latitude]` |
| `detourTolerance` | Number (min) | `5` | Max extra travel time passenger accepts |
| `luggageCount` | Number | `0` | Number of luggage pieces |

**Response — Pool Found (200)**
```json
{
  "success": true,
  "message": "Pooled successfully",
  "rideId": "507f1f77bcf86cd799439012"
}
```

**Response — New Ride Created (201)**
```json
{
  "success": true,
  "data": { "rideId": "507f1f77bcf86cd799439013" }
}
```

---

### Cancel a Ride
```
DELETE /api/rides/:rideId/cancel/:userId
```

**Response (200)**
```json
{
  "success": true,
  "message": "Cancel logic placeholder"
}
```

---

## ⚙️ System Design

### Matching Engine (`services/matchingEngine.js`)

The core algorithm runs in two phases:

**Phase 1 — Database Query**
```
$geoNear  →  find all non-offline cabs within 50km of pickup
$lookup   →  attach each cab's current ActiveRide (if any)
$unwind   →  flatten (keeps cabs with no active ride)
```

**Phase 2 — In-Memory Scoring**

For each nearby cab:
1. Skip if **no available seats**
2. Skip if **luggage would overflow**
3. Build a **candidate route** (nearest-neighbor greedy)
4. Check **detour tolerance** for all existing passengers

   ```
   Extra km added  ≤  (detourTolerance_minutes / 60) × 40 km/h
   ```

5. Compute **deviation score** = `totalRouteDistance + detourPenalty`
6. Track cab with **lowest score** as best match

**Route Construction — Nearest-Neighbor Algorithm**

```
1. Start at cab's current GPS location
2. Collect all pickup + dropoff points of all passengers (current + new)
3. Repeatedly visit the nearest unvisited point
4. Return the ordered coordinate array
```

### Haversine Distance Formula

All distance calculations use the Haversine formula to compute real-world distances on Earth's spherical surface, not flat Euclidean distance.

```
d = 2R × arcsin(√(sin²(Δlat/2) + cos(lat1)cos(lat2)sin²(Δlon/2)))
```

---

## 💸 Pricing Model

```
Final Price = (Base Fare + Distance Cost) × Surge Multiplier × Pool Discount Factor
```

| Variable | Value | Logic |
|---|---|---|
| Base Fare | $5.00 | Flat minimum |
| Distance Rate | $2.50 / km | Haversine distance |
| Pool Discount | 15% per extra passenger | Min floor: 50% of base |
| Surge Floor | 1.0× | No surge |
| Surge Ceiling | 3.0× | Caps at 3× |

### Surge Pricing Trigger

```
Supply/Demand Ratio = availableCabs / pendingRequests

If ratio < 0.30 (30%) → Surge = 1 + (0.30 - ratio) × 10
```

When fewer than 30% of cabs are free relative to demand, prices surge proportionally up to a 3× cap.

---

## 🔒 Concurrency & Race Conditions

Two mechanisms guarantee correctness under concurrent load:

### 1. Optimistic Concurrency Control
Mongoose's `optimisticConcurrency: true` adds a `__v` version field to `Cab` and `ActiveRide`. Before saving, Mongoose verifies the document hasn't been modified since it was read. If it has → throws a version conflict error, preventing stale writes.

### 2. MongoDB Partial Unique Index (Circuit Breaker)
```js
activeRideSchema.index(
  { cabId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);
```
This index enforces that **only one `ActiveRide` with `status: 'active'` can exist per cab at any time**. If two concurrent requests simultaneously try to claim the same cab, exactly one write succeeds. The second receives MongoDB error code `11000` (duplicate key), which the controller converts to HTTP `409 Conflict`.

---

## 🧪 Stress Testing

The built-in stress test simulates 30 passengers hitting the API simultaneously:

```bash
node controllers/stressTest.js
```

**Test Flow:**

| Phase | Action | Expected |
|---|---|---|
| Phase 1 | 1 "lead" passenger books first | ✅ Cab claimed, `ActiveRide` created |
| *(500ms wait)* | DB indexes the new ride | — |
| Phase 2 | 29 passengers fire concurrently | ✅ 3 pool in, 26 rejected (cab full) |

**Expected output:**
```
✅ Successful Bookings: 4
❌ Failed Bookings:     26
🎉 SUCCESS: Cab capacity (4) was perfectly utilized!
```

---

## 📁 Project Structure

```
airport-ride-pooling/
├── server.js                    # Express app bootstrap + MongoDB connect
├── seed.js                      # DB seeder (5 users, 5 cabs near SFO)
├── package.json
├── swagger.yaml                 # Full OpenAPI 3.0 spec
│
├── config/
│   └── db.js                    # MongoDB connection helper
│
├── models/
│   ├── User.js                  # Passenger schema
│   ├── Cab.js                   # Vehicle schema + 2dsphere index
│   ├── RideRequest.js           # Booking request + pricing breakdown
│   └── ActiveRide.js            # Live ride + circuit breaker index
│
├── routes/
│   └── rideRoutes.js            # Route definitions with JSDoc
│
├── controllers/
│   ├── rideController.js        # bookRide + cancelRide handlers
│   └── stressTest.js            # 30-passenger concurrency test
│
└── services/
    ├── matchingEngine.js        # Geospatial + scoring algorithm
    └── pricingService.js        # Surge + pool discount pricing
```

---

## 📄 License

ISC
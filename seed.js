const mongoose = require('mongoose');
const connectDB = require('./config/db');
const User = require('./models/User');
const Cab = require('./models/Cab');

// Airport coordinates (example: near an airport)
const AIRPORT_COORDINATES = [-122.302, 37.618]; // San Francisco International Airport area

// Generate random coordinates around the airport
const generateRandomCoordinates = (center, radiusKm = 5) => {
  const radiusInDeg = radiusKm / 111; // Approximate conversion
  const lat = center[1] + (Math.random() - 0.5) * radiusInDeg * 2;
  const lon = center[0] + (Math.random() - 0.5) * radiusInDeg * 2;
  return [lon, lat];
};

const seedData = async () => {
  try {
    // Connect to database
    await connectDB();

    // Clear existing data
    await User.deleteMany({});
    await Cab.deleteMany({});

    console.log('Seeding database with dummy data...');

    // Create 5 dummy users
    const users = [
      { name: 'John Doe', email: 'john.doe@example.com' },
      { name: 'Jane Smith', email: 'jane.smith@example.com' },
      { name: 'Bob Johnson', email: 'bob.johnson@example.com' },
      { name: 'Alice Brown', email: 'alice.brown@example.com' },
      { name: 'Charlie Wilson', email: 'charlie.wilson@example.com' }
    ];

    const createdUsers = await User.insertMany(users);
    console.log(`Created ${createdUsers.length} users`);

    // Create 5 dummy cabs with random locations around the airport
    const cabs = [];
    for (let i = 1; i <= 5; i++) {
      cabs.push({
        driverName: `Driver ${i}`,
        licensePlate: `ABC${1000 + i}`,
        capacity: 4,
        currentLocation: {
          type: 'Point',
          coordinates: generateRandomCoordinates(AIRPORT_COORDINATES, 3)
        }
      });
    }

    const createdCabs = await Cab.insertMany(cabs);
    console.log(`Created ${createdCabs.length} cabs`);

    console.log('Database seeded successfully!');
    console.log('Users:', createdUsers.map(u => ({ name: u.name, email: u.email })));
    console.log('Cabs:', createdCabs.map(c => ({ 
      driver: c.driverName, 
      plate: c.licensePlate, 
      location: c.currentLocation.coordinates 
    })));

    // Close connection
    mongoose.connection.close();

  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

// Run the seed function
seedData();
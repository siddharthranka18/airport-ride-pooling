const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Smart Airport Ride Pooling Backend API' });
});

// Ride booking routes
app.use('/api/rides', require('./routes/rideRoutes'));

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/airport-ride-pooling')
.then(() => {
  console.log('Connected to MongoDB');
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})
.catch((err) => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

module.exports = app;
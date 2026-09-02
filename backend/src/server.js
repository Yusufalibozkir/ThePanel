const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Basic health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'ThePanel API is running' });
});

// Import routes
const shopifyRoutes = require('./routes/shopify');
const productRoutes = require('./routes/products');
const syncRoutes = require('./routes/sync');

// Use routes
app.use('/api/shopify', shopifyRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sync', syncRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

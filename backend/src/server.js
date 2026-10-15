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
const settingsRoutes = require('./routes/settings');
const rulesRoutes = require('./routes/rules');
const jobsRoutes = require('./routes/jobs');
const logsRoutes = require('./routes/logs');
const abebooksRoutes = require('./routes/abebooks');

// Use routes
app.use('/api/shopify', shopifyRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/abebooks', abebooksRoutes);

// Durable job runner (retries + backoff)
const jobRunner = require('./jobs/runner');
require('./jobs/handlers');
jobRunner.start();

// Start server (localhost-only)
const HOST = process.env.HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

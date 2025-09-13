/*
 * ServiceBook Pros backend skeleton server
 *
 * This Express application provides a starting point for implementing the
 * core backend services defined in api_spec.yaml.  It demonstrates JWT
 * authentication middleware, connects to a PostgreSQL database and defines
 * basic routes for managing customers.  Additional routes and business
 * logic should be implemented in separate modules.
 */

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Pool } = require('pg');
const http = require('http');
const WebSocket = require('ws');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const morgan = require('morgan');
const winston = require('winston');
const { body, validationResult } = require('express-validator');
const speakeasy = require('speakeasy');

// Load environment variables (use dotenv in development)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const app = express();
const port = process.env.PORT || 3000;

// HTTP server wrapper to attach WebSocket server
const server = http.createServer(app);

// WebSocket server for real‑time updates (will be initialised after routes)
let wss;

// Helper to broadcast messages to all connected WebSocket clients
function broadcast(data) {
  if (!wss) return;
  const message = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Database pool
// If DATABASE_URL is provided (e.g. in production via Heroku), use it.
// Otherwise, fall back to individual settings from .env (DB_HOST, DB_PORT, etc.).
let poolConfig;
if (process.env.DATABASE_URL) {
  poolConfig = { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false };
} else {
  poolConfig = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}
const pool = new Pool(poolConfig);

app.use(cors());
// Apply security headers
app.use(helmet());
// Rate limiting to mitigate brute force attacks
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);
// Logging using morgan & winston
const logger = winston.createLogger({
  level: 'info',
  transports: [new winston.transports.Console()],
});
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
app.use(express.json());

// Middleware to authenticate using JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// Middleware for role-based access control
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    next();
  };
}

// Helper to hash a password using PBKDF2
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

// Helper to verify a password against a stored hash
function verifyPassword(password, storedHash) {
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// Route: Register a new user
app.post(
  '/auth/register',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['admin', 'manager', 'technician']).withMessage('Invalid role'),
  ],
  async (req, res) => {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password, role } = req.body;
    const userRole = role || 'manager';
    try {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rowCount > 0) {
        return res.status(409).json({ error: 'User already exists' });
      }
      const passwordHash = hashPassword(password);
      const insert = await pool.query(
        'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role, mfa_enabled',
        [email, passwordHash, userRole]
      );
      const user = insert.rows[0];
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role, mfa_enabled: user.mfa_enabled }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.status(201).json({ token, user });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Route: Login
app.post(
  '/auth/login',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('mfa_code').optional().isNumeric().withMessage('MFA code must be numeric'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const { email, password, mfa_code } = req.body;
    try {
      const result = await pool.query('SELECT id, email, role, password_hash, mfa_enabled, mfa_secret FROM users WHERE email = $1', [email]);
      if (result.rowCount === 0) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      const user = result.rows[0];
      if (!verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      // If MFA is enabled, require a valid MFA code
      if (user.mfa_enabled) {
        if (!mfa_code) {
          return res.status(401).json({ error: 'MFA code required' });
        }
        const verified = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: mfa_code, window: 1 });
        if (!verified) {
          return res.status(401).json({ error: 'Invalid MFA code' });
        }
      }
      const token = jwt.sign({ id: user.id, email: user.email, role: user.role, mfa_enabled: user.mfa_enabled }, process.env.JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/*
 * Multi-factor authentication routes
 */

// Begin MFA setup: generate a secret and return otpauth URL
app.post('/auth/setup-mfa', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  try {
    const secret = speakeasy.generateSecret({ name: `ServiceBook Pros (${req.user.email})` });
    // Save secret temporarily; mfa_enabled remains false until verified
    await pool.query('UPDATE users SET mfa_secret = $1 WHERE id = $2', [secret.base32, userId]);
    res.json({ secret: secret.base32, otpauth_url: secret.otpauth_url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify MFA code and enable MFA
app.post('/auth/verify-mfa', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { token: mfaToken } = req.body;
  if (!mfaToken) {
    return res.status(400).json({ error: 'MFA token is required' });
  }
  try {
    const result = await pool.query('SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1', [userId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const { mfa_secret, mfa_enabled } = result.rows[0];
    if (mfa_enabled) {
      return res.status(400).json({ error: 'MFA is already enabled' });
    }
    const verified = speakeasy.totp.verify({ secret: mfa_secret, encoding: 'base32', token: mfaToken, window: 1 });
    if (!verified) {
      return res.status(401).json({ error: 'Invalid MFA token' });
    }
    await pool.query('UPDATE users SET mfa_enabled = TRUE WHERE id = $1', [userId]);
    res.json({ message: 'MFA enabled' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Get all customers
app.get('/customers', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM customers ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Create a new customer
app.post('/customers', authenticateToken, async (req, res) => {
  const { name, email, phone, address, city, state, postal_code } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO customers (name, email, phone, address, city, state, postal_code) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [name, email, phone, address, city, state, postal_code]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Get a customer by ID
app.get('/customers/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM customers WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Update a customer by ID
app.put('/customers/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, address, city, state, postal_code } = req.body;
  try {
    const result = await pool.query(
      'UPDATE customers SET name = $1, email = $2, phone = $3, address = $4, city = $5, state = $6, postal_code = $7, updated_at = NOW() WHERE id = $8 RETURNING *',
      [name, email, phone, address, city, state, postal_code, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Delete a customer by ID
app.delete('/customers/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM customers WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.sendStatus(204);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TODO: Add routes for jobs, price‑book items, invoices, payments and user management

/*
 * Pricebook Category Routes
 */

// Get all categories (optionally filter by parent_id)
app.get('/pricebook/categories', authenticateToken, async (req, res) => {
  const { parent_id } = req.query;
  try {
    let result;
    if (parent_id) {
      result = await pool.query('SELECT * FROM pricebook_categories WHERE parent_id = $1 ORDER BY id', [parent_id]);
    } else {
      result = await pool.query('SELECT * FROM pricebook_categories ORDER BY id');
    }
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new category
app.post('/pricebook/categories', authenticateToken, async (req, res) => {
  const { name, parent_id } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO pricebook_categories (name, parent_id) VALUES ($1, $2) RETURNING *',
      [name, parent_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a category by ID
app.get('/pricebook/categories/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM pricebook_categories WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a category by ID
app.put('/pricebook/categories/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { name, parent_id } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const result = await pool.query(
      'UPDATE pricebook_categories SET name = $1, parent_id = $2 WHERE id = $3 RETURNING *',
      [name, parent_id || null, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a category by ID
app.delete('/pricebook/categories/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM pricebook_categories WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Pricebook Item Routes
 */

// Get all items (optional filter by category_id or price_tier)
app.get('/pricebook/items', authenticateToken, async (req, res) => {
  const { category_id, price_tier } = req.query;
  try {
    let query = 'SELECT * FROM pricebook_items';
    const conditions = [];
    const values = [];
    if (category_id) {
      values.push(category_id);
      conditions.push(`category_id = $${values.length}`);
    }
    if (price_tier) {
      values.push(price_tier);
      conditions.push(`price_tier = $${values.length}`);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY id';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new pricebook item
app.post('/pricebook/items', authenticateToken, async (req, res) => {
  const { category_id, name, description, labour_rate, parts_cost, price_tier } = req.body;
  if (!category_id || !name || labour_rate == null || parts_cost == null) {
    return res.status(400).json({ error: 'category_id, name, labour_rate and parts_cost are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO pricebook_items (category_id, name, description, labour_rate, parts_cost, price_tier) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [category_id, name, description || null, labour_rate, parts_cost, price_tier || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a pricebook item by ID
app.get('/pricebook/items/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM pricebook_items WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a pricebook item by ID
app.put('/pricebook/items/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { category_id, name, description, labour_rate, parts_cost, price_tier } = req.body;
  try {
    const result = await pool.query(
      'UPDATE pricebook_items SET category_id = COALESCE($1, category_id), name = COALESCE($2, name), description = COALESCE($3, description), labour_rate = COALESCE($4, labour_rate), parts_cost = COALESCE($5, parts_cost), price_tier = COALESCE($6, price_tier), updated_at = NOW() WHERE id = $7 RETURNING *',
      [category_id, name, description, labour_rate, parts_cost, price_tier, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a pricebook item by ID
app.delete('/pricebook/items/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM pricebook_items WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Pricebook Version Routes
 */

// Get all versions for a specific pricebook item
app.get('/pricebook/items/:id/versions', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // Ensure item exists
    const itemCheck = await pool.query('SELECT id FROM pricebook_items WHERE id = $1', [id]);
    if (itemCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const result = await pool.query(
      'SELECT id, item_id, effective_at, labour_rate, parts_cost, price_tier, created_at FROM pricebook_item_versions WHERE item_id = $1 ORDER BY effective_at DESC',
      [id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new version for a pricebook item
app.post('/pricebook/items/:id/versions', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { effective_at, labour_rate, parts_cost, price_tier } = req.body;
  if (!effective_at || labour_rate == null || parts_cost == null) {
    return res.status(400).json({ error: 'effective_at, labour_rate and parts_cost are required' });
  }
  if (price_tier && !['good','better','best'].includes(price_tier)) {
    return res.status(400).json({ error: 'Invalid price_tier' });
  }
  try {
    // Ensure item exists
    const itemCheck = await pool.query('SELECT id FROM pricebook_items WHERE id = $1', [id]);
    if (itemCheck.rowCount === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    const result = await pool.query(
      'INSERT INTO pricebook_item_versions (item_id, effective_at, labour_rate, parts_cost, price_tier) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [id, effective_at, labour_rate, parts_cost, price_tier || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Pricing calculation endpoint
 */
app.post('/pricebook/calculate', authenticateToken, async (req, res) => {
  const { items, region, season } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  // Static markup factors; these could be moved to a config or database table in the future
  const markups = { good: 1.0, better: 1.15, best: 1.25 };
  try {
    let total = 0;
    const breakdown = [];
    for (const entry of items) {
      const { item_id, quantity, price_tier } = entry;
      if (!item_id || quantity == null) {
        return res.status(400).json({ error: 'Each item must include item_id and quantity' });
      }
      // Fetch base item info
      const itemRes = await pool.query('SELECT id, name, labour_rate, parts_cost, price_tier FROM pricebook_items WHERE id = $1', [item_id]);
      if (itemRes.rowCount === 0) {
        return res.status(400).json({ error: `Pricebook item ${item_id} not found` });
      }
      const pbItem = itemRes.rows[0];
      // Fetch latest version (if any) effective now
      const versionRes = await pool.query(
        'SELECT labour_rate, parts_cost, price_tier FROM pricebook_item_versions WHERE item_id = $1 AND effective_at <= NOW() ORDER BY effective_at DESC LIMIT 1',
        [item_id]
      );
      let labourRate = pbItem.labour_rate;
      let partsCost = pbItem.parts_cost;
      let defaultTier = pbItem.price_tier;
      if (versionRes.rowCount > 0) {
        const version = versionRes.rows[0];
        labourRate = version.labour_rate;
        partsCost = version.parts_cost;
        defaultTier = version.price_tier || defaultTier;
      }
      const selectedTier = price_tier || defaultTier || 'good';
      const markupFactor = markups[selectedTier] || 1.0;
      const baseUnit = parseFloat(labourRate) + parseFloat(partsCost);
      const unitPrice = baseUnit * markupFactor;
      const lineTotal = unitPrice * quantity;
      total += lineTotal;
      breakdown.push({
        item_id,
        name: pbItem.name,
        quantity,
        unit_price: unitPrice,
        markup_factor: markupFactor,
        total_price: lineTotal,
      });
    }
    res.json({ total_amount: total, items: breakdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Job Routes
 */

// Get all jobs (optional filter by status, customer_id or technician_id)
app.get('/jobs', authenticateToken, async (req, res) => {
  const { status, customer_id, technician_id } = req.query;
  try {
    let query = 'SELECT * FROM jobs';
    const conditions = [];
    const values = [];
    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (customer_id) {
      values.push(customer_id);
      conditions.push(`customer_id = $${values.length}`);
    }
    if (technician_id) {
      values.push(technician_id);
      conditions.push(`technician_id = $${values.length}`);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY id';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new job
app.post('/jobs', authenticateToken, async (req, res) => {
  const { customer_id, technician_id, status, scheduled_time, notes } = req.body;
  if (!customer_id || !status) {
    return res.status(400).json({ error: 'customer_id and status are required' });
  }
  const validStatuses = ['scheduled', 'in_progress', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO jobs (customer_id, technician_id, status, scheduled_time, notes) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [customer_id, technician_id || null, status, scheduled_time || null, notes || null]
    );
    res.status(201).json(result.rows[0]);

    // Broadcast new job to WebSocket clients
    broadcast({ type: 'job.created', job: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a job by ID
app.get('/jobs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a job by ID
app.put('/jobs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { customer_id, technician_id, status, scheduled_time, start_time, end_time, notes } = req.body;
  try {
    // Fetch existing job to compare status for service history
    const existingJob = await pool.query('SELECT id, customer_id, status FROM jobs WHERE id = $1', [id]);
    if (existingJob.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const prevStatus = existingJob.rows[0].status;

    const result = await pool.query(
      `UPDATE jobs SET 
        customer_id = COALESCE($1, customer_id),
        technician_id = COALESCE($2, technician_id),
        status = COALESCE($3, status),
        scheduled_time = COALESCE($4, scheduled_time),
        start_time = COALESCE($5, start_time),
        end_time = COALESCE($6, end_time),
        notes = COALESCE($7, notes),
        updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [customer_id, technician_id, status, scheduled_time, start_time, end_time, notes, id]
    );

    const updatedJob = result.rows[0];

    // If job status changed to completed and was not previously completed, record service history
    if (status && status === 'completed' && prevStatus !== 'completed') {
      try {
        // Check if a service history record already exists for this job
        const existingHistory = await pool.query('SELECT id FROM service_history WHERE job_id = $1', [id]);
        if (existingHistory.rowCount === 0) {
          await pool.query(
            'INSERT INTO service_history (job_id, customer_id, performed_at, notes) VALUES ($1, $2, NOW(), $3)',
            [id, updatedJob.customer_id, notes || null]
          );
        }
      } catch (historyErr) {
        console.error('Failed to record service history:', historyErr);
      }
    }

    res.json(updatedJob);

    // Broadcast job update to WebSocket clients
    broadcast({ type: 'job.updated', job: updatedJob });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Service History Routes
 */

// Get service history entries (optional filter by customer_id or job_id)
app.get('/service_history', authenticateToken, async (req, res) => {
  const { customer_id, job_id } = req.query;
  try {
    let query = 'SELECT * FROM service_history';
    const conditions = [];
    const values = [];
    if (customer_id) {
      values.push(customer_id);
      conditions.push(`customer_id = $${values.length}`);
    }
    if (job_id) {
      values.push(job_id);
      conditions.push(`job_id = $${values.length}`);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY performed_at DESC';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a service history entry manually
app.post('/service_history', authenticateToken, async (req, res) => {
  const { job_id, customer_id, performed_at, notes } = req.body;
  if (!job_id || !customer_id || !performed_at) {
    return res.status(400).json({ error: 'job_id, customer_id and performed_at are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO service_history (job_id, customer_id, performed_at, notes) VALUES ($1, $2, $3, $4) RETURNING *',
      [job_id, customer_id, performed_at, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a job by ID
app.delete('/jobs/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM jobs WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Estimate a job total based on selected pricebook items
app.post('/jobs/:id/estimate', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { items } = req.body; // items: [{ item_id, quantity }]
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items array is required' });
  }
  try {
    // Verify job exists
    const jobRes = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    let total = 0;
    const breakdown = [];
    for (const item of items) {
      const { item_id, quantity } = item;
      if (!item_id || quantity == null) {
        return res.status(400).json({ error: 'Each item must include item_id and quantity' });
      }
      const itemRes = await pool.query('SELECT id, name, labour_rate, parts_cost FROM pricebook_items WHERE id = $1', [item_id]);
      if (itemRes.rowCount === 0) {
        return res.status(400).json({ error: `Pricebook item ${item_id} not found` });
      }
      const pbItem = itemRes.rows[0];
      const unitPrice = parseFloat(pbItem.labour_rate) + parseFloat(pbItem.parts_cost);
      const lineTotal = unitPrice * quantity;
      total += lineTotal;
      breakdown.push({ item_id, name: pbItem.name, quantity, unit_price: unitPrice, total_price: lineTotal });
    }
    res.json({ job_id: id, total_amount: total, items: breakdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create an invoice for a job
app.post('/jobs/:id/invoice', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { amount, status, due_at } = req.body;
  if (amount == null) {
    return res.status(400).json({ error: 'amount is required' });
  }
  const invoiceStatus = status || 'draft';
  const validStatuses = ['draft','sent','paid','overdue','cancelled'];
  if (!validStatuses.includes(invoiceStatus)) {
    return res.status(400).json({ error: 'Invalid invoice status' });
  }
  try {
    // verify job exists
    const jobRes = await pool.query('SELECT id FROM jobs WHERE id = $1', [id]);
    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const result = await pool.query('INSERT INTO invoices (job_id, amount, status, due_at) VALUES ($1,$2,$3,$4) RETURNING *', [id, amount, invoiceStatus, due_at || null]);
    const invoice = result.rows[0];
    res.status(201).json(invoice);

    // Broadcast invoice creation
    broadcast({ type: 'invoice.created', invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Invoice Routes
 */

// Get all invoices (optional filter by status or job_id)
app.get('/invoices', authenticateToken, async (req, res) => {
  const { status, job_id } = req.query;
  try {
    let query = 'SELECT * FROM invoices';
    const conditions = [];
    const values = [];
    if (status) {
      values.push(status);
      conditions.push(`status = $${values.length}`);
    }
    if (job_id) {
      values.push(job_id);
      conditions.push(`job_id = $${values.length}`);
    }
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY id';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new invoice
app.post('/invoices', authenticateToken, async (req, res) => {
  const { job_id, amount, status, due_at } = req.body;
  if (!job_id || amount == null || !status) {
    return res.status(400).json({ error: 'job_id, amount and status are required' });
  }
  const validStatuses = ['draft','sent','paid','overdue','cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO invoices (job_id, amount, status, due_at) VALUES ($1,$2,$3,$4) RETURNING *',
      [job_id, amount, status, due_at || null]
    );
    const invoice = result.rows[0];
    res.status(201).json(invoice);

    // Broadcast invoice creation
    broadcast({ type: 'invoice.created', invoice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get an invoice by ID
app.get('/invoices/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM invoices WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update an invoice by ID
app.put('/invoices/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { job_id, amount, status, due_at } = req.body;
  try {
    const result = await pool.query(
      'UPDATE invoices SET job_id = COALESCE($1, job_id), amount = COALESCE($2, amount), status = COALESCE($3, status), due_at = COALESCE($4, due_at), updated_at = NOW() WHERE id = $5 RETURNING *',
      [job_id, amount, status, due_at, id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Payment Routes
 */

// Get all payments (optional filter by invoice_id)
app.get('/payments', authenticateToken, async (req, res) => {
  const { invoice_id } = req.query;
  try {
    let query = 'SELECT * FROM payments';
    const values = [];
    if (invoice_id) {
      query += ' WHERE invoice_id = $1';
      values.push(invoice_id);
    }
    query += ' ORDER BY id';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new payment
app.post('/payments', authenticateToken, async (req, res) => {
  const { invoice_id, amount, method } = req.body;
  if (!invoice_id || amount == null || !method) {
    return res.status(400).json({ error: 'invoice_id, amount and method are required' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO payments (invoice_id, amount, method) VALUES ($1,$2,$3) RETURNING *',
      [invoice_id, amount, method]
    );
    const payment = result.rows[0];
    res.status(201).json(payment);

    // Broadcast payment creation
    broadcast({ type: 'payment.created', payment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a payment by ID
app.get('/payments/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * User management routes (admin only)
 */

// Get all users (admin only)
app.get('/users', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, role, created_at, updated_at FROM users ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a user by ID (admin only)
app.get('/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT id, email, role, created_at, updated_at FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a user's role (admin only)
app.put('/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;
  if (!role || !['admin','manager','technician'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const result = await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, role', [role, id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a user (admin only)
app.delete('/users/:id', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Customer communications and lifecycle routes
 */

// Get all communications for a specific customer
app.get('/customers/:customerId/communications', authenticateToken, async (req, res) => {
  const { customerId } = req.params;
  try {
    // Verify customer exists
    const custRes = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (custRes.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const comms = await pool.query(
      'SELECT * FROM customer_communications WHERE customer_id = $1 ORDER BY created_at DESC',
      [customerId]
    );
    res.json(comms.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a communication record for a customer
app.post('/customers/:customerId/communications', authenticateToken, async (req, res) => {
  const { customerId } = req.params;
  const { type, channel, subject, body } = req.body;
  if (!type) {
    return res.status(400).json({ error: 'type is required' });
  }
  try {
    // Verify customer exists
    const custRes = await pool.query('SELECT id FROM customers WHERE id = $1', [customerId]);
    if (custRes.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const commRes = await pool.query(
      'INSERT INTO customer_communications (customer_id, type, channel, subject, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [customerId, type, channel || null, subject || null, body || null]
    );
    res.status(201).json(commRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update the lifecycle stage of a customer
app.put('/customers/:customerId/lifecycle', authenticateToken, async (req, res) => {
  const { customerId } = req.params;
  const { lifecycle_stage } = req.body;
  const validStages = ['prospect', 'lead', 'customer', 'loyal_customer'];
  if (!lifecycle_stage || !validStages.includes(lifecycle_stage)) {
    return res.status(400).json({ error: 'Invalid lifecycle_stage' });
  }
  try {
    const result = await pool.query(
      'UPDATE customers SET lifecycle_stage = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [lifecycle_stage, customerId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Reminder routes
 */

// Get reminders, optionally filtered by sent status
app.get('/reminders', authenticateToken, async (req, res) => {
  const { sent } = req.query;
  try {
    let query = 'SELECT * FROM reminders';
    const values = [];
    if (sent !== undefined) {
      // Convert sent parameter to boolean (strings 'true'/'false')
      const sentBool = sent === true || sent === 'true';
      values.push(sentBool);
      query += ' WHERE sent = $1';
    }
    query += ' ORDER BY remind_at ASC';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new reminder
app.post('/reminders', authenticateToken, async (req, res) => {
  const { customer_id, job_id, remind_at, method } = req.body;
  if (!remind_at || !method) {
    return res.status(400).json({ error: 'remind_at and method are required' });
  }
  const allowedMethods = ['email', 'sms'];
  if (!allowedMethods.includes(method)) {
    return res.status(400).json({ error: 'Invalid method' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO reminders (customer_id, job_id, remind_at, method) VALUES ($1,$2,$3,$4) RETURNING *',
      [customer_id || null, job_id || null, remind_at, method]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/*
 * Job signature routes
 */

// Upload a signature for a job
app.post('/jobs/:jobId/signature', authenticateToken, async (req, res) => {
  const { jobId } = req.params;
  const { data } = req.body;
  if (!data) {
    return res.status(400).json({ error: 'data is required' });
  }
  try {
    // Verify job exists
    const jobRes = await pool.query('SELECT id FROM jobs WHERE id = $1', [jobId]);
    if (jobRes.rowCount === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const result = await pool.query(
      'INSERT INTO job_signatures (job_id, data) VALUES ($1, $2) RETURNING *',
      [jobId, data]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get the most recent signature for a job
app.get('/jobs/:jobId/signature', authenticateToken, async (req, res) => {
  const { jobId } = req.params;
  try {
    const result = await pool.query(
      'SELECT * FROM job_signatures WHERE job_id = $1 ORDER BY created_at DESC LIMIT 1',
      [jobId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Signature not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Initialise WebSocket server
wss = new WebSocket.Server({ server });
wss.on('connection', (socket) => {
  // Optional: send a welcome message
  socket.send(JSON.stringify({ type: 'welcome', message: 'Connected to ServiceBook real‑time updates' }));
});

server.listen(port, () => {
  console.log(`HTTP/WebSocket server listening on port ${port}`);
});

// Export server for testing purposes
module.exports = server;
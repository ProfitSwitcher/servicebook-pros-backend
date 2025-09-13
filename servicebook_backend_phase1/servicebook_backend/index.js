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
app.post('/auth/register', async (req, res) => {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  const userRole = role || 'manager';
  if (!['admin','manager','technician'].includes(userRole)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    // Check if email already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }
    const passwordHash = hashPassword(password);
    const insert = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1,$2,$3) RETURNING id, email, role',
      [email, passwordHash, userRole]
    );
    const user = insert.rows[0];
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.status(201).json({ token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route: Login
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  try {
    const result = await pool.query('SELECT id, email, role, password_hash FROM users WHERE email = $1', [email]);
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const user = result.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
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
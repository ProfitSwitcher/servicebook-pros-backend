-- SQL schema for ServiceBook Pros backend (Phase 1)
--
-- This schema uses PostgreSQL syntax and defines the core tables and relationships
-- required to implement customers, jobs, pricing, invoices and payments.

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(50)  NOT NULL CHECK (role IN ('admin','manager','technician')),
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    email       VARCHAR(255),
    phone       VARCHAR(50),
    address     TEXT,
    city        VARCHAR(100),
    state       VARCHAR(100),
    postal_code VARCHAR(20),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Price‑book category table (hierarchical)
CREATE TABLE IF NOT EXISTS pricebook_categories (
    id        SERIAL PRIMARY KEY,
    name      VARCHAR(255) NOT NULL,
    parent_id INTEGER REFERENCES pricebook_categories(id) ON DELETE CASCADE
);

-- Price‑book items table
CREATE TABLE IF NOT EXISTS pricebook_items (
    id               SERIAL PRIMARY KEY,
    category_id      INTEGER NOT NULL REFERENCES pricebook_categories(id),
    name             VARCHAR(255) NOT NULL,
    description      TEXT,
    labour_rate      NUMERIC(10,2) NOT NULL,
    parts_cost       NUMERIC(10,2) NOT NULL,
    price_tier       VARCHAR(20) CHECK (price_tier IN ('good','better','best')),
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id               SERIAL PRIMARY KEY,
    customer_id      INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    technician_id    INTEGER REFERENCES users(id),
    status           VARCHAR(50) NOT NULL CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    scheduled_time   TIMESTAMP,
    start_time       TIMESTAMP,
    end_time         TIMESTAMP,
    notes            TEXT,
    created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Service history (mapping between jobs and customers)
CREATE TABLE IF NOT EXISTS service_history (
    id         SERIAL PRIMARY KEY,
    job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    performed_at TIMESTAMP NOT NULL,
    notes        TEXT
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
    id          SERIAL PRIMARY KEY,
    job_id      INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    amount      NUMERIC(12,2) NOT NULL,
    status      VARCHAR(50) NOT NULL CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
    issued_at   TIMESTAMP NOT NULL DEFAULT NOW(),
    due_at      TIMESTAMP,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
    id           SERIAL PRIMARY KEY,
    invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    amount       NUMERIC(12,2) NOT NULL,
    method       VARCHAR(50) NOT NULL,
    paid_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
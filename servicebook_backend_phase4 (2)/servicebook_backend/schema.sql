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
    mfa_secret    VARCHAR(255), -- Optional secret for TOTP multi-factor authentication
    mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
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
    lifecycle_stage VARCHAR(50) NOT NULL DEFAULT 'customer', -- prospect, lead, customer, loyal_customer
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

-- Price‑book item version history
-- Each row represents a historical or future price definition for a pricebook item.
-- When calculating current pricing, select the version with the highest effective_at that is <= NOW().
-- If no version exists, fall back to the base pricebook_items record.
CREATE TABLE IF NOT EXISTS pricebook_item_versions (
    id          SERIAL PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES pricebook_items(id) ON DELETE CASCADE,
    effective_at TIMESTAMP NOT NULL,
    labour_rate NUMERIC(10,2) NOT NULL,
    parts_cost  NUMERIC(10,2) NOT NULL,
    price_tier  VARCHAR(20) CHECK (price_tier IN ('good','better','best')),
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
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

-- Customer communications log (emails, calls, sms, notes)
CREATE TABLE IF NOT EXISTS customer_communications (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    type        VARCHAR(50) NOT NULL, -- e.g., email, sms, phone, note
    channel     VARCHAR(50),         -- e.g., Gmail, Twilio
    subject     VARCHAR(255),
    body        TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Reminder triggers for appointments or follow‑ups
CREATE TABLE IF NOT EXISTS reminders (
    id         SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
    job_id     INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
    remind_at  TIMESTAMP NOT NULL,
    method     VARCHAR(20) NOT NULL CHECK (method IN ('email','sms')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    sent       BOOLEAN NOT NULL DEFAULT FALSE
);

-- Signatures captured for jobs
CREATE TABLE IF NOT EXISTS job_signatures (
    id      SERIAL PRIMARY KEY,
    job_id  INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    data    TEXT NOT NULL, -- Base64 encoded signature image
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
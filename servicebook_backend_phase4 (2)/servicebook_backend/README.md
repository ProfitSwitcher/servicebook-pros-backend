# ServiceBook Pros Backend Overview

This directory contains planning artifacts and skeleton code for the **ServiceBook Pros** backend.  It covers Phase 1 tasks, focusing on foundational infrastructure, data modelling, API design, authentication/authorization and real‑time communication.

## Data Model

The core entities of the platform are represented in the SQL schema (`schema.sql`).  Major tables include:

- `users` – Application users (admins, managers and technicians) with role‑based permissions.
  The user table now includes optional `mfa_secret` and `mfa_enabled` columns to support time‑based one‑time password (TOTP) multi‑factor authentication.
- `customers` – Customer records with basic contact information and associated service history.
- `jobs` – Service jobs linked to customers and technicians.  Includes scheduling metadata and status.
- `pricebook_categories` – Hierarchical categories for price‑book items (supporting arbitrary depth via `parent_id`).
- `pricebook_items` – Individual flat‑rate pricing entries with names, descriptions, labour rates, parts costs and optional Good/Better/Best tiers.
- `invoices` – Billing records linked to jobs with amounts and payment status.
- `payments` – Payment transactions associated with invoices.
- `service_history` – Records of past services performed for each customer and job.

  Each record notes when a job was completed for a particular customer.
 - `pricebook_item_versions` – Version history for price‑book items, allowing historical and future labour and parts rates (used by the pricing engine).
 - `customer_communications` – Log of all interactions with customers (emails, SMS, phone calls and internal notes).
 - `reminders` – Future triggers for appointments or follow‑ups.  Each entry specifies a customer or job, a time to remind and the delivery method (email or SMS).
 - `job_signatures` – Captures digital signatures for completed jobs as base‑64 encoded images.

Refer to `schema.sql` for table definitions, constraints and relationships.  A notable addition is the `service_history` table, which records completed jobs for each customer and is automatically populated whenever a job status transitions to **completed**.

## API Design

The OpenAPI specification (`api_spec.yaml`) outlines REST endpoints for interacting with the system.  High‑level resources include:

- **Authentication** – `POST /auth/login` and `POST /auth/register` for credential management.
- **Users** – `GET /users/{id}` and related endpoints for user administration.
- **Customers** – CRUD operations at `/customers` and `/customers/{id}`.
- **Jobs** – CRUD operations at `/jobs` and `/jobs/{id}`, plus endpoints for status updates and scheduling.
- **Price‑book** – Manage categories at `/pricebook/categories` and items at `/pricebook/items` with filter and search capabilities.
 - **Invoices & Payments** – Create and retrieve invoices (`/invoices`) and process payments (`/payments`).
 - **Customer communications & lifecycle** – Log communications at `/customers/{id}/communications` (GET/POST) and update a customer's lifecycle stage at `/customers/{id}/lifecycle` (PUT).
 - **Reminders** – Manage follow‑up reminders at `/reminders` (GET/POST).  Reminders are stored in the database for external schedulers to trigger notifications.
 - **Job signatures** – Upload and retrieve digital signatures for jobs via `/jobs/{id}/signature` (POST/GET).

 - **Analytics** – Retrieve aggregated metrics via `/analytics/summary`, customer‑specific analytics via `/analytics/customer/{id}` and revenue predictions via `/analytics/predict`.  These endpoints lay the groundwork for Phase 4 AI and analytics features.

Authentication is based on JSON Web Tokens (JWT) with role‑based access control enforced at each endpoint.  Real‑time updates (e.g., job status changes, invoice or payment creation) are delivered via a built‑in WebSocket server.  Clients can connect to the server on the same port and listen for event messages describing changes in the system.

### Multi‑factor authentication (MFA)

Users can optionally enable MFA for added security.  After logging in, an authenticated user can call `POST /auth/setup-mfa` to generate a TOTP secret and receive an `otpauth://` URL.  The user scans this URL using an authenticator app (e.g., Google Authenticator, Authy).  To activate MFA, the user then calls `POST /auth/verify-mfa` with a valid one‑time code; upon success, `mfa_enabled` is set to `true` in the database.  Subsequent logins require an `mfa_code` field in the request body.  Invalid or missing codes result in a `401` error.

### Security hardening

The Express application now uses [Helmet](https://www.npmjs.com/package/helmet) to set secure HTTP headers and `express-rate-limit` to limit repeated requests (100 requests per 15‑minute window per IP) to mitigate brute‑force attacks.  Logging is performed via the `morgan` middleware and the `winston` logger, providing structured request logs.

## Skeleton Server

The `index.js` file provides a basic Express server with placeholder routes and middleware for JWT authentication.  The skeleton demonstrates how to structure route handlers and secure endpoints.  It includes:

- Express app setup with JSON parsing and CORS support.
- Connection to a Postgres database (via `pg` library) using environment variables (see `.env.example`).
- Middleware for verifying JWTs and enforcing roles.
- Sample route definitions for customer CRUD operations.

This skeleton is intended as a starting point; developers should implement full business logic, validation and error handling.

### Environment configuration

Environment variables drive the database connection, JWT secret and other configuration.  A template `.env.example` file is provided.  Copy it to `.env` and fill in your actual values:

```bash
cp servicebook_backend/.env.example servicebook_backend/.env
```

Then edit `.env` to provide your PostgreSQL credentials and JWT secret.  When running locally, the server will load these values automatically (via `dotenv`).  In production, set the variables directly in your deployment environment.

### Importing the price book

The `scripts/import_pricebook.js` script reads the `Copy of all_services.csv` file (provided in the project root) and populates the `pricebook_categories` and `pricebook_items` tables.  It derives category hierarchies from the `Category4`, `Category5` and `Category6` columns and creates items with a default labour rate of 0 and parts cost equal to the price column.  Adjust this logic to fit your pricing model.

To run the import:

```bash
node servicebook_backend/scripts/import_pricebook.js "Copy of all_services.csv"
```

Ensure your `.env` is configured with valid database credentials before running the script.

## Next Steps

1. **Test the pricing engine** – Validate the `/pricebook/calculate` endpoint against a variety of scenarios and adjust markup factors or version lookups as needed.  Consider adding region‑ or season‑specific adjustments via configuration tables.
2. **Build CRM features** – With communications, lifecycle stages, reminders and signatures now supported by the backend, implement front‑end components to log customer interactions, update lifecycle stages, schedule reminders and capture digital signatures.
3. **Set up migrations** – Use a migration tool (e.g., Knex, Sequelize or node‑pg‑migrate) to manage database schema evolution.  This ensures changes like new tables or columns can be versioned and deployed smoothly.
4. **Integrate real‑time** – The backend uses the `ws` library for live updates.  To scale horizontally, integrate a message broker (e.g., Redis) so that events are broadcast across multiple instances.
5. **Expand security** – MFA is implemented via TOTP; consider adding password reset flows, session invalidation and integration with external identity providers (OAuth/OIDC) in future phases.
6. **Plan mobile and CRM extensions** – Future phases will include a mobile sales tool and enhanced CRM functionality.  Design mobile‑friendly APIs and offline capabilities, and integrate the CRM data (customer lifecycle, communications and reminders) into a dedicated mobile experience.

7. **Develop analytics and AI features** – The new analytics endpoints (`/analytics/summary`, `/analytics/customer/{id}` and `/analytics/predict`) provide a foundation for business insights.  Build dashboards in the front‑end to visualise these metrics and start experimenting with predictive models.  Over time, collect sufficient historical data and train machine learning algorithms to forecast revenue, identify high‑value customers, predict churn and recommend services.

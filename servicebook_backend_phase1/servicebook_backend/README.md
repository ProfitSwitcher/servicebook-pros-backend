# ServiceBook Pros Backend Overview

This directory contains planning artifacts and skeleton code for the **ServiceBook Pros** backend.  It covers Phase 1 tasks, focusing on foundational infrastructure, data modelling, API design, authentication/authorization and real‑time communication.

## Data Model

The core entities of the platform are represented in the SQL schema (`schema.sql`).  Major tables include:

- `users` – Application users (admins, managers and technicians) with role‑based permissions.
- `customers` – Customer records with basic contact information and associated service history.
- `jobs` – Service jobs linked to customers and technicians.  Includes scheduling metadata and status.
- `pricebook_categories` – Hierarchical categories for price‑book items (supporting arbitrary depth via `parent_id`).
- `pricebook_items` – Individual flat‑rate pricing entries with names, descriptions, labour rates, parts costs and optional Good/Better/Best tiers.
- `invoices` – Billing records linked to jobs with amounts and payment status.
- `payments` – Payment transactions associated with invoices.
- `service_history` – Records of past services performed for each customer and job.

Refer to `schema.sql` for table definitions, constraints and relationships.  A notable addition is the `service_history` table, which records completed jobs for each customer and is automatically populated whenever a job status transitions to **completed**.

## API Design

The OpenAPI specification (`api_spec.yaml`) outlines REST endpoints for interacting with the system.  High‑level resources include:

- **Authentication** – `POST /auth/login` and `POST /auth/register` for credential management.
- **Users** – `GET /users/{id}` and related endpoints for user administration.
- **Customers** – CRUD operations at `/customers` and `/customers/{id}`.
- **Jobs** – CRUD operations at `/jobs` and `/jobs/{id}`, plus endpoints for status updates and scheduling.
- **Price‑book** – Manage categories at `/pricebook/categories` and items at `/pricebook/items` with filter and search capabilities.
- **Invoices & Payments** – Create and retrieve invoices (`/invoices`) and process payments (`/payments`).

Authentication is based on JSON Web Tokens (JWT) with role‑based access control enforced at each endpoint.  Real‑time updates (e.g., job status changes, invoice or payment creation) are delivered via a built‑in WebSocket server.  Clients can connect to the server on the same port and listen for event messages describing changes in the system.

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

1. **Implement business logic** – Flesh out the controllers for each endpoint defined in `api_spec.yaml`.
2. **Set up migrations** – Use a migration tool (e.g., Knex, Sequelize, Alembic) to manage database schema evolution.
3. **Integrate real‑time** – Add WebSocket support for live updates using Socket.io or native WebSocket libraries.
4. **Expand security** – Implement MFA, password reset flows and integrate with external identity providers as needed.

# ServiceBook Pros DevOps Guidelines

This document outlines a suggested DevOps pipeline and deployment strategy for the ServiceBook Pros backend.  It is meant to help teams unfamiliar with infrastructure and operational practices get the project running in a production environment.

## Version Control & Repository Structure

1. **Git**: Store all backend code under version control.  Use feature branches and pull requests for changes.
2. **Branching strategy**: Adopt a simple model such as trunk‑based development or Git flow.  Protect the `main` branch with required code review and passing tests.
3. **Secrets management**: Never commit `.env` files or secrets to the repository.  Use environment variables or secret managers (e.g., GitHub Secrets, AWS Secrets Manager) to store sensitive information like database passwords and JWT secrets.

## Continuous Integration (CI)

Use a CI service like **GitHub Actions** to automatically test and lint code on every pull request:

1. **Install dependencies**: Set up Node.js and Postgres services.  Cache `node_modules` for faster builds.
2. **Run linters**: Execute ESLint or other static analysis tools to catch syntax and style issues.
3. **Run unit tests**: Use a testing framework (e.g., Jest) to verify the behaviour of controllers and helpers.  Include test scripts under a `test/` directory.
4. **Database migrations**: Apply migration scripts before running tests to ensure the schema is up to date.
5. **Report coverage**: Optionally integrate code coverage to monitor test effectiveness.

Here is a simplified `.github/workflows/ci.yml` example:

```yaml
name: CI
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: servicebook_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd='pg_isready' --health-interval=10s --health-timeout=5s --health-retries=5
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
        env:
          DB_HOST: localhost
          DB_PORT: 5432
          DB_USER: postgres
          DB_PASSWORD: postgres
          DB_NAME: servicebook_test
          JWT_SECRET: testsecret
```

## Continuous Deployment (CD)

For deployment, choose a platform that supports Node.js and Postgres.  Options include **Heroku**, **Railway**, **Render** or **AWS Elastic Beanstalk**.  A typical deployment flow looks like:

1. **Build**: On each merge to `main`, run the CI workflow.  If tests pass, build the application (e.g., compile TypeScript if used).
2. **Push image or code**: Deploy the build artifact to the target environment.  For container‑based platforms, build a Docker image and push it to a registry.  For Heroku‑style platforms, push the source code.
3. **Provision database**: Use a managed Postgres instance.  Apply migrations on deployment (e.g., via a post‑deploy script) to ensure the schema is current.
4. **Set environment variables**: Configure the app with production secrets (DB credentials, JWT secret, etc.).
5. **Monitor health**: Set up monitoring and alerting (e.g., UptimeRobot, New Relic) to track uptime and error rates.  Use structured logging (e.g., Winston) and aggregation services like Loggly or Datadog.

## Local Development Environment

Developers can run the backend locally using Node.js and Postgres.  A typical setup would be:

```bash
# Start Postgres (via Docker) and create a database
docker run --name sbp-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=servicebook_dev -p 5432:5432 -d postgres:15

# Copy environment template and configure
cp servicebook_backend/.env.example servicebook_backend/.env
vim servicebook_backend/.env  # Update DB_* and JWT_SECRET values

# Install dependencies and run the server
npm install
node servicebook_backend/index.js
```

Use a tool like **nodemon** to automatically restart the server on file changes during development.

## Testing & Code Quality

1. **Unit tests**: Write tests for each route/controller.  Mock database calls where possible.
2. **Integration tests**: Spin up a test database and test the full API end to end.  Use a separate database to avoid contaminating development data.
3. **Static analysis**: Run linters and security scanners (e.g., `npm audit`) regularly.
4. **Continuous feedback**: Integrate CI status checks into pull requests so issues are caught early.

## Security Best Practices

* **HTTPS**: Terminate SSL at a load balancer or reverse proxy.
* **Password hashing**: Use strong hashing algorithms (PBKDF2, bcrypt) with a unique salt per user.  This is implemented in the current server.
* **JWT secrets**: Use long, random strings for signing tokens.  Rotate secrets periodically.
* **CORS**: Restrict allowed origins to your front‑end domain.
* **Rate limiting**: Apply rate limits on authentication endpoints to mitigate brute‑force attacks.
* **Input validation**: Validate and sanitise all request data to prevent SQL injection and XSS.
* **Least privilege**: Restrict database and application permissions to only what is necessary.

## Migration Management

Although this repository contains a `schema.sql` file, consider using a migration tool (e.g., Knex, Sequelize or node‑pg‑migrate) to apply changes incrementally.  Migrations make it easy to evolve the schema over time while keeping environments in sync.

## Real‑time Communication

The backend includes a built‑in WebSocket server using the lightweight `ws` library.  The WebSocket server is attached to the same HTTP port as Express, so no additional port is required.  Whenever a job is created or updated, an invoice is generated, or a payment is recorded, the server broadcasts an event to all connected clients.  Each event has a `type` (e.g., `job.created`, `job.updated`, `invoice.created`, `payment.created`) and a payload containing the updated entity.

To consume these updates on the client side:

```js
// Example: connect to the WebSocket endpoint
const socket = new WebSocket('ws://localhost:3000');
socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  switch (data.type) {
    case 'job.created':
      // handle new job
      break;
    case 'job.updated':
      // handle job update
      break;
    // ... handle other event types ...
  }
});
```

Note that the WebSocket server is initialised only when the Node app starts; there is no need to install Socket.IO unless you require its additional features.

---

These guidelines provide a starting point for deploying and operating the ServiceBook Pros backend.  Adjust the details to match your team's tools and infrastructure.
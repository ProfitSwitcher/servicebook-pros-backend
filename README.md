# ServiceBook Pros Backend - Railway Deployment

This repository contains the ServiceBook Pros backend API, configured for deployment on Railway.

## Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/ProfitSwitcher/servicebook-pros-backend)

## Manual Deployment Steps

1. **Fork or clone this repository**

2. **Create a new Railway project**
   - Visit [Railway](https://railway.app)
   - Click "New Project"
   - Choose "Deploy from GitHub repo"
   - Select this repository

3. **Add a PostgreSQL database**
   - In your Railway project dashboard
   - Click "New Service"
   - Choose "PostgreSQL"
   - Railway will automatically provide the `DATABASE_URL` environment variable

4. **Configure environment variables**
   - Go to your project's Variables tab
   - Add the following required variables:
     ```
     JWT_SECRET=your-super-secure-random-jwt-secret-here
     ```
   - Optional variables (Railway provides defaults):
     ```
     NODE_ENV=production
     PORT=3000
     ```

5. **Deploy**
   - Railway will automatically detect the Node.js application
   - It will use the `start.sh` script to build and start the application
   - The app will be available at your Railway-provided URL

## Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/ProfitSwitcher/servicebook-pros-backend.git
   cd servicebook-pros-backend
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your local database credentials
   ```

3. **Start the development server**
   ```bash
   npm start
   ```

## Project Structure

This repository contains multiple phases of the ServiceBook Pros backend development:

- `servicebook_backend/` - Basic backend (Phase 1)
- `servicebook_backend_phase2 (1)/` - Enhanced features (Phase 2)
- `servicebook_backend_phase4 (2)/` - **Production version** with full features (Phase 4)

The deployment is configured to use **Phase 4** as it includes the most comprehensive feature set including:
- Advanced security (Helmet, rate limiting)
- Logging and monitoring (Winston, Morgan)
- Multi-factor authentication
- Analytics and reporting
- Customer communications
- Digital signatures
- Real-time WebSocket updates

## API Documentation

The API specification is available in `servicebook_backend_phase4 (2)/servicebook_backend/api_spec.yaml`

## Database Setup

The application includes database schema and migration scripts:
- Schema: `servicebook_backend_phase4 (2)/servicebook_backend/schema.sql`
- Import script: `servicebook_backend_phase4 (2)/servicebook_backend/scripts/import_pricebook.js`

## Support

For deployment issues or questions, please create an issue in this repository.
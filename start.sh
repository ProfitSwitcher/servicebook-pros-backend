#!/bin/bash

# ServiceBook Pros Backend Startup Script for Railway
# This script navigates to the Phase 4 backend and starts the application

set -e

echo "Starting ServiceBook Pros Backend (Phase 4)..."

# Navigate to the Phase 4 backend directory
cd "servicebook_backend_phase4 (2)/servicebook_backend"

# Install dependencies if node_modules doesn't exist or package.json is newer
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the application
echo "Starting the server..."
exec node index.js
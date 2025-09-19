# Use the official Node.js runtime as the base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy the entire project
COPY . .

# Install dependencies for the Phase 4 backend
WORKDIR /app/servicebook_backend_phase4 (2)/servicebook_backend
RUN npm install --production

# Expose the port the app runs on
EXPOSE 3000

# Define environment variable defaults
ENV NODE_ENV=production
ENV PORT=3000

# Create a non-root user to run the application
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001
USER nextjs

# Command to run the application
CMD ["node", "index.js"]
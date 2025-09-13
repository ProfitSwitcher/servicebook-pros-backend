# ServiceBook Pros PWA (Phase 3 Prototype)

This folder contains a minimal Progressive Web App (PWA) designed to interact with the ServiceBook Pros backend API.  It demonstrates basic mobile‑friendly features such as offline caching, installability and a simple UI for authenticating and viewing jobs.  You can build upon this prototype to create a richer mobile sales tool in future phases.

## Features

* **Login** – Enter your email and password to obtain a JWT token from the backend.
* **Job list** – After logging in, the app fetches jobs from the API and displays them.  You can refresh the list with a button.
* **Offline support** – A service worker caches static assets and API responses.  If the network is unavailable, the app will serve cached data.
* **Installable** – The `manifest.json` makes the app installable on mobile devices.  Add a shortcut to your home screen for quick access.

## Getting Started

1. **Configure the API URL**

   By default, the app points to `http://localhost:3000`.  If your backend runs on a different host or port, you can expose a global variable before including `main.js` in `index.html`:

   ```html
   <script>
     window.VITE_API_URL = 'https://your-api.example.com';
   </script>
   <script src="main.js"></script>
   ```

2. **Serve the PWA**

   The PWA must be served over HTTP/HTTPS to register the service worker.  From the project root, you can use a simple static file server (Python’s `http.server`, `npx serve`, etc.).  For example:

   ```bash
   cd servicebook_pwa
   npx serve .
   ```

   Then navigate to `http://localhost:5000` (or the port shown) in your browser.  Login with your API credentials.

3. **Install the App**

   On supported browsers (e.g., Chrome on Android), you’ll see an install prompt or an “Add to Home Screen” option.  This allows you to access the app like a native application.

## Extending the Prototype

This prototype focuses on authentication and listing jobs.  To build a full mobile sales tool, consider adding features such as:

* **Creating estimates and invoices** – Use the pricing engine and job endpoints to build quotes and invoices.
* **Signing work orders** – Integrate the signature endpoint to collect customer signatures.
* **Customer management** – Display customer details, communications and lifecycle stages.
* **Offline queue** – Queue up actions (e.g., new jobs, communications) while offline and sync when connectivity returns.

Feel free to adopt a framework like React or Vue if you prefer component‑based development.  This plain JavaScript example demonstrates the core mechanics without additional dependencies.
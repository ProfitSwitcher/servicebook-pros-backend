// Simple PWA client for ServiceBook Pros API

const API_URL = (typeof window !== 'undefined' && window.VITE_API_URL) || 'http://localhost:3000';

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('sw.js')
      .then(() => console.log('Service worker registered'))
      .catch((err) => console.error('Service worker registration failed', err));
  });
}

const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const authSection = document.getElementById('authSection');
const appSection = document.getElementById('app');
const jobListEl = document.getElementById('jobList');
const refreshJobsBtn = document.getElementById('refreshJobsBtn');

loginBtn.addEventListener('click', async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    alert('Please enter email and password');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Login failed');
    }
    const data = await res.json();
    localStorage.setItem('token', data.token);
    // Hide login, show app
    authSection.style.display = 'none';
    appSection.style.display = 'block';
    fetchJobs();
  } catch (err) {
    alert(err.message || 'Login failed');
  }
});

refreshJobsBtn.addEventListener('click', () => {
  fetchJobs();
});

async function fetchJobs() {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Not authenticated');
    return;
  }
  try {
    const res = await fetch(`${API_URL}/jobs`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Failed to fetch jobs');
    }
    const jobs = await res.json();
    jobListEl.innerHTML = '';
    jobs.forEach((job) => {
      const li = document.createElement('li');
      li.textContent = `${job.id}: Customer ${job.customer_id} – ${job.status}`;
      jobListEl.appendChild(li);
    });
  } catch (err) {
    console.error(err);
    alert('Failed to fetch jobs');
  }
}

// Auto log in if token exists
if (localStorage.getItem('token')) {
  authSection.style.display = 'none';
  appSection.style.display = 'block';
  fetchJobs();
}
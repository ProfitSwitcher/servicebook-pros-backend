/*
 * Front‑end API client for ServiceBook Pros
 *
 * This module provides convenience functions to call the back‑end API
 * endpoints defined in `api_spec.yaml`.  It automatically includes
 * the JWT token from localStorage (if present) and handles JSON
 * serialization.  Update the VITE_API_URL in your front‑end project
 * to point to the correct server.
 */

const API_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed: ${response.status} ${text}`);
  }
  // If no content (204) return null
  if (response.status === 204) return null;
  return response.json();
}

// Authentication
export async function login(email, password, mfa_code) {
  const body = { email, password };
  if (mfa_code) body.mfa_code = mfa_code;
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', data.token);
  }
  return data;
}

export async function register(email, password, role = 'manager') {
  const data = await request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, role }),
  });
  if (typeof window !== 'undefined') {
    localStorage.setItem('token', data.token);
  }
  return data;
}

// Users (admin)
export async function getUsers() {
  return request('/users');
}

export async function updateUserRole(userId, role) {
  return request(`/users/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ role }),
  });
}

export async function deleteUser(userId) {
  return request(`/users/${userId}`, { method: 'DELETE' });
}

// Customers
export async function getCustomers() {
  return request('/customers');
}

export async function createCustomer(customer) {
  return request('/customers', {
    method: 'POST',
    body: JSON.stringify(customer),
  });
}

export async function updateCustomer(id, customer) {
  return request(`/customers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(customer),
  });
}

export async function deleteCustomer(id) {
  return request(`/customers/${id}`, { method: 'DELETE' });
}

// Customer communications
export async function getCommunications(customerId) {
  return request(`/customers/${customerId}/communications`);
}

export async function addCommunication(customerId, communication) {
  return request(`/customers/${customerId}/communications`, {
    method: 'POST',
    body: JSON.stringify(communication),
  });
}

// Customer lifecycle stage
export async function updateLifecycle(customerId, lifecycle_stage) {
  return request(`/customers/${customerId}/lifecycle`, {
    method: 'PUT',
    body: JSON.stringify({ lifecycle_stage }),
  });
}

// Reminders
export async function getReminders(sent) {
  const query = sent === undefined ? '' : `?sent=${sent}`;
  return request(`/reminders${query}`);
}

export async function createReminder(reminder) {
  return request('/reminders', {
    method: 'POST',
    body: JSON.stringify(reminder),
  });
}

// Jobs
export async function getJobs(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.append('status', filters.status);
  if (filters.customer_id) params.append('customer_id', filters.customer_id);
  if (filters.technician_id) params.append('technician_id', filters.technician_id);
  const query = params.toString();
  return request(`/jobs${query ? '?' + query : ''}`);
}

export async function createJob(job) {
  return request('/jobs', {
    method: 'POST',
    body: JSON.stringify(job),
  });
}

export async function updateJob(jobId, job) {
  return request(`/jobs/${jobId}`, {
    method: 'PUT',
    body: JSON.stringify(job),
  });
}

export async function deleteJob(jobId) {
  return request(`/jobs/${jobId}`, { method: 'DELETE' });
}

// Estimates and invoices
export async function estimateJob(jobId, items) {
  return request(`/jobs/${jobId}/estimate`, {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function createInvoice(jobId, invoice) {
  return request(`/jobs/${jobId}/invoice`, {
    method: 'POST',
    body: JSON.stringify(invoice),
  });
}

// Job signatures
export async function uploadJobSignature(jobId, data) {
  return request(`/jobs/${jobId}/signature`, {
    method: 'POST',
    body: JSON.stringify({ data }),
  });
}

export async function getJobSignature(jobId) {
  return request(`/jobs/${jobId}/signature`);
}

// Pricebook
export async function getPricebookCategories(parentId) {
  const query = parentId ? `?parent_id=${parentId}` : '';
  return request(`/pricebook/categories${query}`);
}

export async function createPricebookCategory(category) {
  return request('/pricebook/categories', {
    method: 'POST',
    body: JSON.stringify(category),
  });
}

export async function getPricebookItems(filters = {}) {
  const params = new URLSearchParams();
  if (filters.category_id) params.append('category_id', filters.category_id);
  if (filters.price_tier) params.append('price_tier', filters.price_tier);
  const query = params.toString();
  return request(`/pricebook/items${query ? '?' + query : ''}`);
}

export async function createPricebookItem(item) {
  return request('/pricebook/items', {
    method: 'POST',
    body: JSON.stringify(item),
  });
}

export async function updatePricebookItem(itemId, item) {
  return request(`/pricebook/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify(item),
  });
}

export async function deletePricebookItem(itemId) {
  return request(`/pricebook/items/${itemId}`, { method: 'DELETE' });
}

// Pricebook versions
export async function getPricebookItemVersions(itemId) {
  return request(`/pricebook/items/${itemId}/versions`);
}

export async function createPricebookItemVersion(itemId, version) {
  return request(`/pricebook/items/${itemId}/versions`, {
    method: 'POST',
    body: JSON.stringify(version),
  });
}

// Pricing calculation
export async function calculatePricing(items, region, season) {
  return request('/pricebook/calculate', {
    method: 'POST',
    body: JSON.stringify({ items, region, season }),
  });
}
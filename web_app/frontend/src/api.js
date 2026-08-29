// Single place the backend origin is configured. Override with VITE_API_BASE
// in a .env file to point the dashboard at a backend on another host/port.
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

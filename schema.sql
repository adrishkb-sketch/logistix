-- Logistix Supabase Schema
-- Paste this into the Supabase SQL Editor and hit "Run"

CREATE TABLE IF NOT EXISTS companies (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS drivers (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS vehicles (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS warehouses (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS shipments (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS alerts (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS ledger (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS messages (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS strategy_plans (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS street_intel (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS users (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS journey_reviews (id text primary key, data jsonb);
CREATE TABLE IF NOT EXISTS weather_cells (id text primary key, data jsonb);

-- Set up Row Level Security (RLS) to allow service_role access
-- Since we are using the service_role key in the backend, RLS policies are bypassed by default.
-- However, we can disable RLS explicitly for now to prevent any accidental blocks if anon key is used.
ALTER TABLE companies DISABLE ROW LEVEL SECURITY;
ALTER TABLE drivers DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles DISABLE ROW LEVEL SECURITY;
ALTER TABLE warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE shipments DISABLE ROW LEVEL SECURITY;
ALTER TABLE alerts DISABLE ROW LEVEL SECURITY;
ALTER TABLE ledger DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_plans DISABLE ROW LEVEL SECURITY;
ALTER TABLE street_intel DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE journey_reviews DISABLE ROW LEVEL SECURITY;
ALTER TABLE weather_cells DISABLE ROW LEVEL SECURITY;

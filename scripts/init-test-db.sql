-- Creates the throwaway database used by the integration test suite.
-- Runs once, on first initialisation of the Postgres volume.
CREATE DATABASE pulse_test OWNER pulse;

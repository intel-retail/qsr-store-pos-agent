#!/bin/bash
set -e

# Create databases
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE pos_grocery;
    CREATE DATABASE pos_cafe;
EOSQL

# Initialize grocery database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname pos_grocery < /docker-entrypoint-initdb.d/grocery-schema.sql

# Initialize cafe database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname pos_cafe < /docker-entrypoint-initdb.d/cafe-schema.sql

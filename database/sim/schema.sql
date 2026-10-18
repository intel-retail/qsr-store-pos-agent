-- Copyright (c) 2026 Intel Corporation
--
-- SPDX-License-Identifier: Apache-2.0

-- EdgeMart Sim Service — durable, ordered event log
-- Reference schema for backend/src/sim-service (see SIM-SERVICE.md).
-- Also created automatically at runtime via SimEventLog.init() (CREATE TABLE IF NOT EXISTS),
-- this file exists for manual setup / review.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sim_events (
    id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    experience VARCHAR(20) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'info',
    source VARCHAR(20) NOT NULL DEFAULT 'sim', -- 'sim' | 'real'
    ref VARCHAR(100),                          -- correlation handle, e.g. table id / customer id
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sim_date DATE NOT NULL,                    -- simulated calendar day, for replay/grouping
    seed VARCHAR(200),                          -- seed that generated this event, NULL for real/manual
    payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sim_events_occurred_at ON sim_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_sim_events_sim_date ON sim_events (sim_date);
CREATE INDEX IF NOT EXISTS idx_sim_events_event_type ON sim_events (event_type);
CREATE INDEX IF NOT EXISTS idx_sim_events_ref ON sim_events (ref);

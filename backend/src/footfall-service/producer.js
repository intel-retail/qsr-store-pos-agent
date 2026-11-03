/*
 * Copyright (c) 2026 Intel Corporation
 *
 * SPDX-License-Identifier: Apache-2.0
 */

// Headless, deterministic footfall/movement producer. Uses the shared RNG and
// scheduling base; only the interval-based footfall curve and zone/density
// modeling here is specific to this service.

const { createSeededRng, deterministicUuid } = require('../service-common/rng');
const { ScheduledProducer, dayBounds } = require('../service-common/producer');
const { EVENT_TYPES, SEVERITIES, createEnvelope } = require('./envelope');

const INTERVAL_MS = 900_000; // 15 minutes

// Café zones and their relative footfall weight/capacity. Entrance sees
// everyone; seating/counter see a fraction of that.
const ZONES = [
  { ref: 'entrance', baseCount: 6, capacity: 20 },
  { ref: 'counter', baseCount: 4, capacity: 12 },
  { ref: 'seating', baseCount: 3, capacity: 15 },
];

// Time-of-day multiplier — morning rush, lunch peak, evening bump, baseline
// otherwise. This is what makes the "busy-time pattern" read tool meaningful.
function hourWeight(hour) {
  if (hour >= 7 && hour < 9) return 1.8;
  if (hour >= 12 && hour < 14) return 2.0;
  if (hour >= 17 && hour < 19) return 1.4;
  return 0.8;
}

function densityLevel(count, capacity) {
  const ratio = count / capacity;
  if (ratio >= 0.7) return 'high';
  if (ratio >= 0.34) return 'medium';
  return 'low';
}

class FootfallProducer extends ScheduledProducer {
  constructor({ log, hub = null, seed, experience = 'cafe', zones = ZONES }) {
    super({ label: 'FootfallProducer', log, hub, seed, experience });
    this.zones = zones;
  }

  /** Pure function: same seed + simDate always produces the same ordered footfall/density events. */
  generateSchedule(simDate) {
    const { dayStartMs, dayEndMs } = dayBounds(simDate);

    const raw = [];
    for (const zone of this.zones) {
      const rng = createSeededRng(this.seed, `${this.experience}:${simDate}:${zone.ref}`);
      let lastDensity = null;
      let interval = 0;

      for (let t = dayStartMs; t < dayEndMs; t += INTERVAL_MS) {
        const hour = new Date(t).getUTCHours();
        const jitter = 0.7 + rng() * 0.6; // 0.7x-1.3x
        const count = Math.max(0, Math.round(zone.baseCount * hourWeight(hour) * jitter));

        raw.push({
          offsetMs: t - dayStartMs,
          eventType: EVENT_TYPES.FOOTFALL_COUNT,
          ref: zone.ref,
          payload: { count },
          interval,
        });

        const density = densityLevel(count, zone.capacity);
        if (density !== lastDensity) {
          raw.push({
            offsetMs: t - dayStartMs,
            eventType: EVENT_TYPES.ZONE_DENSITY_CHANGED,
            ref: zone.ref,
            payload: { density, count, capacity: zone.capacity },
            interval,
          });
          lastDensity = density;
        }

        interval++;
      }
    }

    raw.sort((a, b) => a.offsetMs - b.offsetMs);

    return raw.map((e) => createEnvelope({
      eventId: deterministicUuid(`${this.seed}:${this.experience}:${simDate}:${e.ref}:${e.eventType}:${e.interval}`),
      eventType: e.eventType,
      severity: SEVERITIES.INFO,
      source: 'sim',
      experience: this.experience,
      ref: e.ref,
      occurredAt: new Date(dayStartMs + e.offsetMs).toISOString(),
      simDate,
      seed: this.seed,
      payload: e.payload,
    }));
  }
}

module.exports = { FootfallProducer };

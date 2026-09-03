const EventEmitter = require('events');

/**
 * TableStatusService - Subscribes to MQTT topics for vision AI events
 * and maintains real-time table state (clean, occupied, dirty).
 *
 * Designed to run as a singleton within the backend process.
 * Exposes state for the MCP table-status server and REST endpoints.
 */
class TableStatusService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.brokerUrl = options.brokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
    this.topics = options.topics || [
      'cafe/vision/events',   // External vision AI detections
      'cafe/pos/events',      // Internal POS events (order placed, customer seated)
      'cafe/staff/events',    // Staff actions (table cleared)
    ];
    this.tables = new Map(); // tableId → TableState
    this.client = null;
    this.connected = false;

    // Initialize default table set
    const tableCount = options.tableCount || 15;
    for (let i = 1; i <= tableCount; i++) {
      this.tables.set(`table-${i}`, {
        id: `table-${i}`,
        status: 'clean',
        lastChanged: new Date().toISOString(),
        occupiedBy: null,
        detectedBy: null,
        history: [],
      });
    }
  }

  connect() {
    let mqtt;
    try {
      mqtt = require('mqtt');
    } catch (e) {
      console.warn('[TableStatus] mqtt package not installed. Running in offline mode.');
      this.connected = false;
      return;
    }

    try {
      this.client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clientId: `pos-table-status-${Date.now()}`,
      });

      this.client.on('connect', () => {
        this.connected = true;
        console.log(`[TableStatus] Connected to MQTT broker at ${this.brokerUrl}`);
        this.topics.forEach(topic => {
          this.client.subscribe(topic, (err) => {
            if (err) console.error(`[TableStatus] Subscribe error for ${topic}:`, err);
            else console.log(`[TableStatus] Subscribed to ${topic}`);
          });
        });
      });

      this.client.on('message', (topic, message) => {
        try {
          const payload = JSON.parse(message.toString());
          this.handleMessage(topic, payload);
        } catch (e) {
          console.error('[TableStatus] Invalid message:', e.message);
        }
      });

      this.client.on('error', (err) => {
        console.error('[TableStatus] MQTT error:', err.message);
      });

      this.client.on('offline', () => {
        this.connected = false;
        console.log('[TableStatus] MQTT offline');
      });

      this.client.on('reconnect', () => {
        console.log('[TableStatus] Reconnecting to MQTT broker...');
      });
    } catch (e) {
      console.error('[TableStatus] Failed to connect:', e.message);
      this.connected = false;
    }
  }

  /**
   * Handle incoming MQTT message
   * Expected payload format:
   * {
   *   tableId: "table-4",
   *   event: "occupied" | "dirty" | "cleared" | "clean",
   *   timestamp: "2026-05-19T10:30:00Z",
   *   source: "camera-2" | "pos-system" | "staff-app",
   *   metadata: { ... }  // optional
   * }
   */
  handleMessage(topic, payload) {
    const { tableId, event, timestamp, source, metadata } = payload;

    if (!tableId || !event) {
      console.warn('[TableStatus] Message missing tableId or event');
      return;
    }

    // allowlist-validate event before any use — rejects unknown values at the boundary
    const VALID_EVENTS = ['occupied', 'dirty', 'cleared', 'clean'];
    if (!VALID_EVENTS.includes(event)) {
      console.warn('[TableStatus] Received unknown event type');
      return;
    }

    const table = this.tables.get(tableId);
    if (!table) {
      // Auto-create unknown table
      this.tables.set(tableId, {
        id: tableId,
        status: 'clean',
        lastChanged: new Date().toISOString(),
        occupiedBy: null,
        detectedBy: null,
        history: [],
      });
    }

    const current = this.tables.get(tableId);
    const prevStatus = current.status;
    const ts = timestamp || new Date().toISOString();

    // Determine new status from event
    let newStatus = current.status;
    switch (event) {
      case 'occupied':
        newStatus = 'occupied';
        current.occupiedBy = metadata?.customerId || null;
        break;
      case 'dirty':
        newStatus = 'dirty';
        current.detectedBy = source || 'unknown';
        break;
      case 'cleared':
      case 'clean':
        newStatus = 'clean';
        current.occupiedBy = null;
        current.detectedBy = null;
        break;
    }

    // Record state transition
    if (newStatus !== prevStatus) {
      current.history.push({
        from: prevStatus,
        to: newStatus,
        at: ts,
        source: source || 'unknown',
        topic,
      });
      // Keep history bounded
      if (current.history.length > 100) {
        current.history = current.history.slice(-50);
      }
    }

    current.status = newStatus;
    current.lastChanged = ts;
    this.tables.set(tableId, current);

    // Emit for real-time consumers
    this.emit('table-change', { tableId, ...current });
  }

  /**
   * Programmatically update a table's status (used by POS integration)
   */
  updateTable(tableId, event, source = 'pos-system', metadata = {}) {
    this.handleMessage('internal', {
      tableId,
      event,
      timestamp: new Date().toISOString(),
      source,
      metadata,
    });

    // Also publish to MQTT if connected
    if (this.client && this.connected) {
      this.client.publish('cafe/pos/events', JSON.stringify({
        tableId,
        event,
        timestamp: new Date().toISOString(),
        source,
        metadata,
      }));
    }
  }

  // --- Query Methods ---

  getAllTables() {
    const result = {};
    for (const [id, state] of this.tables) {
      result[id] = { ...state, history: undefined }; // exclude history from bulk query
    }
    return result;
  }

  resetAllTables() {
    for (const [, state] of this.tables) {
      state.status = 'clean';
      state.lastChanged = new Date().toISOString();
      state.occupiedBy = null;
      state.detectedBy = null;
    }
  }

  getTable(tableId) {
    return this.tables.get(tableId) || null;
  }

  getTablesByStatus(status) {
    return [...this.tables.entries()]
      .filter(([, v]) => v.status === status)
      .map(([id, v]) => ({ id, ...v, history: undefined }));
  }

  getDirtyTables() {
    return this.getTablesByStatus('dirty');
  }

  getOccupiedTables() {
    return this.getTablesByStatus('occupied');
  }

  getCleanTables() {
    return this.getTablesByStatus('clean');
  }

  getTableHistory(tableId) {
    const table = this.tables.get(tableId);
    return table ? table.history : [];
  }

  getStats() {
    const all = [...this.tables.values()];
    const stats = {
      total: all.length,
      clean: all.filter(t => t.status === 'clean').length,
      occupied: all.filter(t => t.status === 'occupied').length,
      dirty: all.filter(t => t.status === 'dirty').length,
      avgDirtyDuration: this._calcAvgDirtyDuration(),
    };
    return stats;
  }

  _calcAvgDirtyDuration() {
    let totalMs = 0;
    let count = 0;
    for (const [, table] of this.tables) {
      for (let i = 0; i < table.history.length; i++) {
        if (table.history[i].to === 'dirty') {
          // Find the next transition away from dirty
          const cleared = table.history.slice(i + 1).find(h => h.from === 'dirty');
          if (cleared) {
            totalMs += new Date(cleared.at) - new Date(table.history[i].at);
            count++;
          }
        }
      }
    }
    return count > 0 ? Math.round(totalMs / count / 1000) : 0; // seconds
  }

  getStatus() {
    return {
      connected: this.connected,
      brokerUrl: this.brokerUrl,
      tableCount: this.tables.size,
      subscribedTopics: this.topics,
    };
  }

  disconnect() {
    if (this.client) {
      this.client.end();
      this.client = null;
      this.connected = false;
    }
  }
}

// Singleton instance
let instance = null;

function getTableStatusService(options) {
  if (!instance) {
    instance = new TableStatusService(options);
  }
  return instance;
}

module.exports = { TableStatusService, getTableStatusService };

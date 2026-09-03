const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const path = require('path');

// Track both MCP server processes
let mcpProcess = null;
let mcpStatus = 'stopped';
let mcpExperience = null;

let tableStatusProcess = null;
let tableStatusStatus = 'stopped';

// GET MCP status (both servers)
router.get('/status', (req, res) => {
  res.json({
    pos: {
      status: mcpStatus,
      pid: mcpProcess ? mcpProcess.pid : null,
      experience: mcpExperience,
    },
    tableStatus: {
      status: tableStatusStatus,
      pid: tableStatusProcess ? tableStatusProcess.pid : null,
    },
    // Legacy fields for backward compat
    status: mcpStatus,
    pid: mcpProcess ? mcpProcess.pid : null,
  });
});

// POST start POS MCP server (experience-aware)
router.post('/start', (req, res) => {
  if (mcpProcess) {
    return res.json({ status: mcpStatus, message: 'MCP server is already running', experience: mcpExperience });
  }

  const experience = req.experience || 'grocery';
  const dbName = experience === 'cafe'
    ? (process.env.CAFE_DB_NAME || 'pos_cafe')
    : (process.env.GROCERY_DB_NAME || 'pos_grocery');

  try {
    const mcpPath = path.resolve(__dirname, '..', 'mcp-server.js');
    mcpProcess = spawn('node', [mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MCP_DB_NAME: dbName },
    });

    mcpStatus = 'running';
    mcpExperience = experience;

    mcpProcess.on('error', (err) => {
      console.error('MCP server error:', err);
      mcpStatus = 'error';
      mcpProcess = null;
      mcpExperience = null;
    });

    mcpProcess.on('exit', (code) => {
      console.log(`MCP server exited with code ${code}`);
      mcpStatus = 'stopped';
      mcpProcess = null;
      mcpExperience = null;
    });

    mcpProcess.stderr.on('data', (data) => {
      console.error(`MCP stderr: ${data}`);
    });

    res.json({ status: 'running', pid: mcpProcess.pid, experience });
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// POST stop POS MCP server
router.post('/stop', (req, res) => {
  if (!mcpProcess) {
    return res.json({ status: 'stopped', message: 'MCP server is not running' });
  }

  mcpProcess.kill('SIGTERM');
  mcpProcess = null;
  mcpStatus = 'stopped';
  mcpExperience = null;
  res.json({ status: 'stopped' });
});

// POST start Table Status MCP server (café only)
router.post('/table-status/start', (req, res) => {
  if (tableStatusProcess) {
    return res.json({ status: tableStatusStatus, message: 'Table status MCP server is already running' });
  }

  try {
    const mcpPath = path.resolve(__dirname, '..', 'mcp-table-status.js');
    tableStatusProcess = spawn('node', [mcpPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    tableStatusStatus = 'running';

    tableStatusProcess.on('error', (err) => {
      console.error('Table status MCP error:', err);
      tableStatusStatus = 'error';
      tableStatusProcess = null;
    });

    tableStatusProcess.on('exit', (code) => {
      console.log(`Table status MCP exited with code ${code}`);
      tableStatusStatus = 'stopped';
      tableStatusProcess = null;
    });

    tableStatusProcess.stderr.on('data', (data) => {
      console.error(`Table Status MCP stderr: ${data}`);
    });

    res.json({ status: 'running', pid: tableStatusProcess.pid });
  } catch (err) {
    console.error('Failed to start table status MCP server:', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// POST stop Table Status MCP server
router.post('/table-status/stop', (req, res) => {
  if (!tableStatusProcess) {
    return res.json({ status: 'stopped', message: 'Table status MCP server is not running' });
  }

  tableStatusProcess.kill('SIGTERM');
  tableStatusProcess = null;
  tableStatusStatus = 'stopped';
  res.json({ status: 'stopped' });
});

// GET MCP server config (for clients to connect)
router.get('/config', (req, res) => {
  const experience = req.experience || 'grocery';
  const posPath = path.resolve(__dirname, '..', 'mcp-server.js');
  const tableStatusPath = path.resolve(__dirname, '..', 'mcp-table-status.js');

  const dbName = experience === 'cafe'
    ? (process.env.CAFE_DB_NAME || 'pos_cafe')
    : (process.env.GROCERY_DB_NAME || 'pos_grocery');

  const config = {
    mcpServers: {
      [`edgemart-${experience}`]: {
        command: 'node',
        args: [posPath],
        env: {
          DB_HOST: process.env.DB_HOST || 'localhost',
          DB_PORT: process.env.DB_PORT || '5432',
          MCP_DB_NAME: dbName,
          DB_USER: process.env.DB_USER || 'postgres',
        },
      },
    },
  };

  // Add table-status server for café experience
  if (experience === 'cafe') {
    config.mcpServers['edgemart-table-status'] = {
      command: 'node',
      args: [tableStatusPath],
      env: {
        MQTT_BROKER_URL: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
        CAFE_TABLE_COUNT: process.env.CAFE_TABLE_COUNT || '15',
      },
    };
  }

  res.json(config);
});

module.exports = router;

// Import required modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// --- Server Setup ---
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins for simplicity. For production, restrict this.
    methods: ["GET", "POST"]
  }
});

// --- Middleware ---
app.use(cors());
app.use(express.json()); // Middleware to parse JSON bodies from ESP32 requests
app.use(express.static('public')); // Serve static files (like your dashboard)

// --- Global State ---
// Store the latest sensor data and relay state
let latestSensorData = {
  dht11: { temperature: 'N/A', humidity: 'N/A' },
  dht22: { temperature: 'N/A', humidity: 'N/A' },
  dallas: { temperature: 'N/A' }
};
let relayState = false; // false = OFF, true = ON

// --- API Endpoint for ESP32 ---
// The ESP32 will send its sensor data to this endpoint
app.post('/data', (req, res) => {
  console.log('Received data from ESP32:', req.body);
  
  // Update server state with the new data
  latestSensorData = req.body;
  
  // Broadcast the new data to all connected dashboard clients
  io.emit('sensorData', latestSensorData);
  
  // Respond to the ESP32 to acknowledge receipt
  res.status(200).json({ status: 'success', relayState: relayState });
});

// --- Real-time Communication with Dashboard ---
io.on('connection', (socket) => {
  console.log('A user connected to the dashboard.');

  // Immediately send the current state to the newly connected client
  socket.emit('initialState', { sensorData: latestSensorData, relayState: relayState });

  // Listen for the 'toggleRelay' event from the dashboard
  socket.on('toggleRelay', () => {
    relayState = !relayState; // Flip the state
    console.log(`Relay state changed to: ${relayState ? 'ON' : 'OFF'}`);
    
    // Broadcast the new relay state to all clients
    io.emit('relayStateChange', relayState);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected.');
  });
});

// --- Serve the Dashboard ---
// We'll create an HTML file for this in the next step
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

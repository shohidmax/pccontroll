// Import required modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// --- Server Setup ---
const app = express();
const server = http.createServer(app);

// --- CORS Configuration for Production ---
const allowedOrigins = ['https://pccontroll.onrender.com', 'http://localhost:3000']; // Add your local dev URL if needed
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
};

const io = socketIo(server, {
  cors: corsOptions
});

// --- Middleware ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// --- Global State ---
let latestSensorData = {
  dht11: { temperature: 'N/A', humidity: 'N/A' },
  dht22: { temperature: 'N/A', humidity: 'N/A' },
  dallas: { temperature: 'N/A' }
};
let pulseRequested = false;

// --- API Endpoint for ESP32 ---
app.post('/data', (req, res) => {
  console.log('Received data from ESP32:', req.body);
  
  // Separate sensor data from the log
  const { log, ...sensorData } = req.body;
  latestSensorData = sensorData;

  // Broadcast sensor data to the dashboard
  io.emit('sensorData', latestSensorData);
  
  // Broadcast log data to the dashboard if it exists
  if (log && log.trim() !== "") {
    io.emit('esp32log', log);
  }

  // Check if a pulse action is pending from the dashboard
  let actionToSend = 'none';
  if (pulseRequested) {
    actionToSend = 'pulse';
    pulseRequested = false; // Reset the flag
    console.log('Pulse action command sent to ESP32.');
  }
  
  // Respond to the ESP32 with the action command
  res.status(200).json({ action: actionToSend });
});

// --- Real-time Communication with Dashboard ---
io.on('connection', (socket) => {
  console.log('A user connected to the dashboard.');

  // Send the current sensor data on connection
  socket.emit('initialState', { sensorData: latestSensorData });

  // Listen for the 'pulseRelay' event from the dashboard
  socket.on('pulseRelay', () => {
    pulseRequested = true;
    console.log('Pulse request received. Waiting for ESP32 to connect.');
    // Notify all dashboards that the pulse was triggered
    io.emit('pulseTriggered');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected.');
  });
});

// --- Serve the Dashboard ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


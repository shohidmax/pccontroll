// Import required modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// --- Server Setup ---
const app = express();
const server = http.createServer(app);

// --- CORS Configuration for Production ---
const allowedOrigins = ['https://pccontroll.onrender.com'];
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
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
// This flag will be true when a user clicks the button on the dashboard
let pulseRequested = false;

// --- API Endpoint for ESP32 ---
app.post('/data', (req, res) => {
  console.log('Received data from ESP32:', req.body);
  latestSensorData = req.body;
  io.emit('sensorData', latestSensorData);

  // Check if a pulse action is pending
  let actionToSend = 'none';
  if (pulseRequested) {
    actionToSend = 'pulse';
    pulseRequested = false; // Reset the flag after queuing the action
    console.log('Pulse action command sent to ESP32.');
  }
  
  // Respond to the ESP32 with the action command
  res.status(200).json({ action: actionToSend });
});

// --- Real-time Communication with Dashboard ---
io.on('connection', (socket) => {
  console.log('A user connected to the dashboard.');

  // Send only the current sensor data on connection
  socket.emit('initialState', { sensorData: latestSensorData });

  // Listen for the 'pulseRelay' event from the dashboard
  socket.on('pulseRelay', () => {
    pulseRequested = true; // Set the flag for the next ESP32 check-in
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


// Import required modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

// --- Server Setup ---
const app = express();
const server = http.createServer(app);

// --- CORS Configuration ---
const allowedOrigins = ['https://pccontroll.onrender.com', 'http://localhost:3000'];
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
  cors: {
    origin: "https://pccontroll.onrender.com",
    methods: ["GET", "POST"]
  }
});

// --- Middleware ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// --- Global State ---
let pulseRequested = false;
let lastSeen = 0; // Track the last time ESP32 checked in
const ESP32_TIMEOUT = 12000; // 12 seconds timeout

// --- API Endpoint for ESP32 ---
app.post('/data', (req, res) => {
  console.log('Received data from ESP32:', req.body);
  lastSeen = Date.now(); // Update the timestamp
  
  const { log } = req.body;
  
  // Broadcast log data to the dashboard if it exists
  if (log && log.trim() !== "") {
    io.emit('esp32log', log);
  }

  // Check if a pulse action is pending
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
  
  // Immediately send current status to the new user
  const isOnline = (Date.now() - lastSeen) < ESP32_TIMEOUT;
  socket.emit('esp32Status', { status: isOnline ? 'Online' : 'Offline' });

  // Listen for the 'pulseRelay' event from the dashboard
  socket.on('pulseRelay', () => {
    pulseRequested = true;
    console.log('Pulse request received. Waiting for ESP32 to connect.');
    io.emit('pulseTriggered');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected.');
  });
});

// --- ESP32 Status Checker ---
// Periodically check if the ESP32 is still connected
setInterval(() => {
  const isOnline = (Date.now() - lastSeen) < ESP32_TIMEOUT;
  io.emit('esp32Status', { status: isOnline ? 'Online' : 'Offline' });
}, 5000); // Check every 5 seconds


// --- Serve the Dashboard ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


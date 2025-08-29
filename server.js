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
let lastSeen = 0; 
const ESP32_TIMEOUT = 12000; 

// --- Security State ---
const CORRECT_PASSWORD = '11332244'; // আপনার ৮ ডিজিটের পাসওয়ার্ড এখানে দিন
let loginAttempts = 0;
let isBlocked = false;
let blockUntil = 0;
const BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

// --- API Endpoint for ESP32 ---
app.post('/data', (req, res) => {
  console.log('Received data from ESP32:', req.body);
  lastSeen = Date.now();
  
  const { log } = req.body;
  if (log && log.trim() !== "") {
    io.emit('esp32log', log);
  }

  let actionToSend = 'none';
  if (pulseRequested) {
    actionToSend = 'pulse';
    pulseRequested = false; 
    console.log('Pulse action command sent to ESP32.');
  }
  
  res.status(200).json({ action: actionToSend });
});

// --- Real-time Communication with Dashboard ---
io.on('connection', (socket) => {
  console.log('A user is trying to connect.');
  socket.isAuthenticated = false; // Initially not authenticated

  // --- Login Logic ---
  socket.on('loginAttempt', (password) => {
    // 1. Check if the user is currently blocked
    if (isBlocked && Date.now() < blockUntil) {
      const remainingTime = Math.ceil((blockUntil - Date.now()) / 60000);
      socket.emit('loginBlock', { message: `Too many failed attempts. Try again in ${remainingTime} minutes.` });
      return;
    }
    // 2. Reset block if the time has passed
    if (isBlocked && Date.now() >= blockUntil) {
      isBlocked = false;
      loginAttempts = 0;
    }

    // 3. Check if the password is correct
    if (password === CORRECT_PASSWORD) {
      loginAttempts = 0;
      socket.isAuthenticated = true;
      socket.emit('loginSuccess');
      console.log('A user successfully authenticated.');
    } else {
      loginAttempts++;
      if (loginAttempts >= 3) {
        isBlocked = true;
        blockUntil = Date.now() + BLOCK_DURATION;
        const remainingTime = 5;
        socket.emit('loginBlock', { message: `Too many failed attempts. Try again in ${remainingTime} minutes.` });
      } else {
        socket.emit('loginFail', { message: 'Incorrect password.' });
      }
    }
  });
  
  // Immediately send current status to authenticated users
  if (socket.isAuthenticated) {
    const isOnline = (Date.now() - lastSeen) < ESP32_TIMEOUT;
    socket.emit('esp32Status', { status: isOnline ? 'Online' : 'Offline' });
  }

  // Listen for the 'pulseRelay' event from the dashboard
  socket.on('pulseRelay', () => {
    if (!socket.isAuthenticated) {
      console.log('Unauthorized pulse request received.');
      return; // Ignore if not authenticated
    }
    pulseRequested = true;
    console.log('Pulse request received. Waiting for ESP32 to connect.');
    io.emit('pulseTriggered');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected.');
  });
});

// --- ESP32 Status Checker ---
setInterval(() => {
  const isOnline = (Date.now() - lastSeen) < ESP32_TIMEOUT;
  // Send status only to authenticated clients
  io.sockets.sockets.forEach((socket) => {
    if (socket.isAuthenticated) {
      socket.emit('esp32Status', { status: isOnline ? 'Online' : 'Offline' });
    }
  });
}, 5000); 

// --- Serve the Dashboard ---
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// --- Start the Server ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


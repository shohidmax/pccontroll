const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- CORS Configuration ---
const allowedOrigins = ['https://pccontroll.onrender.com', 'http://localhost:3000', null];
const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests) and from allowed origins
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ["GET", "POST"]
  }
});

app.use(cors()); // Use basic cors for HTTP requests
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const CORRECT_PASSWORD = '12345678'; // আপনার ৮ ডিজিটের পাসওয়ার্ড এখানে দিন

// --- State Management ---
let actionToTake = 'none'; // 'none' or 'pulse'
let lastSeenTimeout;
let deviceStatus = 'Offline';
let latestSensorData = {
    dht11: { temperature: null, humidity: null },
    dht22: { temperature: null, humidity: null }
};

const loginAttempts = {};
const BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes

// --- HTTP Endpoint for Device ---
app.post('/data', (req, res) => {
    const { log, dht11, dht22 } = req.body;
    
    if (log) {
        io.emit('deviceLog', log);
    }

    if (dht11) latestSensorData.dht11 = dht11;
    if (dht22) latestSensorData.dht22 = dht22;
    
    // Broadcast sensor update to all clients
    io.emit('sensorUpdate', latestSensorData);

    // Update device status to Online
    if (deviceStatus !== 'Online') {
        deviceStatus = 'Online';
        io.emit('deviceStatus', { status: 'Online' });
    }

    // Reset the offline timer
    clearTimeout(lastSeenTimeout);
    lastSeenTimeout = setTimeout(() => {
        deviceStatus = 'Offline';
        io.emit('deviceStatus', { status: 'Offline' });
    }, 15000); // Device is considered offline after 15 seconds

    res.json({ action: actionToTake });
    if (actionToTake === 'pulse') {
        actionToTake = 'none'; // Reset after sending the command
    }
});

// --- Socket.IO Logic for Dashboard ---
io.on('connection', (socket) => {
    let loggedIn = false;

    socket.on('loginAttempt', (password) => {
        const ip = socket.handshake.address;
        const now = Date.now();

        if (loginAttempts[ip] && now < loginAttempts[ip].blockUntil) {
            socket.emit('loginBlock', { message: `Too many attempts. Try again in ${Math.ceil((loginAttempts[ip].blockUntil - now) / 60000)} minutes.` });
            return;
        }

        if (password === CORRECT_PASSWORD) {
            loggedIn = true;
            delete loginAttempts[ip];
            socket.emit('loginSuccess');
            // Send initial status on successful login
            socket.emit('deviceStatus', { status: deviceStatus });
            socket.emit('sensorUpdate', latestSensorData);

        } else {
            loginAttempts[ip] = loginAttempts[ip] || { count: 0 };
            loginAttempts[ip].count++;

            if (loginAttempts[ip].count >= 3) {
                loginAttempts[ip].blockUntil = now + BLOCK_DURATION;
                socket.emit('loginBlock', { message: 'Too many attempts. Blocked for 5 minutes.' });
            } else {
                socket.emit('loginFail', { message: `Invalid password. ${3 - loginAttempts[ip].count} attempts remaining.` });
            }
        }
    });

    socket.on('pulseRelay', () => {
        if (loggedIn && deviceStatus === 'Online') {
            console.log('Pulse command received from dashboard.');
            actionToTake = 'pulse';
            io.emit('pulseTriggered'); // Feedback to all clients
        }
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected from the dashboard.');
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


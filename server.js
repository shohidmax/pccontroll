const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- START OF FIX: Specific CORS Configuration for Socket.IO ---
// This is the crucial part that allows the browser's real-time connection.
const io = socketIo(server, {
  cors: {
    origin: "https://pccontroll.espserver.site", // Must exactly match your dashboard's URL
    methods: ["GET", "POST"]
  }
});
// --- END OF FIX ---

app.use(cors()); // General CORS for simple requests like from the NodeMCU
app.use(express.json());
app.use(express.static('public')); 

const PORT = process.env.PORT || 3000;
const CORRECT_PASSWORD = '12345678';

let actionToTake = 'none';
let lastSeenTimeout;
let deviceStatus = 'Offline';
let latestSensorData = {
    dht11: { temperature: null, humidity: null },
    ssid: null
};

const loginAttempts = {};
const BLOCK_DURATION = 5 * 60 * 1000;
let esp32Socket = null;

app.post('/data', (req, res) => {
    const { log, dht11, ssid } = req.body;
    
    if (log) {
        io.emit('deviceLog', log);
    }

    if (dht11) latestSensorData.dht11 = dht11;
    if (ssid) latestSensorData.ssid = ssid;
    
    io.emit('sensorUpdate', latestSensorData);

    if (deviceStatus !== 'Online') {
        deviceStatus = 'Online';
        io.emit('deviceStatus', { status: 'Online', ssid: latestSensorData.ssid });
    }

    clearTimeout(lastSeenTimeout);
    lastSeenTimeout = setTimeout(() => {
        if (!esp32Socket) {
            deviceStatus = 'Offline';
            latestSensorData.ssid = null;
            io.emit('deviceStatus', { status: 'Offline', ssid: null });
        }
    }, 15000); 

    res.json({ action: actionToTake });
    if (actionToTake === 'pulse' || actionToTake === 'restart') {
        actionToTake = 'none'; 
    }
});

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
            socket.emit('deviceStatus', { status: deviceStatus, ssid: latestSensorData.ssid });
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

    // ESP32 connection events via Socket.IO
    socket.on('esp32Status', (data) => {
        esp32Socket = socket;
        deviceStatus = 'Online';
        latestSensorData.ssid = data.ssid;
        io.emit('deviceStatus', { status: 'Online', ssid: data.ssid });
        console.log(`[SYSTEM] ESP32 registered via Socket.IO. SSID: ${data.ssid}`);
    });

    socket.on('sensorUpdate', (data) => {
        if (socket === esp32Socket) {
            latestSensorData.dht11 = data.dht11;
            if (data.ssid) latestSensorData.ssid = data.ssid;
            io.emit('sensorUpdate', latestSensorData);
        }
    });

    socket.on('esp32Log', (logMsg) => {
        if (socket === esp32Socket) {
            io.emit('deviceLog', logMsg);
        }
    });

    socket.on('pulseRelay', () => {
        if (loggedIn) {
            if (esp32Socket) {
                esp32Socket.emit('action', { command: 'pulse' });
            } else {
                actionToTake = 'pulse';
            }
            io.emit('pulseTriggered');
        }
    });

    socket.on('restartRelay', () => {
        if (loggedIn) {
            if (esp32Socket) {
                esp32Socket.emit('action', { command: 'restart' });
            } else {
                actionToTake = 'restart';
            }
            io.emit('restartTriggered');
        }
    });

    socket.on('disconnect', () => {
        if (socket === esp32Socket) {
            esp32Socket = null;
            deviceStatus = 'Offline';
            latestSensorData.ssid = null;
            io.emit('deviceStatus', { status: 'Offline', ssid: null });
            console.log('[SYSTEM] ESP32 disconnected.');
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});


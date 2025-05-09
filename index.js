const express = require("express");
const wSocket = require("ws");
const http = require("http");
const { setWss, log } = require('./utils');
const cors = require('cors');
const path = require("path");
const app = express();
const port = 8080;
require('dotenv').config();

setTimeout(function() {
    log(`[the13thgeek] theCloud System v${process.env.GEEK_NODE_VER}`);
    http.get({'host': 'api.ipify.org', 'port': 80, 'path': '/'}, function(resp) {
        resp.on('data', function(ip) {
            console.log("Server IP: " + ip);
        });
    });
}, 3000);

// Adding CORS
// app.use(cors({
//     origin: 'http://localhost:5173'
// }));
const allowedOrigins = ['http://localhost:5173','https://mainframe.the13thgeek.com','https://the13thgeek.github.io'];
app.use(cors({
    origin: (origin,callback) => {
        if(!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Unauthorized access.'));
        }
    }
}));

app.use(express.json());

// Adding API KEY authentication + middleware
const API_KEY = process.env.GEEK_API_KEY || "XX13XX";

app.use((req, res, next) => {
    // Allow public access to thumbnails
    if (req.path.startsWith('/twitch-live/')) {
        return next(); // Skip API key check
    }
    if (req.path.startsWith('/mainframe/supersonic')) {
        return next(); // Skip API key check
    }

    const clientApiKey = req.headers['x-api-key'];
    if(clientApiKey !== API_KEY) {
        return res.status(403).json({
            status: false,
            message: "Unauthorized access."
        });
    }
    next();
})

// Adding public folder for thumbnails
app.use(express.static(path.join(__dirname, 'public')));

// HTTP->Websocket
const wss = new wSocket.Server({ noServer: true});
setWss(wss);

const server = app.listen(port, () => console.log(`Server is running and listening on port: ${port}`));

// Routing
const moduleSrs = require('./routes/srs');
const moduleTwitch = require('./routes/twitch');
const moduleMainframe = require('./routes/mainframe');
const { callbackify } = require("util");
app.use('/srs', moduleSrs);
app.use('/twitch', moduleTwitch);
app.use('/mainframe', moduleMainframe);

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});

module.exports = app;
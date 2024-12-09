const express = require("express");
const wSocket = require("ws");
const http = require("http");
const { setWss } = require('./utils');
const cors = require('cors');
const app = express();
const port = 8080;
require('dotenv').config();

setTimeout(function() {
    console.log(`[the13thgeek] theCloud System v${process.env.GEEK_NODE_VER}`);
    http.get({'host': 'api.ipify.org', 'port': 80, 'path': '/'}, function(resp) {
        resp.on('data', function(ip) {
            console.log("Server IP: " + ip);
        });
    });
}, 5000);

// Adding CORS
app.use(cors({
    origin: 'http://localhost:5173'
}));

app.use(express.json());

// Adding API KEY authentication + middleware
const API_KEY = process.env.GEEK_API_KEY || "XX13XX";

app.use((req, res, next) => {
    const clientApiKey = req.headers['x-api-key'];
    if(clientApiKey !== API_KEY) {
        return res.status(403).json({
            status: false,
            message: "Unauthorized access."
        });
    }
    next();
})

// HTTP->Websocket
const wss = new wSocket.Server({ noServer: true});
setWss(wss);

const server = app.listen(port, () => console.log(`Server is running and listening on port: ${port}`));

// Routing
const moduleSrs = require('./routes/srs');
const moduleTwitch = require('./routes/twitch');
const moduleMainframe = require('./routes/mainframe');
app.use('/srs', moduleSrs);
app.use('/twitch', moduleTwitch);
app.use('/mainframe', moduleMainframe);

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});

module.exports = app;
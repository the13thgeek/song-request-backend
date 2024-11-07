const express = require("express");
const wSocket = require("ws");
const app = express();
const port = 1300;

// Define song library
const songs = require('./data/ddr3mk.json');

function findSong(query) {
    const sanitizedQuery = query.toLowerCase();
    console.log('Searching for ' + sanitizedQuery);
    return songs.find(song => 
        song.title.toLowerCase().includes(sanitizedQuery) ||
        song?.romanizedTitle?.toLowerCase().includes(sanitizedQuery)
    );
}

app.use(express.json());

// Initialize websocket
const wss = new wSocket.Server({ noServer: true});

// Broadcast
function broadcast(data) {
    wss.clients.forEach(client => {
        if(client.readyState === wSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// Set up endpoints
app.post('/request-song', (req, res) => {
    let requestedSong = findSong(req.query.songtitle);
    if(requestedSong) {
        broadcast({ type: "ADD_SONG", song: { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } });
        res.status(200).send('Request has been added: ' + requestedSong.title + '/' + requestedSong.artist);
        console.log('Request has been added: ' + requestedSong.title + '/' + requestedSong.artist);
    } else {
        res.status(200).send("Sorry, no songs matched \"" + req.query.songtitle + ".\"");
        console.log("No songs matched \"" + req.query.songtitle + ".\"");
    }
});

// app.post('/add-song', (req, res) => {
//     const { title, artist, user } = req.body;
    
//     if(title && artist && user) {
//         broadcast({ type: 'ADD_SONG', song: { title, artist, user } });
//         res.status(200).send('Request added');
//         console.log('Request added');
//     } else {
//         res.status(400).send("Error");
//         console.log('Error');
//     }
// });

app.post('/remove-song', (req, res) => {
    broadcast({ type: 'REMOVE_SONG' });
    res.status(200).send("Request has been fulfilled.");
    console.log("Request has been fulfilled.")
});

// HTTP->Websocket
const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});
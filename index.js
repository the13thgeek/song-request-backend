const express = require("express");
const wSocket = require("ws");
const app = express();
const port = 1300;

// Define song library
const songs = require('./data/ddr3mk.json');
let queue = [];

function findSong(query) {
    console.log('Searching for "' + query.trim() + '"');
    const words = query.toLowerCase().split(" ");
    
    return songs.find(song => {
        const title = song.title.toLowerCase();
        const artist = song.artist.toLowerCase();
        const romanizedTitle = song?.romanizedTitle?.toLowerCase() || "";
        const romanizedArtist = song?.romanizedArtist?.toLowerCase() || "";

        //console.log("Searching: " + song.title)
        
        return words.every(word =>
            title.includes(word) ||
            romanizedTitle.includes(word) ||
            artist.includes(word) ||
            romanizedArtist.includes(word)
        );

    });

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
        queue.push( { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } );
        res.status(200).send(`✔️ Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);
        console.log(`Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);
    } else {
        res.status(200).send(`❌ Sorry, no songs matched "${req.query.songtitle}." The song you requested may not be in the current game.`);
        console.log("No songs matched \"" + req.query.songtitle + ".\"");
    }
});

app.post('/remove-song', (req, res) => {
    
    if(queue.length === 0) { console.log('No songs in queue to remove.'); return; }
    
    broadcast({ type: 'REMOVE_SONG' });
    let currSong = queue[0];
    queue = queue.slice(1);
    if(queue.length > 0) {
        res.status(200).send(`▶️ Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`);
        console.log(`Request [${currSong.title}] has been played! Next song ⏩ [${queue[0].title}]`);
    } else {
        res.status(200).send(`▶️ Request [${currSong.title}] has been played. There are no songs in queue.`);
        console.log(`Request [${currSong.title}] has been played. There are no songs in queue.`)
    }
    
    
});

// HTTP->Websocket
const server = app.listen(port, () => console.log(`Server running on http://localhost:${port}`));

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, ws => {
        wss.emit('connection', ws, request)
    });
});
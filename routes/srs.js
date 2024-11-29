/* the13thgeek: SONG REQUEST SYSTEM ROUTING */

const express = require('express');
const router = express.Router();
const { broadcast } = require('../utils');

// Variables
let queue = [];             // queue line for songs
let requestsOpen = false;   // not accepting requests by default
let gameLibraryId = null;   // id of DDR version/library
let songs = [];             // song JSON DB based on gameLibraryID

// Functions
// Song Search
function findSong(query) {
    console.log('Searching for "' + query.trim() + '"');
    const words = query.toLowerCase().split(" ");
    
    return songs.find(song => {
        const title = song.title.toLowerCase();
        const artist = song.artist.toLowerCase();
        const romanizedTitle = song?.romanizedTitle?.toLowerCase() || "";
        const romanizedArtist = song?.romanizedArtist?.toLowerCase() || "";
        
        return words.every(word =>
            title.includes(word) ||
            romanizedTitle.includes(word) ||
            artist.includes(word) ||
            romanizedArtist.includes(word)
        );

    });
}

// Endpoint for status
router.post('/status', (req, res) => {
    console.log(`Status -> Game ID: [${gameLibraryId}] Requests: [${requestsOpen}] Queue: [${queue.length}]`);
    res.status(200).json({ gameLibraryId: gameLibraryId, requestsOpen: requestsOpen, queueLength: queue.length, queue: queue });
});

// Endpoint for song requests
router.post('/request-song', (req, res) => {
    let requestedSong = findSong(req.query.songtitle);

    // Check first if requests are open
    if(!requestsOpen) {
        console.log("Requests are not currently open.");
        res.status(200).send("Requests are not currently open.");
        return;
    }

    // Check if song library is defined
    if(!gameLibraryId) {
        console.log("Please set Game ID to take requests.");
        res.status(200).send("Please set Game ID to take requests.");
        return;
    }
    
    // If the song is found
    if(requestedSong) {

        const isDuplicate = queue.some(song => 
            song.title === requestedSong.title &&
            song.artist === requestedSong.artist
        )
        const userSongCount = queue.filter(song => song.user === req.query.user).length;
        console.log(`userSongCount:`, userSongCount);

        // Check if the song is already in queue
        if(isDuplicate) {
            res.status(200).send(`⚠️ This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
            console.log(`This song is already in queue: [${requestedSong.title} / ${requestedSong.artist}]`);
        }

        // Check if user already has 3 songs in queue
        else if(userSongCount >= 3) {
            res.status(200).send(`⚠️ Only three (3) requests per user are allowed at a time, please wait and try again.`);
            console.log(`Only three (3) requests per user are allowed at a time, please wait and try again.`);
        }

        // Otherwise, proceed
        else {
            broadcast({ type: "ADD_SONG", song: { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } });
            queue.push( { title: requestedSong.title, artist: requestedSong.artist, user: req.query.user } );
            res.status(200).send(`✔️ Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);
            console.log(`Request has been added: [${requestedSong.title} / ${requestedSong.artist}]`);        
        }        
    } 
    // If the song is not found
    else {
        res.status(200).send(`❌ Sorry, no songs matched "${req.query.songtitle}." The song you requested may not be in the current game.`);
        console.log("No songs matched \"" + req.query.songtitle + ".\"");
    }
});

// Endpoint for initializing game song library
router.post('/init-game', (req, res) => {
    let gameId = req.query.gameId;

    try {
        songs = require(`../data/${gameId}.json`);
        console.log("Game ID: " + gameId);
        gameLibraryId = gameId;
        console.log(`Game [${gameId} (${songs.length})] initialized. Requests are currently ${requestsOpen ? "ON" : "OFF"}.`);
        res.status(200).send(`Game [${gameId} (${songs.length})] initialized. Requests are currently ${requestsOpen ? "ON" : "OFF"}.`);
    } catch(error) {
        console.log("Error: " + error);
        res.status(200).send(`Unable to initialize game [${gameId}].`);
    }
});

// Endpoint for enabling/disabling requests
router.post('/request-status', (req, res) => {
    if(parseInt(req.query.open) === 1) {        
        if(!gameLibraryId) {
            console.log("Please set Game ID before opening requests.");
            res.status(200).send("Please set Game ID before opening requests.");
            return;
        }
        
        requestsOpen = true;
        broadcast({ type: 'REQUEST_MODE_ON' });
        console.log("Requests are now open.");
        res.status(200).send("Requests are now open.");
    } else {
        requestsOpen = false;
        broadcast({ type: 'REQUEST_MODE_OFF' });
        console.log("Requests are now closed.");
        res.status(200).send("Requests are now closed.");
    }
    //broadcast({ type: "REQUEST_MODE", requestStatus: requestsOpen });
});

// Endpoint for checking song availability
router.post('/check-song', (req, res) => {
    let requestedSong = findSong(req.query.songtitle);

    if(requestedSong) {
        res.status(200).send(`ℹ️ I found the song [${requestedSong.title} / ${requestedSong.artist}]. If this is correct, type "!req ${req.query.songtitle}" (without the quotes) to proceed.`);
        console.log(`Result: [${requestedSong.title} / ${requestedSong.artist}]`);
    } else {
        res.status(200).send(`❌ Sorry, no songs matched "${req.query.songtitle}." This song may not be in the current game.`);
        console.log('Result: No matches found.');
    }
});

// Endpoint for removing played song in front of the queue
router.post('/remove-song', (req, res) => {    
    if(queue.length === 0) { 
        res.status(200).send('Requests queue is empty.');
        console.log('No songs in queue to remove.');
        return;
    }
    
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

module.exports = router;
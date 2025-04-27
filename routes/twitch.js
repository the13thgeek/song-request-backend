/* the13thgeek: TWITCH INTEGRATION ROUTING */

const express = require('express');
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { log, hashFile } = require('../utils');
//const fetch = require("node-fetch");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const workdir = path.join(__dirname, "../public/twitch-live");
const twitch_username = 'the13thgeek';

let thumbnailUpdater = null;
let live_status = false;

// FUNCTIONS

// Fetch Live Data
async function getLiveData() {
    let requestUrl = `https://api.twitch.tv/helix/streams?user_login=${twitch_username}`;
    let output = null;

    try {
        let response = await fetch(requestUrl, {
            headers: {
              'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
              'Client-Id': `${process.env.TWITCH_CLIENT_ID}`
            }
        });
        let data = await response.json();
        contents = data.data[0];

        if(contents) {
            // resize thumbnails
            contents.thumbnail_url = thumbnailResize(contents.thumbnail_url,640,360);
            live_status = true;
            output = contents;
        } else {
            live_status = false;
        }
        
    } catch (e) {
        console.error('Error: ',e);
    }

    return output;
}

// For Twitch output thumbnail resizing
function thumbnailResize(url, width, height) {
    if (typeof url === 'undefined') {
      console.error('URL is undefined');
      console.error(width + 'x' + height);
      return;
    }

    return url
    .replace(/%\{width\}|\{width\}/g, width)
    .replace(/%\{height\}|\{height\}/g, height);    
}

// Fetch stream thumbnail 
async function fetchThumbnail() {
    const requestUrl = `https://api.twitch.tv/helix/streams?user_login=${twitch_username}`;
    let thumbnailUrl = null;

    log(`Fetching live thumbnails from ${requestUrl}`);

    try {
        let response = await fetch(requestUrl, {
            headers: {
              'Authorization': `Bearer ${process.env.TWITCH_ACCESS_TOKEN}`,
              'Client-Id': `${process.env.TWITCH_CLIENT_ID}`
            }
        });
        let data = await response.json();
        if (data.data && data.data.length > 0) {
            thumbnailUrl = data.data[0].thumbnail_url
                .replace('{width}', '640')
                .replace('{height}', '360')
                + `?rand=${Date.now()}`; // prevent caching
        }
    } catch (e) {
        log('Error: {e}',true);
    }
    return thumbnailUrl;
}

// // Download thumbnail image
// async function downloadImage(url, filepath) {
//     // Fetch thumbnail from Twitch
//     const response = await fetch(url);
//     if(!response.ok) {
//         throw new Error(`Failed to fetch thumbnail image: ${response.statusText}`);
//     }
//     const arrayBuffer = await response.arrayBuffer();
//     const buffer = Buffer.from(arrayBuffer);

//     // Check if images are identical
//     const currentHash = await hashFile(filepath);
//     const newHash = hashBuffer(buffer);

//     // Use new image if hashes are different
//     if(currentHash !== newHash) {
//         log(`New thumbnail detected, saving...`);
//         fs.writeFileSync(filepath, buffer);
//         return true;
//     } else {
//         log(`New thumbnail is identical, skipping import.`);
//         return false;
//     }
// }

// Update/shift thumbnails
async function shiftFetchThumbnails() {
    log('Checking stream status...');

    try {
        const thumbnailUrl = await fetchThumbnail();

        if(!thumbnailUrl) {
            log(`Stream is offline. Update service stopped.`);
            stopThumbnailUpdates();
            return;
        }

        log(`Live stream detected. Updating thumbnails...`);

        const path0min = path.join(workdir, `0min.jpg`);
        const path5min = path.join(workdir, `5min.jpg`);
        const path10min = path.join(workdir, `10min.jpg`);
        const tempPath = path.join(workdir, `temp_now.jpg`);

        // Download new thumbnail to temp
        const response = await fetch(thumbnailUrl);
        if(!response.ok) {
            throw new Error(`Failed to fetch thumbnail: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(tempPath, buffer);

        // Compare the temp file with current 0min.jpg
        const currentHash = await hashFile(path0min);
        const newHash = await hashFile(tempPath);

        if(currentHash !== newHash) {
            log(`New thumbnail detected, performing shift.`);

            // Shift 5min -> 10min
            if (fs.existsSync(path5min)) {
                fs.copyFileSync(path5min, path10min);
            }
            // Shift 0min -> 5min
            if (fs.existsSync(path0min)) {
                fs.copyFileSync(path0min, path5min);
            }
            // Move temp file to 0min
            fs.renameSync(tempPath, path0min);

            log(`Stream thumbnails updated.`);
        } else {
            log(`Thumbnail unchanged, skipping shift.`);
        }
        
        //log(`Stream thumbnails updated.`);
    } catch (e) {
        console.error('Error updating thumbnails:', e.message);
    }
}

// Thumbnail update process
function startThumbnailUpdates() {
    if(thumbnailUpdater) {
        log(`Update service already running.`);
        return;
    }
    log(`Begin thumbnail updates...`);

    // Initialize all 3 thumbnails
    const placeholderPath = path.join(workdir, `placeholder.jpg`);
    fs.copyFileSync(placeholderPath, path.join(workdir, '0min.jpg'));
    fs.copyFileSync(placeholderPath, path.join(workdir, '5min.jpg'));
    fs.copyFileSync(placeholderPath, path.join(workdir, '10min.jpg'));
    log(`Initialization complete.`);
    
    // Begin
    shiftFetchThumbnails();
    thumbnailUpdater = setInterval(shiftFetchThumbnails, 5 * 60 * 1000);
}

// Stop update process
function stopThumbnailUpdates() {
    if(thumbnailUpdater) {
        clearInterval(thumbnailUpdater);
        thumbnailUpdater = null;
        log(`Update process stopped.`);

        // Reset thumbnails
        const placeholderPath = path.join(workdir, `placeholder.jpg`);
        fs.copyFileSync(placeholderPath, path.join(workdir, '0min.jpg'));
        fs.copyFileSync(placeholderPath, path.join(workdir, '5min.jpg'));
        fs.copyFileSync(placeholderPath, path.join(workdir, '10min.jpg'));
        log(`Thumbnail previews reset.`);
    } else {
        log(`Service is not running.`);
    }
}

// ENDPOINTS
// Grab live data
router.post('/live-data', async (req, res) => {    
    log('ENDPOINT: /live-data ');
    const liveData = await getLiveData();
    res.status(200).json(liveData);
});

// Start live update service
router.post(`/live-update/start`, (req, res) => {
    startThumbnailUpdates();
    res.send(`Update service started.`);
});

// Stop live update service
router.post(`/live-update/stop`, (req, res) => {
    stopThumbnailUpdates();
    res.send(`Update service stopped.`);
});

module.exports = router;
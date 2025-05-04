/* the13thgeek: MAINFRAME ROUTING */

const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
require('dotenv').config();

// Shared DB connection pool
const dbPool = mysql.createPool({
    host: process.env.GEEKHUB_DB_ENDPOINT,
    user: process.env.GEEKHUB_DB_USER,
    password: process.env.GEEKHUB_DB_PASS,
    database: process.env.GEEKHUB_DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
    keepAliveInitialDelay: 10000,
    enableKeepAlive: true,
    queueLimit: 0
});

// MAINFRAME GLOBALS
let exp_standard = 1.0;
let exp_premium = 1.15;
let exp_global = 1.0;

// TOURNAMENT TEAMS
const TEAM_NAMES = {
    1: 'Afterburner',
    2: 'Concorde',
    3: 'Stratos'
}

// FUNCTIONS

// DB Helper Function
async function execQuery(query, params = []) {
    let conn;
    try {
        conn = await dbPool.getConnection();

        try {
            await conn.ping();
        } catch(pingError) {
            console.warn(`Stale connection, reconnecting...`);
            conn.release();
            conn = await dbPool.getConnection();
        }
        const [result] = await conn.execute(query, params);
        return result;
    } catch(e) {
        console.error(`execQuery(): ERROR: ${e.message}`);
        console.error(`query: ${query}`);
        console.error(`params: ${params}`);
        return null;
    } finally {
        if(conn) conn.release();
    }
}

// Get Player Level, Title and Progression
function getPlayerLevel(exp) {
    let playerLevels = require(`../data/levels.json`);
    let currentLevel = playerLevels[0];
    let nextLevel = null;

    for(let i = 0; i<playerLevels.length; i++) {
        if (exp < playerLevels[i].exp) {
            nextLevel = playerLevels[i];
            break;
        }
        currentLevel = playerLevels[i];
    }

    const progressLevel = nextLevel ? ((exp - currentLevel.exp) / (nextLevel.exp - currentLevel.exp)) * 100 : 100;

    return {
        level: currentLevel.level,
        title: currentLevel.title,
        progressLevel: progressLevel
    }
}

// For testing
async function test() {
    //console.log('TEST activated.');
    let rows = null;
    try {      
        rows = await execQuery(
            "SELECT * FROM tbl_users WHERE is_active = 1 ORDER BY last_login DESC, last_activity DESC LIMIT 5",
        );
    } catch (e) {
        console.error(`test(): ERROR: ${e.message}`);
    } 
    return rows;
}

// Load user data by local ID
async function getUserDataById(user_id) {
    let user = null;

    if(!user_id) return null;

    try {        
        let usrData = await execQuery("SELECT * FROM tbl_users WHERE id = ?", [user_id]);
        user = usrData[0];
        
        let playerData = getPlayerLevel(user.exp);

        // Append player info to user data
        user.level = playerData.level;
        user.title = playerData.title;
        user.levelProgress = parseInt(playerData.progressLevel.toFixed());

        // Append user card data
        let cardData = await getUserCards(user.id);
        //user.isPremium = is_premium;
        user.cards = cardData.cards;
        user.card_default = cardData.default;
        user.stats = await getUserStats(user.id);
        user.achievements = await getUserAchievements(user.id);

        // Append team info
        const [userTeam] = await execQuery(`SELECT team_number FROM tbl_tourney WHERE user_id = ? LIMIT 1`,[user.id]);        
        if(userTeam) {
            user.team = TEAM_NAMES[userTeam.team_number];
        } else {
            user.team = null;
        }

    } catch(e) {
        user = null;    
        console.error(`getUserData(): ERROR: ${e.message}`);
        throw e;
    } 
    return user;
}

// Load user data using Twitch ID
// Register locally if user doesn't exist yet
async function getUserData(twitch_id, twitch_display_name, twitch_avatar, is_premium = null) {
    let user = null;
    let ip_val = null;
    if(is_premium != null) {
        ip_val = is_premium ? 1 : 0;
    }   

    if( !twitch_id || !twitch_display_name) {
        //console.log(`getUserData(): Invalid user data. BYPASS`);
        return user;
    }

    console.log(`getUserData(): TID: ${twitch_id}, TDN: ${twitch_display_name}, TA: ${twitch_avatar} IP: ${is_premium}`);

    try {
        const usrData = await execQuery("SELECT * FROM tbl_users WHERE twitch_id = ?", [twitch_id]);

        if(usrData.length > 0) {
            // User exists, update login
            //console.log(`getUserData(): User ${twitch_id} exists.`)
            user = usrData[0];
            if(is_premium != null) {
                const updateUser = await execQuery("UPDATE tbl_users SET twitch_display_name = ?, twitch_avatar = ?, is_premium = ?, last_activity = CURRENT_TIMESTAMP() WHERE id = ?",[twitch_display_name,twitch_avatar,ip_val,user.id]);
            } else {
                // ignore is_premium if param isn't provided
                const updateUser = await execQuery("UPDATE tbl_users SET twitch_display_name = ?, twitch_avatar = ?, last_activity = CURRENT_TIMESTAMP() WHERE id = ?",[twitch_display_name,twitch_avatar,user.id]);
            }
            
        } else {
            // User does not exist on local DB, create
            //console.log(`getUserData(): User [${twitch_id},${twitch_display_name}] not locally registered.`)
            if(is_premium != null) {
                user = await registerUser(twitch_id,twitch_display_name,twitch_avatar,ip_val);
            } else {
                user = await registerUser(twitch_id,twitch_display_name,twitch_avatar,0);
            }
            
        }        
        let playerData = getPlayerLevel(user.exp);

        // Append player info to user data
        user.level = playerData.level;
        user.title = playerData.title;
        user.levelProgress = parseInt(playerData.progressLevel.toFixed());

        // Append user card data
        let cardData = await getUserCards(user.id,is_premium);
        //user.isPremium = is_premium;
        user.cards = cardData.cards;
        user.card_default = cardData.default;

        // Append stats/achievements
        user.stats = await getUserStats(user.id);
        user.achievements = await getUserAchievements(user.id);


        // Append team info
        const [userTeam] = await execQuery(`SELECT team_number FROM tbl_tourney WHERE user_id = ? LIMIT 1`,[user.id]);        
        if(userTeam) {
            user.team = TEAM_NAMES[userTeam.team_number];
        } else {
            user.team = null;
        }
        
        ////console.log(user);

    } catch(e) {
        user = null;    
        console.error(`getUserData(): ERROR: ${e.message}`);
        throw e;
    } 
    return user;
}

// Register user to local DB
async function registerUser(twitch_id,twitch_display_name,twitch_avatar,is_premium) {
    let user = null;

    try {    
        // register
        const addUser = await execQuery("INSERT INTO tbl_users(twitch_id, twitch_display_name, twitch_avatar, is_premium) VALUES(?,?,?,?)", [twitch_id,twitch_display_name,twitch_avatar,is_premium]);
        // get newly-inserted item
        const newUser = await execQuery("SELECT * FROM tbl_users WHERE id = ?",[addUser.insertId])
        user = newUser[0];
        //console.log(`registerUser(): Twitch ID ${twitch_id} -> ${user.id}`);
    } catch(e) {
        console.error(`registerUser(): ERROR: ${e.message}`);
    }
    return user;
}

// Get all cards issued to the user
async function getUserCards(user_id, is_premium = false) {
    //console.log(`getUserCards(${user_id},${is_premium})`);
    let user_cards = {
        cards: [],
        default: null
    };

    try {
        // Query all assigned cards
        const queryCards = await execQuery(`SELECT c.*, uc.user_id, uc.is_default, uc.card_id
            FROM tbl_cards c
            INNER JOIN tbl_user_cards uc ON c.id = uc.card_id
            WHERE uc.user_id = ?
            ORDER BY
            CASE 
                WHEN LEFT(c.catalog_no, 2) IN ('GX', 'EX', 'SP') THEN 1
                WHEN LEFT(c.catalog_no, 2) IN ('RG', 'RP') THEN 2
                ELSE 3
            END,
            c.is_premium DESC,
            c.catalog_no,
            c.name;`,[user_id]);
        user_cards.cards = queryCards;
        ////console.log(user_cards.cards);

        // If cards are empty, issue their first one
        if(queryCards.length === 0) {
            // Issue a Premium Card (via Twitch)
            if(is_premium) {
                const [queryIssueCard] = await execQuery("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,2,1]);
            } else {
                const [queryIssueCard] = await execQuery("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,1,1]);
            }
            // Re-query
            const queryCards = await execQuery("SELECT * FROM tbl_cards c INNER JOIN tbl_user_cards uc ON c.id = uc.card_id WHERE uc.user_id = ?",[user_id]);
            user_cards.cards = queryCards;
        } else {
            // This is for users checking in from Twitch Chat.
            // Because the Hub website does not support is_premium,
            // Premium users may have been initially issued a Standard card.
            // This is for validation
            if(is_premium) {
                // Check if user already has a Premium card issued previously.
                const queryPremium = await execQuery("SELECT * FROM tbl_user_cards WHERE user_id = ? and card_id = ?",[user_id,2]);
                if(queryPremium.length === 0) {
                    // Issue a Premium card and set it to user's default
                    const queryUntoggleCards = await execQuery("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id]);
                    const queryIssueCard = await execQuery("INSERT INTO tbl_user_cards(user_id,card_id,is_default) VALUES(?,?,?)",[user_id,2,1]);
                }
            }
        }

        // Get active card
        const queryActiveCard = await execQuery("SELECT * FROM tbl_cards c INNER JOIN tbl_user_cards uc ON c.id = uc.card_id WHERE uc.user_id = ? AND uc.is_default = 1",[user_id]);
        user_cards.default = queryActiveCard[0];
        //console.log("getUserCards(): " + queryCards.length);

    } catch(e) {
        console.error(`getUserCards(): ERROR: ${e.message}`);
        throw e;
    } 
    return user_cards;
}

// Get local user ID by Twitch ID
async function getLocalId(twitch_id) {
    let output = null;

    try {
        const result = await execQuery("SELECT id FROM tbl_users WHERE twitch_id = ?",[twitch_id]);

        if(result.length > 0) {
            // user is registered
            output = result[0].id;
        }
    } catch(e) {
        console.error(`getLocalId(): ERROR: ${e.message}`);
    }
    //console.log(`getLocalId(): ${twitch_id} -> ${output}`);
    return output;
}

// Check if user is Premium
function isUserPremium(roles) {
    let output = false;
    if(roles) {
        if(roles.includes('VIP') || roles.includes('Subscriber') || roles.includes('Artist') || roles.includes('Moderator')) {
            output = true;
        }
    }
    return output;
}

// For Rankings
async function getRanking(rank_type,items_to_show) {
    let output = null;
    let query = "";

    items_to_show = items_to_show || 5;

    switch(rank_type) {
        case 'exp':
            query = `SELECT u.id, u.twitch_display_name, u.twitch_avatar, u.exp, u.is_premium, u.exp as 'value', c.sysname, c.name AS active_card
                FROM tbl_users u
                JOIN  tbl_user_cards uc ON u.id = uc.user_id
                JOIN tbl_cards c ON uc.card_id = c.id
                WHERE u.id NOT IN (1,2) AND uc.is_default = 1 AND (u.last_activity >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
                ORDER BY u.exp DESC LIMIT ${items_to_show}`;
            break;
        case 'spender':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', u.is_premium, s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'points_spend' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        case 'redeems':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', u.is_premium, s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'redeems_count' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        case 'checkins_last':
            query = `select id, twitch_display_name, twitch_avatar, exp, is_premium, last_checkin AS 'value' FROM tbl_users WHERE id NOT IN (1,2) order by last_checkin desc LIMIT ${items_to_show}`;
            break;
        case 'checkins':
            query = `select u.id AS 'id',u.twitch_display_name AS 'twitch_display_name', u.twitch_avatar as 'twitch_avatar', u.exp as 'exp', u.is_premium, s.stat_value AS 'value' from tbl_users u join tbl_user_stats s where u.id = s.user_id and s.stat_key = 'checkin_count' and u.id NOT IN (1,2) order by stat_value desc LIMIT ${items_to_show}`;
            break;
        case 'achievements':
            query = `SELECT u.id, u.twitch_avatar, u.twitch_display_name, u.exp, u.is_premium, a.name as 'ach_name', a.tier, a.sysname as 'ach_sysname', ua.achieved_at 
                FROM tbl_user_achievements ua, tbl_users u, tbl_achievements a
                WHERE ua.user_id = u.id AND ua.achievement_id = a.id AND u.id NOT IN (1,2)
                ORDER BY ua.achieved_at DESC LIMIT ${items_to_show}`;
            break;
        default:
            break;
    }

    if(!query) { return null;} 

    try {
        const rankData = await execQuery(query);
        output = rankData;
        
        // Append level data
        // Append team data
        for(let i = 0; i < output.length; i++) {
            let playerData = getPlayerLevel(output[i].exp);
            output[i].level = playerData.level;
            output[i].title = playerData.title;
            output[i].levelProgress = parseInt(playerData.progressLevel);

            let [userTeam] = await execQuery(`SELECT team_number FROM tbl_tourney WHERE user_id = ? LIMIT 1`,[output[i].id]);        
            if(userTeam) {
                output[i].team = TEAM_NAMES[userTeam.team_number];
            } else {
                output[i].team = null;
            }
        }
    } catch(e) {
        console.error(`getRanking(): ERROR: ${e.message}`);
    }
    return output;
}

// For list of available cards
async function getAvailableCards() {
    let output = null;
    try {
        const cardList = await execQuery("SELECT id, name, catalog_no, sysname, is_premium, is_event, is_rare, is_new FROM tbl_cards WHERE id > 0 AND is_pull = 1 AND is_active = 1 ORDER BY is_premium DESC, is_new DESC, catalog_no");
        if(cardList.length > 0) {
            output = cardList;
        }
    } catch(e) {
        console.error(`getAvailableCards(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// For card gacha pulls
async function doGachaPull(is_premium) {
    let selectedCard = null;

    try {
        let card_query = null;
        // Get all cards in active circulation
        if(is_premium) {
            //console.log(`doGachaPull(): Selecting Premium cards for pull.`);
            card_query = "SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_pull = 1";
        } else {
            //console.log(`doGachaPull(): Selecting Standard cards for pull.`);
            card_query = "SELECT * FROM tbl_cards WHERE spawn_rate IS NOT NULL AND is_premium = 0 AND is_pull = 1";
        }
        const activeCards = await execQuery(card_query);
        //console.log(`doGachaPull(): ${activeCards.length} card(s) available for pulls.`);
        
        if(activeCards.length < 1) {
            throw new Error("There are no cards available for this pull.");
        }

        // Perform pull based on weight (spawn_rate)
        selectedCard = weightedRandom(activeCards);

    } catch(e) {
        console.error(`doGachaPull(): ERROR: ${e.message}`);
        throw e;
    }
    return selectedCard;
}

// Gacha pull mechanic
function weightedRandom(cards) {
    // Calculate total spawn rate
    const totalRate = cards.reduce((sum, card) => sum + card.spawn_rate, 0);
    // RNG
    const random = Math.random() * totalRate;
    let cumulativeRate = 0;
    for(const card of cards) {
        cumulativeRate += card.spawn_rate;
        if(random <= cumulativeRate) {
            //console.log(`doGachaPull(): Pull result -> ${card.sysname}`);
            return card; // Draw this card
        }
    }
    // Fallback
    return cards[cards.length - 1];
}

// Assign card to user
async function addCardToUser(user_id,card_id) {
    let output = false;
    try {
        // Check if user already owns card
        const existingCard = await execQuery("SELECT COUNT(*) as count FROM tbl_user_cards WHERE user_id = ? AND card_id = ?",[user_id,card_id]);
        const count = existingCard[0].count;
        if(count === 0 && card_id > 0)  { // Do not issue Card #0 (Try Again)
            // untoggle is_default to current user's cards
            const untoggle = await execQuery("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id])
            // add card to user
            const issueCard = await execQuery("INSERT INTO tbl_user_cards(user_id,card_id,is_default) values(?,?,?)",[user_id,card_id,1]);
            output = true;
        }

    } catch(e) {
        console.error(`addCardToUser(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Change user's active card
async function setActiveCard(user_id,card_id) {
    //console.log(`setActiveCard(${user_id}->${card_id})`);
    let output = false;

    try {
        // untoggle is_default to current user's cards
        const untoggle = await execQuery("UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?",[user_id,])
        // set default card to specified card_id
        const issueCard = await execQuery("UPDATE tbl_user_cards SET is_default = 1 WHERE user_id = ? AND card_id = ?",[user_id,card_id]);
        output = true;
    } catch(e) {
        console.error(`setActiveCard(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Issue EXP to user
async function setExp(user_id,is_premium,exp) {
    //console.log("setExp():");
    let output = false;
    let issued_exp = 0;

    // Calculate EXP based on user level
    if(is_premium) {
        issued_exp = exp * exp_premium;
    } else {
        issued_exp = exp * exp_standard;
    }

    // Add global EXP multipliers
    issued_exp = issued_exp * exp_global;
    ////console.log(`setExp(): U#${user_id} ->E+ ${issued_exp}`);
    try {
        const setExpUser = await execQuery("UPDATE tbl_users SET exp = (exp + ?) WHERE id = ?",[issued_exp,user_id]);
        output = true;
    } catch(e) {
        output = false;
        console.error(`setExp(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Update user timestamps (stream check-in/web login)
async function updateUserTimestamp(user_id,field_name) {
    // console.log(`updateUserTimestamp()`);
    let output = false;
    try {        
        if(field_name === "last_login") {
            const userTimestamp = await execQuery("UPDATE tbl_users set last_login = CURRENT_TIMESTAMP WHERE id = ?",[user_id]);
            output = true;
        } else if(field_name === "last_checkin") {
            const userTimestamp = await execQuery("UPDATE tbl_users set last_checkin = CURRENT_TIMESTAMP WHERE id = ?",[user_id]);
            output = true;
        }
    } catch(e) {
        output = false;
        console.error(`updateUserTimestamp(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Stats Collection
async function setStats(user_id,stat_name,value,increment) {
    //console.log(`setStats(): U#${user_id} SN:${stat_name}`);
    let output = false;
    try {
        let query = "";
        if(increment) {
            query = "INSERT INTO tbl_user_stats(user_id,stat_key,stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = stat_value + ?";
        } else {
            query = "INSERT INTO tbl_user_stats(user_id,stat_key,stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = ?";
        }
        const setStatData = await execQuery(query,[user_id,stat_name,value,value]);
        output = true;
    } catch(e) {
        output = false;
        console.error(`setStats(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Get user stats
async function getUserStats(user_id) {
    //console.log(`getUserStats(): U#${user_id}`);
    let output = null;

    try {    
        const userStatQ = await execQuery("SELECT * FROM tbl_user_stats WHERE user_id = ?",[user_id]);

        let stats = {};
        userStatQ.forEach(row => {
            stats[row.stat_key] = row.stat_value;
        });
        output = stats;
    } catch(e) {
        output = false;
        console.error(`getUserStats(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

async function getUserAchievements(user_id) {
    console.log(`getUserAchievements(): U#${user_id}`);
    let output = null;
    
    try {
        const achievementList = await execQuery("SELECT a.name AS achievement_name, a.sysname AS sysname, MAX(a.tier) AS achievement_tier, a.description AS `description`, ua.achieved_at FROM tbl_user_achievements ua JOIN tbl_achievements a ON ua.achievement_id = a.id WHERE ua.user_id = ? GROUP BY a.sysname ORDER BY ua.achieved_at DESC, a.name, a.tier DESC",[user_id]);
        output = achievementList;
    } catch(e) {
        output = false;
        console.error(`getUserAchievements(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Achievement checking/awarding
async function checkAchievements(user_id,stat_name) {
    //console.log("checkAchievements():");
    let output = null;

    try {
        const checkQuery = await execQuery(
            `SELECT a.id, a.name, a.tier
            FROM tbl_achievements a
            LEFT JOIN tbl_user_achievements ua 
                ON a.id = ua.achievement_id AND ua.user_id = ?
            WHERE a.stat_key = ?
                AND a.threshold <= (
                    SELECT stat_value 
                    FROM tbl_user_stats 
                    WHERE user_id = ? AND stat_key = ?
                )
            AND ua.achievement_id IS NULL`,
            [user_id,stat_name,user_id,stat_name]);
        
        if(checkQuery.length > 0) {
            let achList = [];
            // Award to user            
            for(let item of checkQuery) {
                const addAchievement = await execQuery(`INSERT INTO tbl_user_achievements(user_id,achievement_id) VALUES(?,?)`,[user_id,item.id]);
                achList.push(item.name + ' ' + item.tier);
            }

            output = achList.join(", ");
        }
    } catch(e) {
        output = null;
        console.error(`setStats(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Register a user to a team
async function registerUserTeam(user_id) {
    console.log(`registerUserTeam(): U#${user_id}`);
    let output = null;
    
    try {
        // Check if user is already registered
        const checkReg = await execQuery('SELECT team_number FROM tbl_tourney WHERE user_id = ?',[user_id]);
        if(checkReg.length > 0) {
            const teamNum = checkReg[0].team_number;
            output = `You're already registered! You're part of Team ${TEAM_NAMES[teamNum]}!`;
        } else {
            // Otherwise, check which team needs a member (for balancing)
            const teamCounts = await execQuery(`SELECT t.team_number, COUNT(m.user_id) AS count
            FROM (
                SELECT 1 AS team_number
                UNION ALL
                SELECT 2
                UNION ALL
                SELECT 3
            ) AS t
            LEFT JOIN tbl_tourney m ON t.team_number = m.team_number
            GROUP BY t.team_number`);
            // Find minimum count
            const minCount = Math.min(...teamCounts.map(team => team.count))
            // Get teams with minimum count members
            const hiringTeams = teamCounts.filter(team => team.count === minCount).map(team => team.team_number);
            const nextTeam = hiringTeams[Math.floor(Math.random() * hiringTeams.length)];
            // Register
            const regUserDb = await execQuery("INSERT INTO tbl_tourney(user_id,team_number) VALUES (?,?)",[user_id, nextTeam]);
            output = `You have been registered for Team ${TEAM_NAMES[nextTeam]}!`;
        }

    } catch(e) {
        output = false;
        console.error(`getUserAchievements(): ERROR: ${e.message}`);
        throw e;
    }
    return output;
}

// Load catalog of card designs
async function getCatalog() {
    let output = null;

    try {
        const cardCatalog = await execQuery(
            `SELECT *,
            DATE_FORMAT(created, '%b %Y') as 'release'
            FROM tbl_cards
            WHERE id > 0 AND is_active = 1
            ORDER BY
            CASE 
                WHEN LEFT(catalog_no, 2) IN ('SP','GX','EX') THEN 1
                WHEN LEFT(catalog_no, 2) IN ('RG', 'RP') THEN 2
                ELSE 3
            END,
            is_premium DESC,
            catalog_no DESC,
            name;`
        );
        output = cardCatalog;
    } catch(e) {
        output = null;
        console.error(`getCatalog(): ERROR: ${e.message}`);
        throw e;
    }
    return output; 

}

// ENDPOINTS

// Testing
router.post('/test', async (req, res) => {
    //console.log('ENDPOINT: /test ');
    const data = await test();
    res.status(200).json(data);
});

// Login/Registration
// router.post('/usrlogin', async (req, res) => {    
//     //console.log('ENDPOINT: /usrlogin');
//     let twitch_id = req.query.twitch_id;
//     let twitch_displayname = req.query.twitch_displayname;
//     const user = await getUserData(twitch_id,twitch_displayname);
//     res.status(200).json(user);
// });

// Login/Registration via Hub Widget
router.post('/login-widget', async (req,res)=> {
    //console.log('ENDPOINT: /login-widget');
    const { twitch_id, twitch_display_name, twitch_avatar } = req.body;
    const user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
    let tstamp_q = await updateUserTimestamp(user.id,'last_login');
    //const stats = await getUserStats(user.id);
    res.status(200).json({
        local_id: user.id,
        avatar: user.twitch_avatar,
        user_card: user.card_default,
        user_cards: user.cards,
        exp: user.exp,
        is_premium: user.is_premium,
        level: user.level,
        title: user.title,
        level_progress: user.levelProgress,
        stats: user.stats,
        achievements: user.achievements,
        team: user.team
    });
});

// Ranking
router.post('/ranking', async (req, res) => {
    //console.log('ENDPOINT: /ranking');
    const { rank_type, items_to_show } = req.body;

    const rankData = await getRanking(rank_type, items_to_show);
    res.status(200).json(rankData);
});

// Gacha pull
router.post('/gacha', async (req, res) => {
    //console.log('ENDPOINT: /gacha');
    let output = {
        status: false,
        message: "",
        output_card_name: null,
        card_name: null
    };

    try {
        const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar } = req.body;
        const is_premium = isUserPremium(twitch_roles);
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
        let newCard = await doGachaPull(is_premium);
        let cardIssued = await addCardToUser(user.id, newCard.id);

        // update stats
        // moving this to client-side
        // let stats_q = await setStats(user.id,'card_gacha_pulls',1,true);

        output = {
            status: true,
            message: `You have pulled a ${newCard.is_premium ? "Premium" : ""} [${newCard.name}] Card!`,
            output_card_name: newCard.sysname,
            card_name: user.card_default.sysname
        }

        if(cardIssued) {
            let stats_q = await setStats(user.id,'card_gacha_pulls_success',1,true);
            output.message += ` Congrats! Your new card will now show on your next sign-in!`;
            output.card_name = newCard.sysname;
        } else {
            output.status = false;
            if(newCard.sysname === 'try-again') {
                output.message = `Sorry! Try again!`;
            } else {
                output.message += ` You already have this card.`;
            }
        }        
    } catch(e) {
        console.error(`/gacha: ERROR: ${e.message}`);
        output.status = false;
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.output_card_name = null,
        output.card_name = null;
    }
    res.status(200).json(output);
});

// Check-in
router.post('/check-in', async (req, res) => {
    console.log('ENDPOINT: /check-in');
    const { twitch_id, twitch_display_name, twitch_avatar, twitch_roles, checkin_count } = req.body;
    const is_premium = isUserPremium(twitch_roles);
    let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
    let has_achievement = false;
    let achievement = null;

    // issue EXP
    let exp_q = await setExp(user.id,is_premium,1);
    // update stats
    let stats_q = await setStats(user.id,'checkin_count',checkin_count,false);
    let tstamp_q = await updateUserTimestamp(user.id,'last_checkin');
    // Check/award achievements
    achievement = await checkAchievements(user.id,'checkin_count');
    if(achievement) { 
        has_achievement = true;
    }

    res.status(200).json({
        twitch_id: user.twitch_id,
        local_id: user.id,
        level: user.level,
        is_premium: is_premium,
        default_card_name: user.card_default.sysname,
        default_card_title: (user.card_default.is_premium ? "Premium " : "") + user.card_default.name,
        has_achievement: has_achievement,
        achievement: achievement
    });
});

// Retrieve user profile by ID
router.post('/user-profile', async (req, res) => {
    const { user_id } = req.body;
    let user = await getUserDataById(user_id);

    res.status(200).json(user);
});

// Get user's stats by ID 
router.post('/user-stats', async (req, res) => {
    const { user_id } = req.body;
    let user_stats_result = await getUserStats(user_id);    
    res.status(200).json(user_stats_result);
});

// Change active card via theMainframe
router.post('/change-card-site', async (req, res)=> {
    //console.log('ENDPOINT: /change-card-site');
    const { user_id, card_id } = req.body;
    let output = {
        status: false,
        message: "",
    }

    // find card in user's data
    let user = await getUserCards(user_id);
    let is_card_present = false;
    let new_active_card = null;

    for(let card of user.cards) {
        if(card.card_id === card_id) {
            is_card_present = true;
            new_active_card = card;
        }
    }

    if(is_card_present) {
        if(setActiveCard(user_id,card_id)) {
            output.status = true;
            output.message = `You are now using your ${new_active_card.is_premium ? 'Premium ' : ''}${new_active_card.name} Card as your active card!`;
            output.new_card = new_active_card.sysname;
        } else {
            output.message = `Sorry, something went wrong. Please inform the streamer right away.`;
        }
    } else {
        output.status = false;
        output.message = `I couldn't find this card in your Frequent Flyer membership. Please double-check and try again.`;
    }

    res.status(200).json(output);

});

// Change active card
router.post('/change-card', async (req, res) => {
    //console.log('ENDPOINT: /change-card');
    const { twitch_id, twitch_display_name, twitch_avatar, new_card_name } = req.body;
    let output = {
        status: false,
        message: "",
    }

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        let is_card_present = false;
        let new_active_card = null;

        ////console.log(user.cards);

        // find card in user's data
        for(let card of user.cards) {
            //console.log(`Checking ${new_card_name} -> ${card.sysname}`);
            if (new_card_name === card.sysname) {
                //console.log(`Card found.`);
                is_card_present = true;
                new_active_card = card;
                //console.log(new_active_card);
                break;
            }
        }
        if(user.card_default.sysname === new_card_name) {
            output.status = false;
            output.message = "You're already using this card :)";
        } else if(is_card_present) {
            if(setActiveCard(user.id,new_active_card.card_id)) {
                output.status = true;
                output.message = `You are now using your ${new_active_card.is_premium ? 'Premium ' : ''}${new_active_card.name} Card as your active card!`;
                output.new_card = new_active_card.sysname;
            } else {
                output.message = `Sorry, something went wrong. Please inform the streamer right away.`;
            }
        } else {
            output.status = false;
            output.message = `I couldn't find this card in your Frequent Flyer membership. Type !getcards and try again.`;
        }
        
    } catch(e) {
        console.error(`/change-card: ERROR: ${e.message}`);
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.status = false;
    }
    res.status(200).json(output);
});

// Get cards keyword list
router.post('/get-cards', async (req, res) => {
    //console.log('ENDPOINT: /get-cards');
    const { twitch_id, twitch_display_name, twitch_avatar } = req.body;
    let message = "";
    let status = false;

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        if (user) {
            if(user.cards.length > 1) {
                let cards_list = [];
                for(let card of user.cards) {
                    cards_list.push(card.sysname);
                }
                message += `You have (${user.cards.length}) cards: [${cards_list.toString().replace(",",", ")}]. To change your active card, type !setcard <keyword> in chat!`;
            } else if(user.cards.length === 1) {
                message += `You have the [${user.cards[0].sysname}] Card. To collect more cards, try your luck at the Mystery Card Pull redeem!`;
            } else {
                message += `It looks like you're not registered to our Frequent Flyer Program yet.`;
            }
        }
        status = true;

    } catch(e) {
        console.error(`/get-cards: ERROR: ${e.message}`);
        message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        status = false;
    } finally {
        res.status(200).json({
            status: status,
            message: message
        });
    }
});

// Get list of cards available for pull
router.post('/get-available-cards', async (req, res) => {
    let message = "";
    let status = false;
    let list = null;

    try {
        list = await getAvailableCards();
        if(list.length > 0) {
            status = true;
            message = "OK";
        }
    } catch(e) {
        console.error(`/get-available-cards: ERROR: ${e.message}`);
        message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        status = false;
    }
    res.status(200).json({ status: status, message: message, list: list });
});

// Get catalog of cards
router.post('/catalog', async (req, res) => {
    //console.log(`ENDPOINT: /catalog`);
    let message = "";
    let status = false;
    let catalog = null;

    try {
        catalog = await getCatalog();
        if(catalog) {
            message = "OK";
            status = true;  
        }
    } catch(e) {
        console.error(`/catalog: ERROR: ${e.message}`);
        message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        status = false;
    }
    res.status(200).json({ status: status, message: message, catalog: catalog });
});

// Open third-party endpoint
router.get('/supersonic', async (req,res) => {
    // Receive data
    const { u, c } = req.query;
    // Check for both names
    if(!u || !c) {
        return res.send(`Sorry, couldn't finish your request due to missing parameters.`);
    }

    try {
        // Lookup user IDs
        const [viewerRes] = await execQuery(`SELECT id FROM tbl_users WHERE twitch_display_name = ?`,[u]);
        const [streamerRes] = await execQuery(`SELECT id FROM tbl_users WHERE twitch_display_name = ?`,[c]);

        if(!viewerRes) {
            return res.send(`Sorry @${u}, I can't find your profile in the Mainframe database. 😭`);
        }
        if(!streamerRes) {
            return res.send(`Sorry @${c}, I can't find your profile in the Mainframe database. 😭`);
        }

        const viewerId = viewerRes.id;
        const streamerId = streamerRes.id;

        // Test captured IDs
        //return res.send(`U [${u}][${viewerId}] via [${c}][${streamerId}]`);

        // Check if viewer is on a team
        const [viewerTeamRes] = await execQuery(`SELECT team_number FROM tbl_tourney WHERE user_id = ?`,[viewerId]);
        const [streamerTeamRes] = await execQuery(`SELECT team_number FROM tbl_tourney WHERE user_id = ?`,[streamerId]);
        if(!viewerTeamRes) {
            return res.send(`Sorry @${u}, it looks like you're not registered for this event yet. 😭`);
        }
        if(!streamerTeamRes) {
            return res.send(`Sorry @${c}, it looks like you're not registered for this event yet 😭`);
        }
        const viewerTeam = TEAM_NAMES[viewerTeamRes.team_number];
        const streamerTeam = TEAM_NAMES[streamerTeamRes.team_number];

        // Issue points to viewer
        await execQuery(`UPDATE tbl_tourney SET points = points +2 WHERE user_id = ?`,[viewerId]);
        // Issue points to streamer
        await execQuery(`UPDATE tbl_tourney SET points = points +1 WHERE user_id = ?`,[streamerId]);

        return res.send(`Hey @${u}, you got your points for Team ${viewerTeam}! Thank you for supporting @${c}'s channel! ❤️`);

    } catch(e) {
        console.error('Communication error: ',e);
        return res.send(`An error has occurred.`);
    }


    //return res.send(`Hello ${u} watching from ${c}'s channel! 😁`);
});

// // Issue EXP
// router.post('/exp', async (req,res) => {
//     //console.log('ENDPOINT: /exp');
//     const { twitch_id, twitch_display_name, twitch_avatar, twitch_roles, exp } = req.body;
//     const is_premium = isUserPremium(twitch_roles);
//     let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
//     let result = false;

//     if(user) {
//         result = await setExp(user.id,is_premium,exp);
//     }

//     if(result) {
//         res.status(200).json({ status: result, message: 'EXP updated.' });
//     } else {
//         res.status(200).json({ status: result, message: 'EXP error.' });
//     }
// });

// Perform action
// Merged /exp and /stat-update
// Also returns achievements if any
router.post('/send-action', async (req,res) => {
    console.log(`ENDPOINT: /send-action`);
    console.log(req.body);
    const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar, exp, stat_name, value, increment } = req.body;
    const is_premium = isUserPremium(twitch_roles);
    let output = {
        status: false,
        message: '',
        has_achievement: false,
        achievement: ''
    };

    try {
        let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
        if(user) {
            if(exp) {
                result_exp = await setExp(user.id,is_premium,exp);
                //console.log('EXP issued');
            }
            if(stat_name && stat_name.length > 0) {
                let achList = [];
                for(let i = 0; i<stat_name.length; i++) {
                    result_stats = await setStats(user.id,stat_name[i],value[i],increment[i]);
                    let ach = await checkAchievements(user.id,stat_name[i]);
                    if(ach) {
                        achList.push(ach);
                    }
                }
                output.achievement = achList.join(", ");
                //console.log('STAT update');
            }
            output.status = true;
        }

        if(output.achievement) {
            output.message = `Congrats! You have earned these achievements: ${output.achievement}`;
            output.has_achievement = true;            
        } else {
            output.message = `Stat [${stat_name}] updated.`;
        }

    } catch(e) {
        console.error(`/send-action: ERROR: ${e.message}`);
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.status = false;
    }
    
    res.status(200).json(output);
});

// Register for a team
router.post('/team-register', async (req, res) => {
    console.log(`ENDPOINT: /team-register`);
    const { twitch_id, twitch_display_name, twitch_roles, twitch_avatar } = req.body;
    const is_premium = isUserPremium(twitch_roles);
    let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar,is_premium);
    let output = {
        status: false,
        message: null
    }
    try {
        output.message = await registerUserTeam(user.id);
        output.status = true;
    } catch(e) {
        console.error(`/team-register: ERROR: ${e.message}`);
        output.message = `Sorry, I encountered a problem. Please inform the streamer right away.`;
        output.status = false;
    }
    res.status(200).json(output);
});

// // Update stats
// router.post('/stat-update', async (req,res) => {
//     //console.log('ENDPOINT: /stat-update');
//     ////console.log(req.body);
//     const { twitch_id, twitch_display_name, twitch_avatar, stat_name, value, increment } = req.body;
//     let user = await getUserData(twitch_id,twitch_display_name,twitch_avatar);
//     let result = false;
//     let has_achievement = false;
//     let message = "";
    
//     // Update Stats
//     if(user) {
//         result = await setStats(user.id,stat_name,value,increment);
//     }

//     if(result) {
//         // Check and issue achievements
//         let achievements = await checkAchievements(user.id,stat_name);
        
//         if(achievements) {
//             let ach_list = [];
//             for(let ach of achievements) {
//                 ach_list.push(`${ach.name} ${ach.tier}`);
//             }
//             message = `Congrats! You have earned these achievements! ${ach_list.toString()}`;
//             has_achievement = true;
//         } else {
//             message = `Stat [${stat_name}] updated.`;
//         }
        
//         res.status(200).json({ 
//             status: result, 
//             message: message,
//             has_achievement: has_achievement,
//             achievements: achievements
//          });
//     } else {
//         res.status(200).json({ status: result, message: 'Stat error.' });
//     }
// });

module.exports = router;
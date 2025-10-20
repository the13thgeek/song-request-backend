const db = require('../config/database');
const WebSocketService = require('./WebSocketService');
const logger = require('../utils/Logger');

class TourneyService {
  constructor() {
    this.TEAM_NAMES = {
      1: 'Afterburner',
      2: 'Concorde',
      3: 'Stratos'
    };

    // Active effects system
    this.effects = {
      blockedTeams: new Map() // teamNumber => reason
      // Add more effect types as needed:
      // shellShields: new Set(),
      // pointMultiplier: {},
      // etc.
    };
  }

  /**
   * Register user to a team (auto-balanced)
   */
  async registerUser(userId) {
    // Check if already registered
    const existing = await db.executeOne(
      'SELECT team_number, points FROM tbl_tourney WHERE user_id = ?',
      [userId]
    );

    if (existing) {
      return {
        success: false,
        team_number: existing.team_number,
        team_name: this.TEAM_NAMES[existing.team_number],
        message: `You are already in ${this.TEAM_NAMES[existing.team_number]}! You have ${existing.points} points.`
      };
    }

    // Get team counts for balancing
    const teamCounts = await db.execute(`
      SELECT t.team_number, COUNT(m.user_id) AS count
      FROM (
        SELECT 1 AS team_number UNION ALL
        SELECT 2 UNION ALL
        SELECT 3
      ) AS t
      LEFT JOIN tbl_tourney m ON t.team_number = m.team_number
      GROUP BY t.team_number
    `);

    // Find teams with minimum members
    const minCount = Math.min(...teamCounts.map(t => t.count));
    const availableTeams = teamCounts
      .filter(t => t.count === minCount)
      .map(t => t.team_number);

    // Random selection from available teams
    const selectedTeam = availableTeams[Math.floor(Math.random() * availableTeams.length)];

    // Register user
    await db.execute(
      'INSERT INTO tbl_tourney(user_id, team_number) VALUES (?, ?)',
      [userId, selectedTeam]
    );

    // Issue team card
    const teamCards = { 1: 25, 2: 26, 3: 27 }; // Afterburner, Concorde, Stratos
    const CardService = require('./CardService');
    await CardService.addCardToUser(userId, teamCards[selectedTeam]);

    return {
      success: true,
      team_number: selectedTeam,
      team_name: this.TEAM_NAMES[selectedTeam],
      message: `Welcome to ${this.TEAM_NAMES[selectedTeam]}! Your team card has been added.`
    };
  }

  /**
   * Get user's faction info
   */
  async getUserFaction(userName) {
    const user = await db.executeOne(
      'SELECT id FROM tbl_users WHERE twitch_display_name = ?',
      [userName]
    );

    if (!user) {
      return {
        success: false,
        user_id: null,
        user_name: userName,
        team_number: null,
        team_name: null,
        message: `User ${userName} not found in database`
      };
    }

    const teamData = await db.executeOne(
      'SELECT team_number, points FROM tbl_tourney WHERE user_id = ?',
      [user.id]
    );

    if (!teamData) {
      return {
        success: false,
        user_id: user.id,
        user_name: userName,
        team_number: null,
        team_name: null,
        message: `${userName} is not registered for the tournament`
      };
    }

    return {
      success: true,
      user_id: user.id,
      user_name: userName,
      team_number: teamData.team_number,
      team_name: this.TEAM_NAMES[teamData.team_number],
      points: teamData.points
    };
  }

  /**
   * Award points to user's team
   */
  async awardPoints(userName, points, details = '') {
    const faction = await this.getUserFaction(userName);

    if (!faction.success) {
      return {
        success: false,
        message: faction.message
      };
    }

    // Check for blocking effects
    if (this.effects.blockedTeams.has(faction.team_number)) {
      const reason = this.effects.blockedTeams.get(faction.team_number);
      
      // Remove one-time effect
      this.effects.blockedTeams.delete(faction.team_number);
      
      // Log blocked attempt
      await this.logScore(userName, 0, `BLOCKED: ${reason}`, false);
      
      // Broadcast update
      WebSocketService.broadcast({ type: 'SCORE_UPDATE' });

      return {
        success: false,
        message: `Your team ${faction.team_name} is grounded: ${reason}`
      };
    }

    // Award points
    await db.execute(
      'UPDATE tbl_tourney SET points = points + ?, last_update = CURRENT_TIMESTAMP WHERE user_id = ?',
      [points, faction.user_id]
    );

    // Log score
    await this.logScore(userName, points, details, true);

    // Broadcast update
    broadcast({ type: 'SCORE_UPDATE' });

    return {
      success: true,
      team_number: faction.team_number,
      team_name: faction.team_name,
      points: points,
      message: `+${points} points for ${faction.team_name}!`
    };
  }

  /**
   * Get tournament scoreboard
   */
  async getScoreboard() {
    // Get team totals
    const totals = await db.execute(`
      SELECT team_number, SUM(points) AS total_points
      FROM tbl_tourney
      GROUP BY team_number
      ORDER BY team_number
    `);

    // Get MVPs (highest scorer per team)
    const mvps = await db.execute(`
      SELECT 
        t1.team_number,
        u.twitch_display_name AS mvp,
        t1.points AS mvp_points
      FROM tbl_tourney t1
      JOIN tbl_users u ON t1.user_id = u.id
      WHERE (t1.user_id, t1.team_number) IN (
        SELECT t2.user_id, t2.team_number
        FROM tbl_tourney t2
        WHERE NOT EXISTS (
          SELECT 1 FROM tbl_tourney t3
          WHERE t3.team_number = t2.team_number
          AND (
            t3.points > t2.points OR
            (t3.points = t2.points AND t3.last_update > t2.last_update)
          )
        )
      )
      ORDER BY t1.team_number
    `);

    // Combine results
    const scores = totals.map(team => {
      const mvpInfo = mvps.find(m => m.team_number === team.team_number);
      return {
        team_number: team.team_number,
        team_name: this.TEAM_NAMES[team.team_number],
        total_points: team.total_points || 0,
        mvp: mvpInfo?.mvp || null,
        mvp_points: mvpInfo?.mvp_points || null
      };
    });

    // Format active effects for client
    const activeEffects = {
      blocked_teams: [...this.effects.blockedTeams.entries()]
    };

    return {
      scores,
      effects: activeEffects
    };
  }

  /**
   * Log tournament score activity
   */
  async logScore(source, points, details, hasCooldown = true) {
    await db.execute(
      'INSERT INTO tbl_tourney_log(source, points, details, has_cooldown) VALUES(?,?,?,?)',
      [source, points, details, hasCooldown ? 1 : 0]
    );
  }

  /**
   * Check if user is on cooldown
   */
  async checkCooldown(userName, cooldownMinutes = 60) {
    const lastActivity = await db.executeOne(`
      SELECT TIMESTAMPDIFF(SECOND, transaction_time, NOW()) AS seconds_passed 
      FROM tbl_tourney_log
      WHERE source = ? AND has_cooldown = 1
      ORDER BY transaction_time DESC
      LIMIT 1
    `, [userName]);

    if (!lastActivity) {
      return { active: false };
    }

    const cooldownSeconds = cooldownMinutes * 60;
    const { seconds_passed } = lastActivity;

    if (seconds_passed >= cooldownSeconds) {
      return { active: false };
    }

    const remaining = cooldownSeconds - seconds_passed;
    const remainingMinutes = Math.floor(remaining / 60);
    const remainingSeconds = remaining % 60;

    const label = remainingMinutes >= 1
      ? `${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`
      : `${remainingSeconds} second${remainingSeconds !== 1 ? 's' : ''}`;

    return {
      active: true,
      remaining_seconds: remaining,
      wait_label: label
    };
  }

  /**
   * Activate tournament effect
   */
  activateEffect(teamNumber, effectType, details = null) {
    switch (effectType) {
      case 'block_team':
        this.effects.blockedTeams.set(teamNumber, details || 'System Malfunction');
        break;

      // Add more effect types here:
      // case 'point_multiplier':
      //   this.effects.pointMultiplier[teamNumber] = { 
      //     multiplier: 2, 
      //     expiresAt: Date.now() + (5 * 60 * 1000) 
      //   };
      //   break;

      default:
        throw new Error(`Unknown effect type: ${effectType}`);
    }

    // Broadcast effect activation
    WebSocketService.broadcast({ type: 'SCORE_UPDATE' });
  }

  /**
   * Clear effect
   */
  clearEffect(teamNumber, effectType) {
    switch (effectType) {
      case 'block_team':
        this.effects.blockedTeams.delete(teamNumber);
        break;
      default:
        throw new Error(`Unknown effect type: ${effectType}`);
    }

    WebSocketService.broadcast({ type: 'SCORE_UPDATE' });
  }

  /**
   * Get team standings (sorted by points)
   */
  async getStandings() {
    const scoreboard = await this.getScoreboard();
    return scoreboard.scores.sort((a, b) => b.total_points - a.total_points);
  }
}

module.exports = new TourneyService();
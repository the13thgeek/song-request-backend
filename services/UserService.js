const db = require('../config/database');
const levels = require('../data/levels.json');

class UserService {
  constructor() {
    // EXP multipliers
    this.expStandard = 1.0;
    this.expPremium = 1.15;
    this.expGlobal = 1.0;
  }

  /**
   * Calculate player level and progress from EXP
   */
  getPlayerLevel(exp) {
    let currentLevel = levels[0];
    let nextLevel = null;

    for (let i = 0; i < levels.length; i++) {
      if (exp < levels[i].exp) {
        nextLevel = levels[i];
        break;
      }
      currentLevel = levels[i];
    }

    const progressLevel = nextLevel 
      ? ((exp - currentLevel.exp) / (nextLevel.exp - currentLevel.exp)) * 100 
      : 100;

    return {
      level: currentLevel.level,
      title: currentLevel.title,
      progressLevel: Math.floor(progressLevel)
    };
  }

  /**
   * Check if user has premium status based on roles
   */
  isPremium(roles) {
    if (!roles) return false;
    const premiumRoles = ['VIP', 'Subscriber', 'Artist', 'Moderator'];
    return premiumRoles.some(role => roles.includes(role));
  }

  /**
   * Get user by local ID
   */
  async getUserById(userId) {
    const user = await db.executeOne(
      'SELECT * FROM tbl_users WHERE id = ?',
      [userId]
    );

    if (!user) return null;

    return await this.enrichUserData(user);
  }

  /**
   * Get or create user by Twitch ID
   */
  async getUserByTwitchId(twitchId, displayName, avatar = null, isPremium = null) {
    if (!twitchId || !displayName) {
      throw new Error('Invalid user data: twitchId and displayName required');
    }

    let user = await db.executeOne(
      'SELECT * FROM tbl_users WHERE twitch_id = ?',
      [twitchId]
    );

    if (user) {
      // Update existing user
      await this.updateUser(user.id, displayName, avatar, isPremium);
      user = await db.executeOne(
        'SELECT * FROM tbl_users WHERE id = ?',
        [user.id]
      );
    } else {
      // Register new user
      user = await this.registerUser(twitchId, displayName, avatar, isPremium);
    }

    return await this.enrichUserData(user, isPremium);
  }

  /**
   * Register new user
   */
  async registerUser(twitchId, displayName, avatar, isPremium = false) {
    const premiumValue = isPremium ? 1 : 0;
    
    const result = await db.execute(
      'INSERT INTO tbl_users(twitch_id, twitch_display_name, twitch_avatar, is_premium) VALUES(?,?,?,?)',
      [twitchId, displayName, avatar, premiumValue]
    );

    return await db.executeOne(
      'SELECT * FROM tbl_users WHERE id = ?',
      [result.insertId]
    );
  }

  /**
   * Update existing user
   */
  async updateUser(userId, displayName, avatar = null, isPremium = null) {
    const updates = [];
    const params = [];

    // Always update display name and activity timestamp
    updates.push('twitch_display_name = ?');
    params.push(displayName);

    // Only update avatar if provided (not null/blank/undefined)
    if (avatar !== null && avatar !== undefined && avatar === '') {
      updates.push('twitch_avatar = ?');
      params.push(avatar);
    }

    // Update premium status if provided
    if (isPremium !== null) {
      updates.push('is_premium = ?');
      params.push(isPremium ? 1 : 0);
    }

    // Always update activity timestamp
    updates.push('last_activity = CURRENT_TIMESTAMP()');

    // Add userId for WHERE clause
    params.push(userId);

    const query = `UPDATE tbl_users SET ${updates.join(', ')} WHERE id = ?`;
    
    await db.execute(query, params);
  }

  /**
   * Enrich user data with cards, stats, achievements, etc.
   */
  async enrichUserData(user, isPremium = null) {
    const [playerLevel, cards, stats, achievements, team] = await Promise.all([
      this.getPlayerLevel(user.exp),
      this.getUserCards(user.id, isPremium),
      this.getUserStats(user.id),
      this.getUserAchievements(user.id),
      this.getUserTeam(user.id)
    ]);

    return {
      ...user,
      level: playerLevel.level,
      title: playerLevel.title,
      levelProgress: playerLevel.progressLevel,
      cards: cards.cards,
      card_default: cards.default,
      stats,
      achievements,
      team
    };
  }

  /**
   * Get user's cards
   */
  async getUserCards(userId, isPremium = false) {
    const cards = await db.execute(
      `SELECT c.*, uc.user_id, uc.is_default, uc.card_id
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
         c.name`,
      [userId]
    );

    // Issue first card if user has none
    if (cards.length === 0) {
      const cardId = isPremium ? 2 : 1;
      await db.execute(
        'INSERT INTO tbl_user_cards(user_id, card_id, is_default) VALUES(?,?,?)',
        [userId, cardId, 1]
      );
      return await this.getUserCards(userId, isPremium);
    }

    // Handle premium card for existing users
    if (isPremium) {
      const hasPremium = cards.some(card => card.card_id === 2);
      if (!hasPremium) {
        await db.execute(
          'UPDATE tbl_user_cards SET is_default = 0 WHERE user_id = ?',
          [userId]
        );
        await db.execute(
          'INSERT INTO tbl_user_cards(user_id, card_id, is_default) VALUES(?,?,?)',
          [userId, 2, 1]
        );
        return await this.getUserCards(userId, isPremium);
      }
    }

    const defaultCard = await db.executeOne(
      `SELECT c.*, uc.is_default, uc.card_id
       FROM tbl_cards c
       INNER JOIN tbl_user_cards uc ON c.id = uc.card_id
       WHERE uc.user_id = ? AND uc.is_default = 1`,
      [userId]
    );

    return { cards, default: defaultCard };
  }

  /**
   * Get user stats
   */
  async getUserStats(userId) {
    const rows = await db.execute(
      'SELECT stat_key, stat_value FROM tbl_user_stats WHERE user_id = ?',
      [userId]
    );

    const stats = {};
    rows.forEach(row => {
      stats[row.stat_key] = row.stat_value;
    });
    return stats;
  }

  /**
   * Get user achievements
   */
  async getUserAchievements(userId) {
    return await db.execute(
      `SELECT a.name AS achievement_name, a.sysname, MAX(a.tier) AS achievement_tier, 
              a.description, ua.achieved_at
       FROM tbl_user_achievements ua
       JOIN tbl_achievements a ON ua.achievement_id = a.id
       WHERE ua.user_id = ?
       GROUP BY a.sysname
       ORDER BY ua.achieved_at DESC, a.name, a.tier DESC`,
      [userId]
    );
  }

  /**
   * Get user's team
   */
  async getUserTeam(userId) {
    const TEAM_NAMES = { 1: 'Afterburner', 2: 'Concorde', 3: 'Stratos' };
    
    const team = await db.executeOne(
      'SELECT team_number FROM tbl_tourney WHERE user_id = ? LIMIT 1',
      [userId]
    );

    return team ? TEAM_NAMES[team.team_number] : null;
  }

  /**
   * Update user timestamp
   */
  async updateTimestamp(userId, field) {
    const validFields = ['last_login', 'last_checkin', 'last_activity'];
    if (!validFields.includes(field)) {
      throw new Error(`Invalid timestamp field: ${field}`);
    }

    await db.execute(
      `UPDATE tbl_users SET ${field} = CURRENT_TIMESTAMP() WHERE id = ?`,
      [userId]
    );
  }

  /**
   * Award EXP to user
   */
  async awardExp(userId, isPremium, baseExp) {
    let exp = baseExp * (isPremium ? this.expPremium : this.expStandard);
    exp *= this.expGlobal;

    await db.execute(
      'UPDATE tbl_users SET exp = exp + ? WHERE id = ?',
      [exp, userId]
    );
    await this.updateTimestamp(userId, 'last_activity');
  }

  /**
   * Update user stats
   */
  async updateStat(userId, statName, value, increment = false) {
    const query = increment
      ? 'INSERT INTO tbl_user_stats(user_id, stat_key, stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = stat_value + ?'
      : 'INSERT INTO tbl_user_stats(user_id, stat_key, stat_value) VALUES(?,?,?) ON DUPLICATE KEY UPDATE stat_value = ?';

    await db.execute(query, [userId, statName, value, value]);
    await this.updateTimestamp(userId, 'last_activity');
  }

  /**
   * Check and award achievements
   */
  async checkAchievements(userId, statName) {
    const newAchievements = await db.execute(
      `SELECT a.id, a.name, a.tier
       FROM tbl_achievements a
       LEFT JOIN tbl_user_achievements ua ON a.id = ua.achievement_id AND ua.user_id = ?
       WHERE a.stat_key = ?
         AND a.threshold <= (
           SELECT stat_value FROM tbl_user_stats 
           WHERE user_id = ? AND stat_key = ?
         )
         AND ua.achievement_id IS NULL`,
      [userId, statName, userId, statName]
    );

    if (newAchievements.length === 0) return null;

    // Award achievements
    for (const ach of newAchievements) {
      await db.execute(
        'INSERT INTO tbl_user_achievements(user_id, achievement_id) VALUES(?,?)',
        [userId, ach.id]
      );
    }

    return newAchievements.map(ach => `${ach.name} ${ach.tier}`).join(', ');
  }
}

module.exports = new UserService();
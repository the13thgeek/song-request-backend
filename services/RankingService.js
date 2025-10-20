const db = require('../config/database');
const UserService = require('./UserService');

class RankingService {
  constructor() {
    this.TEAM_NAMES = { 1: 'Afterburner', 2: 'Concorde', 3: 'Stratos' };
  }

  /**
   * Get rankings based on type
   */
  async getRanking(rankType, limit = 5) {
    const queries = {
      exp: `
        SELECT u.id, u.twitch_display_name, u.twitch_avatar, u.exp, 
               u.is_premium, u.exp as 'value', u.sub_months, 
               c.sysname, c.name AS active_card
        FROM tbl_users u
        JOIN tbl_user_cards uc ON u.id = uc.user_id
        JOIN tbl_cards c ON uc.card_id = c.id
        WHERE u.id NOT IN (1,2) 
          AND uc.is_default = 1 
          AND u.last_activity >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
        ORDER BY u.exp DESC 
        LIMIT ${limit}`,

      spender: `
        SELECT u.id, u.twitch_display_name, u.twitch_avatar, u.exp, 
               u.is_premium, u.sub_months, s.stat_value AS 'value'
        FROM tbl_users u
        JOIN tbl_user_stats s ON u.id = s.user_id
        WHERE s.stat_key = 'points_spend' AND u.id NOT IN (1,2)
        ORDER BY s.stat_value DESC 
        LIMIT ${limit}`,

      redeems: `
        SELECT u.id, u.twitch_display_name, u.twitch_avatar, u.exp,
               u.is_premium, u.sub_months, s.stat_value AS 'value'
        FROM tbl_users u
        JOIN tbl_user_stats s ON u.id = s.user_id
        WHERE s.stat_key = 'redeems_count' AND u.id NOT IN (1,2)
        ORDER BY s.stat_value DESC 
        LIMIT ${limit}`,

      checkins_last: `
        SELECT id, twitch_display_name, twitch_avatar, exp, 
               is_premium, sub_months, last_checkin AS 'value'
        FROM tbl_users
        WHERE id NOT IN (1,2)
        ORDER BY last_checkin DESC 
        LIMIT ${limit}`,

      checkins: `
        SELECT u.id, u.twitch_display_name, u.twitch_avatar, u.exp,
               u.is_premium, u.sub_months, s.stat_value AS 'value'
        FROM tbl_users u
        JOIN tbl_user_stats s ON u.id = s.user_id
        WHERE s.stat_key = 'checkin_count' AND u.id NOT IN (1,2)
        ORDER BY s.stat_value DESC 
        LIMIT ${limit}`,

      achievements: `
        SELECT u.id, u.twitch_avatar, u.twitch_display_name, u.exp,
               u.is_premium, u.sub_months, a.name as 'ach_name', 
               a.tier, a.sysname as 'ach_sysname', ua.achieved_at
        FROM tbl_user_achievements ua
        JOIN tbl_users u ON ua.user_id = u.id
        JOIN tbl_achievements a ON ua.achievement_id = a.id
        WHERE u.id NOT IN (1,2)
        ORDER BY ua.achieved_at DESC 
        LIMIT ${limit}`
    };

    const query = queries[rankType];
    if (!query) {
      throw new Error(`Invalid rank type: ${rankType}`);
    }

    const results = await db.execute(query, []);

    // Enrich with level and team data
    return await Promise.all(results.map(async (user) => {
      const playerData = UserService.getPlayerLevel(user.exp);
      const teamData = await db.executeOne(
        'SELECT team_number FROM tbl_tourney WHERE user_id = ? LIMIT 1',
        [user.id]
      );

      return {
        ...user,
        level: playerData.level,
        title: playerData.title,
        levelProgress: playerData.progressLevel,
        team: teamData ? this.TEAM_NAMES[teamData.team_number] : null
      };
    }));
  }
}

module.exports = new RankingService();
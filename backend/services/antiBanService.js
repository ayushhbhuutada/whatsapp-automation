import { run, get, all } from '../database.js';

/**
 * Anti-Ban Protection Suite Service
 * Provides Spintax parsing, Number Warmup tracking, Health Monitoring, and Smart Rate Limiting.
 */

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 1. Spintax Parser Engine
export function parseSpintax(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  const safeOptions = options || {};
  const { enableSpintax = true, enableAutoEmoji = false } = safeOptions;

  let result = text;

  // Mask double-braced variables (e.g. {{name}}, {{phone}}) to preserve them during spintax parsing
  const doubleBraceMap = [];
  result = result.replace(/\{\{([^{}|]+)\}\}/g, (match) => {
    doubleBraceMap.push(match);
    return `__DB_VAR_${doubleBraceMap.length - 1}__`;
  });

  if (enableSpintax) {
    let matchCount = 0;
    const maxIterations = 500;

    while (/\{([^{}]+)\}/.test(result) && matchCount < maxIterations) {
      const prev = result;
      result = result.replace(/\{([^{}]+)\}/g, (match, choicesStr) => {
        const choices = choicesStr.split('|');
        const randomIndex = Math.floor(Math.random() * choices.length);
        return choices[randomIndex];
      });

      if (result === prev) break;
      matchCount++;
    }
  }

  // Restore double-braced variables
  doubleBraceMap.forEach((original, idx) => {
    result = result.replace(new RegExp(`__DB_VAR_${idx}__`, 'g'), original);
  });

  if (enableAutoEmoji) {
    const friendlyEmojis = ['😊', '👍', '🙌', '🎯', '📱', '💡', '🚀', '🔥', '🎉'];
    const randomEmoji = friendlyEmojis[Math.floor(Math.random() * friendlyEmojis.length)];
    // Add space + emoji if not already ending with emoji
    if (!/[\u{1F300}-\u{1F9FF}]/u.test(result.slice(-2))) {
      result = `${result.trim()} ${randomEmoji}`;
    }
  }

  return result;
}

export async function checkWarmupStatus(userId, settings = {}, sessionName = null) {
  try {
    const safeSettings = settings || {};
    const isBypassed = safeSettings.bypass_all_safety === 'true' || 
                       safeSettings.bypass_all_safety === true || 
                       safeSettings.turbo_blast_mode === 'true' || 
                       safeSettings.turbo_blast_mode === true;

    if (isBypassed) {
      return {
        isEnabled: false,
        ageInDays: 30,
        stage: 4,
        dailyLimit: 999999,
        sentToday: 0,
        remaining: 999999,
        isExceeded: false
      };
    }

    const isEnabled = safeSettings.enable_daily_warmup !== 'false' && 
                      safeSettings.enable_warmup !== 'false' && 
                      safeSettings.enable_number_warmup !== 'false' && 
                      safeSettings.warmup_enabled !== 'false' &&
                      safeSettings.warmupEnabled !== false;
    const todayStr = formatLocalDate(new Date());

    const stage1Limit = parseInt(safeSettings.warmup_stage1_limit || safeSettings.daily_limit) || 25;
    const stage2Limit = parseInt(safeSettings.warmup_stage2_limit) || 50;
    const stage3Limit = parseInt(safeSettings.warmup_stage3_limit) || 75;
    const stage4Limit = parseInt(safeSettings.warmup_stage4_limit) || 100;

    const user = await get('SELECT created_at FROM users WHERE id = ?', [userId]).catch(() => null);
    let diffDays = 1;
    if (user && user.created_at) {
      const dateStr = String(user.created_at).trim();
      let parsed = new Date(dateStr);
      if (isNaN(parsed.getTime()) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(dateStr)) {
        parsed = new Date(dateStr.replace(' ', 'T'));
      }
      if (!isNaN(parsed.getTime())) {
        const now = new Date();
        if (parsed <= now) {
          diffDays = Math.max(1, Math.ceil((now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24)));
        } else {
          diffDays = 1;
        }
      } else {
        diffDays = 1;
      }
    }

    let dailyLimit = stage1Limit;
    let stage = 1;
    if (diffDays >= 14) {
      stage = 4;
      dailyLimit = stage4Limit;
    } else if (diffDays >= 8) {
      stage = 3;
      dailyLimit = stage3Limit;
    } else if (diffDays >= 4) {
      stage = 2;
      dailyLimit = stage2Limit;
    }

    let sentToday = 0;
    if (sessionName) {
      const sessionCountRow = await get(`
        SELECT COUNT(*) as count FROM contacts 
        WHERE user_id = ? AND sent_via_session = ? AND status = 'Sent'
        AND (date(sent_at) = ? OR date(sent_at, 'localtime') = ?)
      `, [userId, sessionName, todayStr, todayStr]).catch(() => null);
      sentToday = sessionCountRow ? (sessionCountRow.count || 0) : 0;
    } else {
      const dailyTracker = await get(`
        SELECT sent_count, count FROM daily_send_tracker
        WHERE user_id = ? AND (date_str = ? OR date = ?)
      `, [userId, todayStr, todayStr]).catch(() => null);
      sentToday = dailyTracker ? (dailyTracker.sent_count || dailyTracker.count || 0) : 0;
    }

    const remaining = Math.max(0, dailyLimit - sentToday);
    const isExceeded = isEnabled && sentToday >= dailyLimit;

    return {
      isEnabled,
      ageInDays: diffDays,
      stage,
      dailyLimit,
      sentToday,
      remaining,
      isExceeded
    };
  } catch (err) {
    console.error('[Anti-Ban Warmup Check Error]:', err.message);
    return { isEnabled: false, ageInDays: 30, stage: 4, dailyLimit: 1000, sentToday: 0, remaining: 1000, isExceeded: false };
  }
}

export async function incrementDailySendCount(userId, sessionName = null) {
  const todayStr = formatLocalDate(new Date());
  await run(`
    INSERT INTO daily_send_tracker (user_id, date_str, date, sent_count, count)
    VALUES (?, ?, ?, 1, 1)
    ON CONFLICT(user_id, date_str) DO UPDATE SET sent_count = sent_count + 1, count = count + 1
  `, [userId, todayStr, todayStr]);
}

export const checkDailyLimit = checkWarmupStatus;
export const recordDailySend = incrementDailySendCount;

// 3. Health Monitoring System
export async function calculateHealthScore(userId, settings = {}) {
  const safeSettings = settings || {};
  const isEnabled = safeSettings.enable_health_monitoring !== 'false';
  const autoPause = safeSettings.auto_pause_high_risk !== 'false' && 
                    safeSettings.auto_pause_health !== 'false' &&
                    safeSettings.auto_pause_high_risk !== false && 
                    safeSettings.auto_pause_health !== false;

  // Fetch campaign statistics for this user
  const stats = await get(`
    SELECT 
      COUNT(*) as total_contacts,
      COALESCE(SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END), 0) as sent_count,
      COALESCE(SUM(CASE WHEN status = 'Failed' THEN 1 ELSE 0 END), 0) as failed_count
    FROM contacts
    WHERE user_id = ?
  `, [userId]);

  const sentCount = stats ? (stats.sent_count || 0) : 0;
  const failedCount = stats ? (stats.failed_count || 0) : 0;
  const totalSent = sentCount + failedCount;
  const failureRate = totalSent > 0 ? (failedCount / totalSent) * 100 : 0;

  // Warmup status
  const warmup = await checkWarmupStatus(userId, safeSettings);

  // Compute Base Health Score (starting at 100)
  let score = 100;
  const deductions = [];
  const recommendations = [];

  // Deduct based on failure rate
  if (failureRate > 20) {
    score -= 40;
    deductions.push(`High delivery failure rate (${failureRate.toFixed(1)}%)`);
    recommendations.push('Clean your contact list to remove invalid/inactive numbers.');
  } else if (failureRate > 10) {
    score -= 20;
    deductions.push(`Moderate failure rate (${failureRate.toFixed(1)}%)`);
    recommendations.push('Ensure numbers include proper country codes.');
  }

  // Deduct based on warmup daily limit status only when warmup is explicitly enabled
  if (warmup.isEnabled && warmup.sentToday > warmup.dailyLimit * 0.8) {
    score -= 15;
    deductions.push(`Approaching daily warmup limit (${warmup.sentToday}/${warmup.dailyLimit})`);
    recommendations.push('Consider pausing campaigns today or increasing warmup delay.');
  }

  if (warmup.isEnabled && warmup.isExceeded) {
    score -= 30;
    deductions.push(`Exceeded daily warmup limit for Stage ${warmup.stage}`);
    recommendations.push('Pause sending for today to prevent automated WhatsApp ban detection.');
  }

  // Ensure score stays within 0 - 100
  score = Math.max(0, Math.min(100, Math.round(score)));

  let statusLevel = 'Healthy';
  let badgeColor = 'green';

  if (score < 50) {
    statusLevel = 'High Risk';
    badgeColor = 'red';
  } else if (score < 80) {
    statusLevel = 'Caution';
    badgeColor = 'yellow';
  }

  if (recommendations.length === 0) {
    recommendations.push('Account metrics optimal. Ready for high-volume message delivery.');
  }

  // Calculate hourly sending velocity
  let msgsLastHour = 0;
  try {
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    const hRow = await get("SELECT COUNT(*) as count FROM contacts WHERE user_id = ? AND status = 'Sent' AND sent_at >= ?", [userId, oneHourAgo]);
    msgsLastHour = hRow ? (hRow.count || 0) : 0;
  } catch (e) {}

  return {
    success: true,
    isEnabled,
    autoPause,
    healthScore: score,
    statusLevel,
    badgeColor,
    failureRate: failureRate.toFixed(1),
    sentToday: warmup.sentToday,
    warmupStage: warmup.stage,
    dailyLimit: warmup.isEnabled ? warmup.dailyLimit : 1000,
    speedPerHour: msgsLastHour,
    sendingVelocity: `${msgsLastHour} msgs/hr`,
    deductions,
    recommendations
  };
}

export function calculateSmartDelayMs(settings = {}, messageIndex = 1) {
  const safeSettings = settings || {};
  const isBypassed = safeSettings.bypass_all_safety === 'true' || 
                     safeSettings.bypass_all_safety === true || 
                     safeSettings.turbo_blast_mode === 'true' || 
                     safeSettings.turbo_blast_mode === true;

  const isEnabled = safeSettings.enable_smart_rate_limiter !== 'false' && 
                    safeSettings.enable_smart_rate_limiter !== false &&
                    safeSettings.rateLimiterEnabled !== false;
  
  if (isBypassed || !isEnabled) {
    const fixedSeconds = safeSettings.delay_seconds !== undefined && !isNaN(parseInt(safeSettings.delay_seconds)) ? parseInt(safeSettings.delay_seconds) : 1;
    return { delayMs: fixedSeconds * 1000, isRestPause: false, delaySeconds: fixedSeconds };
  }

  const minSeconds = parseInt(safeSettings.min_delay_seconds) || parseInt(safeSettings.min_delay) || parseInt(safeSettings.minDelaySeconds) || 8;
  const maxSeconds = parseInt(safeSettings.max_delay_seconds) || parseInt(safeSettings.max_delay) || parseInt(safeSettings.maxDelaySeconds) || 45;
  const burstInterval = parseInt(safeSettings.burst_interval_messages) || parseInt(safeSettings.burstRestAfter) || 20;
  const burstPauseSeconds = safeSettings.burst_pause_seconds !== undefined 
    ? (parseInt(safeSettings.burst_pause_seconds) || 0)
    : (safeSettings.burstRestDuration !== undefined ? (parseInt(safeSettings.burstRestDuration) || 0) : 120);

  // Check if micro-burst rest pause should trigger
  if (burstPauseSeconds > 0 && messageIndex > 0 && messageIndex % burstInterval === 0) {
    // Add +/- 15% random jitter to rest pause
    const jitterFactor = 0.85 + Math.random() * 0.3;
    const restMs = Math.round(burstPauseSeconds * jitterFactor * 1000);
    return { delayMs: restMs, isRestPause: true, pauseSeconds: Math.round(restMs / 1000) };
  }

  // Calculate random delay between min and max with gaussian-style randomness
  const lower = Math.min(minSeconds, maxSeconds);
  const upper = Math.max(minSeconds, maxSeconds);
  const randomSeconds = lower + Math.random() * (upper - lower);
  // Add random micro-jitter (0-500ms when lower < 5s, otherwise up to 3s)
  const maxJitter = lower < 5 ? 300 : 3000;
  const jitterMs = Math.floor(Math.random() * maxJitter);
  const totalMs = Math.round(randomSeconds * 1000) + jitterMs;

  return { delayMs: totalMs, isRestPause: false, delaySeconds: Math.round(totalMs / 1000) };
}

// 5. Unsubscribe / Blacklist Protection
export async function isNumberBlacklisted(userId, phone) {
  if (!phone) return false;
  const clean = String(phone).replace(/\D/g, '');
  if (!clean || clean.length < 5) return false;

  const last10 = clean.length >= 10 ? clean.slice(-10) : clean;

  const rows = await all(`
    SELECT phone, number FROM blacklisted_numbers 
    WHERE user_id = ? AND (
      phone = ? OR number = ? 
      OR phone = ? OR number = ?
      OR phone LIKE ?
    )
  `, [userId, clean, clean, last10, last10, `%${last10}`]);

  if (!rows || rows.length === 0) return false;

  const inputLast10 = clean.length >= 10 ? clean.slice(-10) : clean;
  const inputPrefix = clean.length > 10 ? clean.slice(0, clean.length - 10) : '';

  for (const row of rows) {
    const dbClean = String(row.phone || row.number || '').replace(/\D/g, '');
    if (!dbClean) continue;

    if (clean === dbClean) return true;

    if (clean.length >= 10 && dbClean.length >= 10) {
      const dbLast10 = dbClean.slice(-10);
      if (inputLast10 === dbLast10) {
        const dbPrefix = dbClean.length > 10 ? dbClean.slice(0, dbClean.length - 10) : '';
        if (inputPrefix && dbPrefix) {
          if (inputPrefix === dbPrefix) return true;
        } else {
          const nonEmpPrefix = inputPrefix || dbPrefix;
          if (nonEmpPrefix === '91' || nonEmpPrefix === '' || inputPrefix === dbPrefix) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

export async function addNumberToBlacklist(userId, phone, reason = 'User Opt-Out / Unsubscribed') {
  if (!phone) return;
  const clean = String(phone).replace(/\D/g, '');
  if (!clean || clean.length < 5) return;

  const existing = await get('SELECT id FROM blacklisted_numbers WHERE user_id = ? AND (phone = ? OR number = ?)', [userId, clean, clean]);
  if (existing) {
    await run('UPDATE blacklisted_numbers SET reason = ?, number = ? WHERE id = ?', [reason, clean, existing.id]);
    return;
  }

  await run(`
    INSERT OR IGNORE INTO blacklisted_numbers (user_id, phone, number, reason)
    VALUES (?, ?, ?, ?)
  `, [userId, clean, clean, reason]);
}

// 6. Multilingual Auto-Spintax Generator
export function generateAutoSpintax(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;

  // Mask double-braced variables (e.g. {{name}}, {{company}})
  const doubleBraceMap = [];
  result = result.replace(/\{\{([^{}|]+)\}\}/g, (match) => {
    doubleBraceMap.push(match);
    return `__DB_VAR_${doubleBraceMap.length - 1}__`;
  });

  // Multilingual replacements dictionary
  const replacements = [
    // English
    { regex: /\b(hello|hi|hey|greetings|dear)\b/gi, choices: ['Hello', 'Hi', 'Hey', 'Greetings', 'Dear'] },
    { regex: /\b(good morning|good afternoon|good evening)\b/gi, choices: ['Good morning', 'Good afternoon', 'Good day', 'Greetings'] },
    { regex: /\b(hope you are doing well|hope you are well|hope all is well|hope you are having a great day)\b/gi, choices: ['hope you are doing well', 'hope all is well', 'hope you are having a great day', 'trust you are doing great'] },
    { regex: /\b(thanks|thank you|many thanks|cheers)\b/gi, choices: ['Thanks', 'Thank you', 'Many thanks', 'Cheers'] },
    { regex: /\b(regards|best regards|kind regards|best wishes|warm regards)\b/gi, choices: ['Regards', 'Best regards', 'Kind regards', 'Best wishes', 'Warm regards'] },
    { regex: /\b(please|kindly)\b/gi, choices: ['please', 'kindly'] },
    { regex: /\b(check|review|look at|inspect)\b/gi, choices: ['check', 'review', 'look at', 'take a look at'] },
    { regex: /\b(discount|offer|deal|special offer)\b/gi, choices: ['discount', 'offer', 'deal', 'special offer'] },

    // Hindi / Hinglish
    { regex: /\b(namaste|pranam|shubh prabhat)\b/gi, choices: ['Namaste', 'Hello', 'Pranam', 'Greetings'] },
    { regex: /\b(dhanyawad|dhanyavad|shukriya)\b/gi, choices: ['Dhanyawad', 'Shukriya', 'Thanks', 'Thank you'] },
    { regex: /\b(kripya|kripaya)\b/gi, choices: ['Kripya', 'Please', 'Kindly'] },

    // Spanish
    { regex: /\b(hola|buenos dias|buenas tardes|saludos|estimado|estimada)\b/gi, choices: ['Hola', 'Buenos días', 'Saludos', 'Estimado/a'] },
    { regex: /\b(gracias|muchas gracias)\b/gi, choices: ['Gracias', 'Muchas gracias', 'Un cordial saludo'] },

    // French
    { regex: /\b(bonjour|bonsoir|salut|cher|chere)\b/gi, choices: ['Bonjour', 'Salut', 'Cher/Chère', 'Cordialement'] },
    { regex: /\b(merci|merci beaucoup)\b/gi, choices: ['Merci', 'Merci beaucoup', 'Bien à vous'] },

    // German
    { regex: /\b(hallo|guten tag|guten morgen)\b/gi, choices: ['Hallo', 'Guten Tag', 'Guten Morgen', 'Herzliche Grüße'] },
    { regex: /\b(danke|vielen dank)\b/gi, choices: ['Danke', 'Vielen Dank', 'Beste Grüße'] }
  ];

  replacements.forEach(({ regex, choices }) => {
    // Only replace if match is not already inside spintax brackets
    if (!/\{[^{}]*\}/.test(result)) {
      result = result.replace(regex, () => `{${choices.join('|')}}`);
    }
  });

  // Restore double-braced variables
  doubleBraceMap.forEach((original, idx) => {
    result = result.replace(new RegExp(`__DB_VAR_${idx}__`, 'g'), original);
  });

  // If no spintax brackets were created, wrap sentence openers in choices
  if (result === text && !/\{[^{}]*\}/.test(result)) {
    const firstWordMatch = result.match(/^([A-Za-z\u00C0-\u024F]+)/);
    if (firstWordMatch && firstWordMatch[1].length > 2) {
      const w = firstWordMatch[1];
      result = result.replace(new RegExp(`^${w}`), `{${w}|${w} 😊|Greetings, ${w}}`);
    }
  }

  return result;
}

// 7. Night Quiet Hours Evaluator
export function isNightQuietHours(settings = {}, currentHour = null) {
  const safe = settings || {};
  const isEnabled = safe.enable_night_pause === 'true' || safe.quiet_hours_enabled === 'true';
  if (!isEnabled) return false;

  const startHour = parseInt(safe.night_pause_start_hour ?? safe.quiet_start) ?? 23;
  const endHour = parseInt(safe.night_pause_end_hour ?? safe.quiet_end) ?? 7;
  const hour = (currentHour !== null && currentHour !== undefined) ? currentHour : new Date().getHours();

  if (isNaN(startHour) || isNaN(endHour)) return false;
  if (startHour === endHour) return false;

  if (startHour > endHour) {
    // Overnight window (e.g. 23:00 to 07:00)
    return hour >= startHour || hour < endHour;
  } else {
    // Daytime window (e.g. 09:00 to 17:00)
    return hour >= startHour && hour < endHour;
  }
}

/**
 * 8. Automatic Spintax Builder from Multiple Message Variations
 * Takes an array of 2, 3, 4, 5+ messages and generates a clean, compliant Spintax structure.
 */
export function buildSpintaxFromMessages(messages = [], mode = 'full') {
  if (!Array.isArray(messages)) return '';
  const cleanMsgs = messages.map(m => (m || '').trim()).filter(Boolean);
  if (cleanMsgs.length === 0) return '';
  if (cleanMsgs.length === 1) return cleanMsgs[0];

  if (mode === 'sentence') {
    // Split each message into non-empty lines or sentences
    const splitLines = cleanMsgs.map(m => m.split(/\r?\n+/).map(l => l.trim()).filter(Boolean));
    const maxLines = Math.max(...splitLines.map(lines => lines.length));
    const fusedLines = [];

    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const lineOptions = [];
      splitLines.forEach(lines => {
        if (lines[lineIdx] && !lineOptions.includes(lines[lineIdx])) {
          lineOptions.push(lines[lineIdx]);
        }
      });

      if (lineOptions.length === 0) continue;
      if (lineOptions.length === 1) {
        fusedLines.push(lineOptions[0]);
      } else {
        fusedLines.push(`{${lineOptions.join('|')}}`);
      }
    }

    return fusedLines.join('\n\n');
  }

  // Mode 'full': wrap all message variants into single spintax group
  return `{${cleanMsgs.join('|')}}`;
}

// ============================================================
// ADVANCED ANTI-BAN SYSTEMS
// ============================================================

// System 1: Engagement-Reactive Auto-Throttle (Circuit Breaker)
export async function trackOutboundMessage(userId, campaignId, sessionName, phone) {
  try {
    await run(`INSERT INTO engagement_tracker (user_id, campaign_id, session_name, phone, direction) VALUES (?, ?, ?, ?, 'outbound')`, 
      [userId, campaignId, sessionName, String(phone).replace(/\D/g, '')]);
  } catch (e) {
    console.error('[Engagement Tracker] outbound error:', e.message);
  }
}

export async function trackInboundReply(userId, sessionName, phone) {
  try {
    await run(`INSERT INTO engagement_tracker (user_id, campaign_id, session_name, phone, direction) VALUES (?, NULL, ?, ?, 'inbound')`,
      [userId, sessionName, String(phone).replace(/\D/g, '')]);
  } catch (e) {
    console.error('[Engagement Tracker] inbound error:', e.message);
  }
}

export async function calculateEngagementScore(userId, campaignId, windowMinutes = 60, settings = {}) {
  try {
    const isBypassed = settings.bypass_all_safety === 'true' || 
                       settings.bypass_all_safety === true || 
                       settings.turbo_blast_mode === 'true' || 
                       settings.turbo_blast_mode === true ||
                       settings.enable_engagement_breaker === 'false' ||
                       settings.enable_engagement_breaker === false;

    if (isBypassed) {
      return {
        outboundCount: 0,
        inboundCount: 0,
        engagementRatio: '1.000',
        throttleMultiplier: 1.0,
        riskLevel: 'bypassed',
        shouldAutoPause: false,
        windowMinutes
      };
    }

    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    
    const outbound = campaignId
      ? await get(`SELECT COUNT(*) as count FROM engagement_tracker WHERE user_id = ? AND campaign_id = ? AND direction = 'outbound' AND created_at >= ?`, [userId, campaignId, since])
      : await get(`SELECT COUNT(*) as count FROM engagement_tracker WHERE user_id = ? AND direction = 'outbound' AND created_at >= ?`, [userId, since]);
    
    const inbound = await get(
      `SELECT COUNT(*) as count FROM engagement_tracker WHERE user_id = ? AND direction = 'inbound' AND created_at >= ?`,
      [userId, since]
    );
    
    const outCount = outbound ? (outbound.count || 0) : 0;
    const inCount = inbound ? (inbound.count || 0) : 0;
    
    // Engagement ratio: replies / messages sent
    const engagementRatio = outCount > 0 ? inCount / outCount : 1;
    
    // Determine throttle multiplier based on engagement
    let throttleMultiplier = 1.0;
    let riskLevel = 'normal';
    let shouldAutoPause = false;
    
    if (outCount <= 10) {
      // Too few messages to judge — proceed normally
      throttleMultiplier = 1.0;
      riskLevel = 'warmup';
    } else if (outCount > 10 && outCount <= 20 && inCount === 0) {
      // 10-20 messages sent, zero replies — slow down 2x
      throttleMultiplier = 2.0;
      riskLevel = 'caution';
    } else if (outCount > 20 && outCount <= 30 && inCount === 0) {
      // 20-30 messages, zero replies — slow down 4x
      throttleMultiplier = 4.0;
      riskLevel = 'warning';
    } else if (outCount > 30 && inCount === 0) {
      // 30+ messages with absolutely zero replies — critical risk
      shouldAutoPause = true;
      throttleMultiplier = 8.0;
      riskLevel = 'critical';
    } else if (engagementRatio < 0.02) {
      // Less than 2% reply rate — elevated risk
      throttleMultiplier = 2.5;
      riskLevel = 'caution';
    } else if (engagementRatio < 0.05) {
      // 2-5% reply rate — mild concern
      throttleMultiplier = 1.5;
      riskLevel = 'elevated';
    } else if (engagementRatio >= 0.1) {
      // 10%+ reply rate — very healthy, speed up slightly
      throttleMultiplier = 0.8;
      riskLevel = 'healthy';
    }
    
    return {
      outboundCount: outCount,
      inboundCount: inCount,
      engagementRatio: engagementRatio.toFixed(3),
      throttleMultiplier,
      riskLevel,
      shouldAutoPause,
      windowMinutes
    };
  } catch (e) {
    console.error('[Engagement Score] error:', e.message);
    return { outboundCount: 0, inboundCount: 0, engagementRatio: '1.000', throttleMultiplier: 1.0, riskLevel: 'normal', shouldAutoPause: false, windowMinutes };
  }
}

// System 2: Multi-Day Campaign Fragmentation
export function getNextSendWindow(settings = {}) {
  const now = new Date();
  const currentHour = now.getHours();
  const todayStr = formatLocalDate(now);
  
  // Define send windows (local time)
  const windows = [
    { slot: 'morning',   startHour: 9,  endHour: 12 },
    { slot: 'afternoon', startHour: 13, endHour: 17 },
    { slot: 'evening',   startHour: 18, endHour: 21 }
  ];
  
  // Find current active window
  const activeWindow = windows.find(w => currentHour >= w.startHour && currentHour < w.endHour);
  
  if (activeWindow) {
    return {
      canSendNow: true,
      currentSlot: activeWindow.slot,
      windowDate: todayStr,
      nextWindowAt: null
    };
  }
  
  // Find next available window
  const futureWindow = windows.find(w => w.startHour > currentHour);
  if (futureWindow) {
    const nextTime = new Date(now);
    nextTime.setHours(futureWindow.startHour, 0, 0, 0);
    return {
      canSendNow: false,
      currentSlot: null,
      windowDate: todayStr,
      nextWindowAt: nextTime.toISOString(),
      nextSlot: futureWindow.slot
    };
  }
  
  // All windows passed today — next morning
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(windows[0].startHour, 0, 0, 0);
  const tomorrowStr = formatLocalDate(tomorrow);
  return {
    canSendNow: false,
    currentSlot: null,
    windowDate: tomorrowStr,
    nextWindowAt: tomorrow.toISOString(),
    nextSlot: 'morning'
  };
}

export async function checkWindowQuota(campaignId, maxPerWindow = 25) {
  const window = getNextSendWindow();
  if (!window.canSendNow) {
    return { canSend: false, reason: `Outside send window. Next window: ${window.nextSlot} at ${window.nextWindowAt}`, window };
  }
  
  try {
    const existing = await get(
      `SELECT messages_sent, max_messages FROM campaign_send_windows WHERE campaign_id = ? AND window_date = ? AND window_slot = ?`,
      [campaignId, window.windowDate, window.currentSlot]
    );
    
    if (existing) {
      const effectiveMax = existing.max_messages || maxPerWindow;
      if (existing.messages_sent >= effectiveMax) {
        return { canSend: false, reason: `Window quota reached (${existing.messages_sent}/${effectiveMax} in ${window.currentSlot} window)`, window };
      }
      return { canSend: true, sent: existing.messages_sent, max: effectiveMax, window };
    }
    
    // Create new window entry
    await run(
      `INSERT OR IGNORE INTO campaign_send_windows (campaign_id, window_date, window_slot, max_messages) VALUES (?, ?, ?, ?)`,
      [campaignId, window.windowDate, window.currentSlot, maxPerWindow]
    );
    return { canSend: true, sent: 0, max: maxPerWindow, window };
  } catch (e) {
    console.error('[Window Quota] error:', e.message);
    return { canSend: true, sent: 0, max: maxPerWindow, window };
  }
}

export async function incrementWindowCount(campaignId) {
  const window = getNextSendWindow();
  if (!window.canSendNow) return;
  try {
    await run(
      `UPDATE campaign_send_windows SET messages_sent = messages_sent + 1 WHERE campaign_id = ? AND window_date = ? AND window_slot = ?`,
      [campaignId, window.windowDate, window.currentSlot]
    );
  } catch (e) {}
}

// System 3: Deep Content Fingerprint Diversification
export function deepDiversifyMessage(text, settings = {}) {
  if (!text || typeof text !== 'string') return text;
  if (settings.enable_deep_diversification === 'false' || settings.enable_deep_diversification === false) {
    return text;
  }
  let result = text;
  
  // 1. Natural punctuation and phrasing variation (curly vs straight quotes, different dashes)
  if (Math.random() > 0.5) {
    // Occasionally swap straight quotes for curly
    result = result.replace(/"/g, () => Math.random() > 0.5 ? '\u201C' : '\u201D');
  }
  if (Math.random() > 0.7) {
    result = result.replace(/ - /g, () => {
      const dashes = [' – ', ' — ', ' - '];
      return dashes[Math.floor(Math.random() * dashes.length)];
    });
  }
  
  // 2. Safe trailing whitespace variation (standard spaces only, no invisible unicode characters)
  const trailingVariations = ['', ' ', '  '];
  result = result.trimEnd() + trailingVariations[Math.floor(Math.random() * trailingVariations.length)];
  
  // 4. Random paragraph break insertion for long messages (>100 chars)
  if (result.length > 100 && Math.random() > 0.5) {
    const sentences = result.split(/(?<=[.!?])\s+/);
    if (sentences.length >= 3) {
      // Insert an extra newline break after a random sentence
      const breakPos = 1 + Math.floor(Math.random() * (sentences.length - 2));
      sentences[breakPos] = sentences[breakPos] + '\n';
      result = sentences.join(' ');
    }
  }
  
  // 5. Micro-capitalization variation for first words
  if (Math.random() > 0.7 && result.length > 0) {
    // Very occasionally lowercase the first character (informal style)
    // Only if it's a casual greeting-like start
    const casualStarts = ['hi', 'hey', 'hello', 'hii', 'yo'];
    const firstWord = result.split(' ')[0].toLowerCase();
    if (casualStarts.includes(firstWord)) {
      result = result[0].toLowerCase() + result.slice(1);
    }
  }
  
  return result;
}

// System 4: Recipient Pre-Qualification & Risk Scoring  
export function getContactDelayMultiplier(riskLevel, settings = {}) {
  const isBypassed = settings.bypass_all_safety === 'true' || 
                     settings.bypass_all_safety === true || 
                     settings.turbo_blast_mode === 'true' || 
                     settings.turbo_blast_mode === true ||
                     settings.enable_risk_scoring === 'false' ||
                     settings.enable_risk_scoring === false;

  if (isBypassed) return 1.0;

  switch (riskLevel) {
    case 'low':    return 1.0;  // Known contact — normal speed
    case 'medium': return 1.5;  // Saved but never chatted — slightly slower
    case 'high':   return 3.0;  // Cold contact — 3x slower
    default:       return 2.0;
  }
}

// System 5: Per-Number Reputation Tracking
export async function getNumberReputation(userId, sessionName) {
  try {
    let rep = await get(
      `SELECT * FROM number_reputation WHERE user_id = ? AND session_name = ?`,
      [userId, sessionName]
    );
    
    if (!rep) {
      // Create default reputation record
      await run(
        `INSERT OR IGNORE INTO number_reputation (user_id, session_name, trust_score) VALUES (?, ?, 100)`,
        [userId, sessionName]
      );
      rep = { 
        restriction_count: 0, last_restricted_at: null, cooldown_until: null, 
        trust_score: 100, total_sent: 0, total_reported: 0, notes: '' 
      };
    }
    
    // Check if currently in cooldown
    const inCooldown = Boolean(rep.cooldown_until && new Date(rep.cooldown_until) > new Date());
    
    // Calculate effective daily limit reduction based on trust
    let dailyLimitMultiplier = 1.0;
    if (rep.trust_score < 30) {
      dailyLimitMultiplier = 0.1; // 10% of normal limit
    } else if (rep.trust_score < 50) {
      dailyLimitMultiplier = 0.25; // 25%
    } else if (rep.trust_score < 70) {
      dailyLimitMultiplier = 0.5; // 50%
    } else if (rep.trust_score < 85) {
      dailyLimitMultiplier = 0.75; // 75%
    }
    
    return {
      ...rep,
      inCooldown,
      cooldownRemaining: inCooldown ? Math.ceil((new Date(rep.cooldown_until) - new Date()) / (1000 * 60 * 60)) + 'h' : null,
      dailyLimitMultiplier,
      riskLevel: rep.trust_score >= 80 ? 'healthy' : rep.trust_score >= 50 ? 'caution' : 'high_risk'
    };
  } catch (e) {
    console.error('[Number Reputation] error:', e.message);
    return { trust_score: 100, restriction_count: 0, inCooldown: false, dailyLimitMultiplier: 1.0, riskLevel: 'healthy' };
  }
}

export async function recordRestrictionEvent(userId, sessionName, notes = '') {
  try {
    const now = new Date().toISOString();
    // Set 72-hour cooldown after restriction
    const cooldownUntil = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    
    // Get current reputation
    const current = await getNumberReputation(userId, sessionName);
    const newRestrictionCount = (current.restriction_count || 0) + 1;
    
    // Trust score penalty: -25 per restriction, floor at 0
    const newTrustScore = Math.max(0, (current.trust_score || 100) - 25);
    
    // Escalating cooldown: 72h for first, 120h for second, 168h (1 week) for third+
    let cooldownHours = 72;
    if (newRestrictionCount === 2) cooldownHours = 120;
    if (newRestrictionCount >= 3) cooldownHours = 168;
    const escalatedCooldown = new Date(Date.now() + cooldownHours * 60 * 60 * 1000).toISOString();
    
    await run(`
      INSERT INTO number_reputation (user_id, session_name, restriction_count, last_restricted_at, cooldown_until, trust_score, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, session_name) DO UPDATE SET 
        restriction_count = restriction_count + 1,
        last_restricted_at = ?,
        cooldown_until = ?,
        trust_score = ?,
        notes = ?,
        updated_at = ?
    `, [userId, sessionName, newRestrictionCount, now, escalatedCooldown, newTrustScore, notes, now,
        now, escalatedCooldown, newTrustScore, notes, now]);
    
    return { success: true, newTrustScore, cooldownHours, newRestrictionCount };
  } catch (e) {
    console.error('[Record Restriction] error:', e.message);
    return { success: false, error: e.message };
  }
}

export async function incrementReputationSendCount(userId, sessionName) {
  try {
    await run(`
      UPDATE number_reputation SET total_sent = total_sent + 1, updated_at = ? WHERE user_id = ? AND session_name = ?
    `, [new Date().toISOString(), userId, sessionName]);
  } catch (e) {}
}

export async function recoverTrustScore(userId, sessionName, points = 1) {
  try {
    await run(`
      UPDATE number_reputation SET 
        trust_score = MIN(100, trust_score + ?),
        updated_at = ?
      WHERE user_id = ? AND session_name = ?
    `, [points, new Date().toISOString(), userId, sessionName]);
  } catch (e) {}
}

export async function getAllNumberReputations(userId) {
  try {
    const reps = await all(`SELECT * FROM number_reputation WHERE user_id = ? ORDER BY trust_score ASC`, [userId]);
    return (reps || []).map(rep => {
      const inCooldown = Boolean(rep.cooldown_until && new Date(rep.cooldown_until) > new Date());
      return {
        ...rep,
        inCooldown,
        cooldownRemaining: inCooldown ? Math.ceil((new Date(rep.cooldown_until) - new Date()) / (1000 * 60 * 60)) + 'h' : null,
        riskLevel: rep.trust_score >= 80 ? 'healthy' : rep.trust_score >= 50 ? 'caution' : 'high_risk'
      };
    });
  } catch (e) {
    return [];
  }
}

// ✅ Task sentiment analysis

import { normalizeIncomingText } from './message-parser.js';

const TASK_SENTIMENT_POSITIVE_KEYWORDS = [
    'ขอบคุณ',
    'เรียบร้อย',
    'สำเร็จ',
    'ดี',
    'เยี่ยม',
    'พร้อม',
    'great',
    'good',
    'thanks',
    'thank you',
    'awesome',
    'excellent',
    'done',
    'love',
    '💖',
    '❤️',
    '👍',
    '😊'
];

const TASK_SENTIMENT_NEGATIVE_KEYWORDS = [
    'ปัญหา',
    'ผิดพลาด',
    'ล่าช้า',
    'ไม่ทัน',
    'ช้า',
    'ติด',
    'กังวล',
    'เครียด',
    'ยกเลิก',
    'เสียหาย',
    'fail',
    'error',
    'issue',
    'bug',
    'broken',
    '😢',
    '😡'
];

const TASK_SENTIMENT_URGENT_KEYWORDS = [
    'ด่วน',
    'เร่ง',
    'รีบ',
    'urgent',
    'asap',
    'critical',
    'blocker',
    '⚠',
    '🔥'
];

const TASK_SENTIMENT_LABEL_BY_TYPE = {
    positive: 'เชิงบวก',
    neutral: 'เป็นกลาง',
    negative: 'กังวล',
    urgent: 'เร่งด่วน'
};

const TASK_SENTIMENT_EMOJI_BY_TYPE = {
    positive: '🙂',
    neutral: '😐',
    negative: '😟',
    urgent: '⚠️'
};

function countSentimentKeywordHits(normalizedText, keywords = []) {
    if (!normalizedText || !Array.isArray(keywords) || keywords.length === 0) {
        return 0;
    }

    let hits = 0;
    for (const keyword of keywords) {
        const normalizedKeyword = String(keyword || '').trim().toLowerCase();
        if (!normalizedKeyword) {
            continue;
        }

        if (normalizedText.includes(normalizedKeyword)) {
            hits += 1;
        }
    }

    return hits;
}

function analyzeTaskSourceSentiment(rawText = '') {
    const normalizedText = normalizeIncomingText(rawText).toLowerCase();
    if (!normalizedText) {
        return {
            type: 'neutral',
            label: TASK_SENTIMENT_LABEL_BY_TYPE.neutral,
            emoji: TASK_SENTIMENT_EMOJI_BY_TYPE.neutral,
            score: 0
        };
    }

    const positiveHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_POSITIVE_KEYWORDS);
    const negativeHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_NEGATIVE_KEYWORDS);
    const urgentHits = countSentimentKeywordHits(normalizedText, TASK_SENTIMENT_URGENT_KEYWORDS);

    let type = 'neutral';
    if (urgentHits > 0) {
        type = 'urgent';
    } else if (negativeHits > positiveHits && negativeHits > 0) {
        type = 'negative';
    } else if (positiveHits > 0) {
        type = 'positive';
    }

    const score = positiveHits - negativeHits - urgentHits;
    return {
        type,
        label: TASK_SENTIMENT_LABEL_BY_TYPE[type] || TASK_SENTIMENT_LABEL_BY_TYPE.neutral,
        emoji: TASK_SENTIMENT_EMOJI_BY_TYPE[type] || TASK_SENTIMENT_EMOJI_BY_TYPE.neutral,
        score
    };
}

export {
    TASK_SENTIMENT_POSITIVE_KEYWORDS,
    TASK_SENTIMENT_NEGATIVE_KEYWORDS,
    TASK_SENTIMENT_URGENT_KEYWORDS,
    TASK_SENTIMENT_LABEL_BY_TYPE,
    TASK_SENTIMENT_EMOJI_BY_TYPE,
    countSentimentKeywordHits,
    analyzeTaskSourceSentiment
};

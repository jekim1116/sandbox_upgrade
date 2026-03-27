const lodash = require('lodash');
const logger = require('../utils/logger');

function analyzeText(text, config) {
    logger.info("analyzeText 시작...");
    
    // 특수문자 제거 및 소문자 변환
    const cleanText = text.replace(/[^\w\s]/g, '').toLowerCase();
    
    // 단어 분리
    let words = cleanText.split(/\s+/);
    
    // 길이 및 불용어 필터링
    words = words.filter(word => 
        word.length >= config.minWordLength && 
        !config.stopWords.includes(word)
    );
    
    // 단어 빈도 계산
    const frequency = lodash.countBy(words);
    
    // 빈도수 높은 순, N개 추출
    const sorted = lodash.chain(frequency)
        .map((count, word) => ({ word, count }))
        .orderBy(['count'], ['desc'])
        .take(config.topN)
        .value();

    logger.info("분석 완료!");
    return {
        totalWordsFiltered: words.length,
        topWords: sorted
    };
}

module.exports = { analyzeText };

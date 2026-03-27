const logger = require('../utils/logger');

function formatResult(results) {
    logger.info("결과 포매팅 시작...");
    let output = `[텍스트 분석 결과 리포트]\n`;
    output += `=====================================\n`;
    output += `유효 단어 총합: ${results.totalWordsFiltered}개\n\n`;
    output += `[출현 빈도 Top 단어]\n`;
    
    results.topWords.forEach((item, idx) => {
        output += `  ${idx + 1}. "${item.word}" (등장 횟수: ${item.count}회)\n`;
    });
    
    output += `=====================================\n`;
    return output;
}

module.exports = { formatResult };

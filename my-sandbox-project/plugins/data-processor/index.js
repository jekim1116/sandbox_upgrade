const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const { analyzeText } = require('./core/analyzer');
const { formatResult } = require('./core/formatter');
const config = require('./config/settings.json');

(async () => {
    try {
        logger.info("=== Data Processor 텍스트 분석 파이프라인 시작 ===");
        
        // 1. 설정 로드 검증
        logger.info(`로드된 설정: 대상 길이 ${config.minWordLength}자 이상, 상위 ${config.topN}개 추출`);

        // 2. 가상의 텍스트 파일 읽기
        const dataPath = path.join(__dirname, 'data', 'input.txt');
        logger.info(`텍스트 데이터 읽는 중... (경로: ${dataPath})`);
        
        if (!fs.existsSync(dataPath)) {
            throw new Error("input.txt 파일을 찾을 수 없습니다.");
        }
        
        const rawText = fs.readFileSync(dataPath, 'utf-8');
        logger.info(`텍스트 로드 완료 (길이: ${rawText.length} bytes)`);

        // 3. 코어 모듈을 이용한 텍스트 분석 (내부적으로 lodash 사용)
        const analysisResult = analyzeText(rawText, config);

        // 4. 결과 포매팅 모듈 호출
        const formattedReport = formatResult(analysisResult);
        
        // 5. 파일 아웃풋 저장 (현재 워크스페이스에 자유롭게 파일 쓰기 가능)
        const outputPath = path.join(__dirname, 'analysis_result.json');
        fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2));
        logger.info(`분석 결과 JSON이 ${outputPath}에 성공적으로 저장되었습니다.`);

        // 6. 최종 결과 출력
        console.log("\n" + formattedReport);
        
        logger.info("=== 파이프라인 정상 종료 ===");
    } catch (err) {
        logger.error("시스템 에러 발생: " + err.message);
        process.exit(1);
    }
})();

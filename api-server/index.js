const crypto = require('crypto');
const { build_image, run_image, execute_tool, execute_tool_stdout, execute_tool_files } = require('./sandbox_manager.js');

async function testDirectFunctions() {
  console.log("=== 1. build_image (data-processor) ===");
  try {
    const buildRes = await build_image({ pluginName: 'data-processor' });
    console.log("[결과]", buildRes);

    console.log("\n=== 2. run_image (data-processor) ===");
    const runRes = await run_image({ pluginName: 'data-processor' });
    console.log("[결과]", runRes);

    console.log("\n=== 3. execute_tool (index.js) ===");
    console.log("...워커 컨테이너가 뜰 때까지 백그라운드에서 자동 대기 후 실행됩니다...");

    // sessionId를 난수값으로 생성
    const mockSessionId = crypto.randomUUID();
    console.log(`[테스트] 생성된 세션 ID: ${mockSessionId}`);

    console.log("\n--- [헬퍼 1: execute_tool_stdout 테스트] ---");
    const stdoutOnly = await execute_tool_stdout({
      sessionId: mockSessionId,
      pluginName: 'data-processor',
      toolName: 'index.js'
    });
    console.log("[stdout 결과만 추출]:\n", stdoutOnly);

    console.log("\n--- [헬퍼 2: execute_tool_files 테스트] ---");
    const pathOnly = await execute_tool_files({
      sessionId: mockSessionId,
      pluginName: 'data-processor',
      toolName: 'index.js'
    });
    console.log("[파일 저장 경로만 추출]:", pathOnly);

    console.log("\n=== 모든 테스트 완료 ===");
  } catch (e) {
    console.error("테스트 중 에러 발생:", e);
  } finally {
    process.exit(0);
  }
}

testDirectFunctions();

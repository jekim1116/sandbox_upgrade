const fs = require('fs');
const path = require('path');
const { Worker } = require('bullmq');
const { spawn } = require('child_process');

const connection = { host: process.env.REDIS_HOST || 'localhost', port: 6379 };
const queueName = process.env.QUEUE_NAME || 'queue:default';

console.log(`👷 [${queueName}] 워커 서버 대기 중... (동시성: 5)`);

const worker = new Worker(queueName, async job => {
  const { sessionId, pluginName, toolName, language, args = [], timeout = 30000 } = job.data;
  console.log(`[Job ${job.id}] 세션: ${sessionId}, 플러그인: ${pluginName}, 도구: ${toolName}`);

  // 인터프리터 결정
  let bin = 'python3';
  if (language === 'node') bin = 'node';

  return new Promise((resolve, reject) => {
    const pluginDir = path.join(__dirname, 'plugins', pluginName);
    const timeoutSec = Math.ceil(timeout / 1000);

    // Job별 고유 아웃풋 디렉토리를 계층형으로 생성 (sandbox_output/{plugin}_{session}/{jobId})
    const sessionDirName = `${pluginName}_${sessionId}`;
    const outputDir = `/app/sandbox_output/${sessionDirName}/${job.id}`;
    fs.mkdirSync(outputDir, { recursive: true });

    // 원본 코드 목록 기록
    const originalFiles = fs.readdirSync(pluginDir);

    // 원본 코드를 워크스페이스로 복사
    fs.cpSync(pluginDir, outputDir, { recursive: true });

    const bwrapArgs = [
      '--ro-bind', '/', '/',
      '--dev', '/dev',
      '--tmpfs', '/tmp',
      '--unshare-all',
      '--uid', '1000',
      '--setenv', 'NODE_PATH', '/app/node_modules:/plugin-env/node_modules',
      '--dir', '/tmp/workspace',                  // 마운트 지점 생성
      '--bind', outputDir, '/tmp/workspace',       // 아웃풋 폴더를 워크스페이스로 마운트
      '--chdir', '/tmp/workspace',                 // 실행 위치 고정
      bin, `/tmp/workspace/${toolName}`, ...args
    ];

    const sandbox = spawn('timeout', [String(timeoutSec), 'bwrap', ...bwrapArgs]);

    let output = '';
    let errorOutput = '';

    sandbox.stdout.on('data', (data) => { output += data.toString(); });
    sandbox.stderr.on('data', (data) => { errorOutput += data.toString(); });

    sandbox.on('close', (exitCode) => {
      // 1. 원본 코드 제거
      for (const fileName of originalFiles) {
        try {
          const targetPath = path.join(outputDir, fileName);
          fs.rmSync(targetPath, { recursive: true, force: true });
        } catch (e) { }
      }

      // 2. stdout/stderr 저장
      fs.writeFileSync(path.join(outputDir, 'stdout.txt'), output);
      if (errorOutput) fs.writeFileSync(path.join(outputDir, 'stderr.txt'), errorOutput);

      if (exitCode === 0) {
        console.log(`[Job ${job.id}] 성공:\n${output}`);
        resolve({ result: output, outputPath: outputDir });
      } else if (exitCode === 124) {
        console.log(`[Job ${job.id}] 타임아웃 (${timeoutSec}초)`);
        reject(new Error(`실행 시간 초과 (${timeoutSec}초)`));
      } else {
        console.log(`[Job ${job.id}] 에러:\n${errorOutput}`);
        reject(new Error(errorOutput));
      }
    });
  });
}, { connection, concurrency: 5 });

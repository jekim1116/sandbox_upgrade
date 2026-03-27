const { Queue, QueueEvents } = require('bullmq');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const connection = { host: process.env.REDIS_HOST || 'localhost', port: 6379 };
const PLUGINS_DIR = process.env.PLUGINS_DIR || path.join(__dirname, '..', 'plugins');
const TEMPLATES_DIR = process.env.TEMPLATES_DIR || '/app/dockerfile_templates';

// 플러그인별 큐 캐시
const queues = {};
const queueEvents = {};

function getQueue(pluginName) {
  if (!queues[pluginName]) {
    const qName = `queue:${pluginName}`;
    queues[pluginName] = new Queue(qName, { connection });
    queueEvents[pluginName] = new QueueEvents(qName, { connection });
  }
  return { queue: queues[pluginName], events: queueEvents[pluginName] };
}

// 언어 감지: package.json → node, requirements.txt → python
function detectLanguage(pluginDir) {
  if (fs.existsSync(path.join(pluginDir, 'package.json'))) return 'node';
  if (fs.existsSync(path.join(pluginDir, 'requirements.txt'))) return 'python';
  throw new Error('package.json 또는 requirements.txt가 없어 언어를 판별할 수 없습니다.');
}

// ─────────────────────────────────────────────
// 1. build_image
// ─────────────────────────────────────────────
async function build_image({ pluginName }) {
  if (!pluginName) throw new Error('pluginName이 필요합니다.');

  const pluginDir = path.join(PLUGINS_DIR, pluginName);
  if (!fs.existsSync(pluginDir)) throw new Error(`플러그인 '${pluginName}'을 찾을 수 없습니다.`);

  const language = detectLanguage(pluginDir);
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, `Dockerfile.${language}`), 'utf-8');

  // 플러그인 전용 패키지 설치 명령 (템플릿 치환)
  let pluginInstall = '';
  if (language === 'node') {
    pluginInstall = `COPY plugins/${pluginName}/package.json /plugin-env/package.json\nRUN cd /plugin-env && npm install`;
  } else {
    pluginInstall = `COPY plugins/${pluginName}/requirements.txt /plugin-env/requirements.txt\nRUN pip3 install -r /plugin-env/requirements.txt`;
  }

  const dockerfile = template.replace('# {{PLUGIN_PACKAGES}}', pluginInstall);
  const dockerfilePath = `/tmp/Dockerfile.plugin-${pluginName}`;
  fs.writeFileSync(dockerfilePath, dockerfile);

  const imageName = `plugin-${pluginName}`;
  try {
    execSync(`docker build -f ${dockerfilePath} -t ${imageName} /build-context`, { stdio: 'pipe' });
    return { success: true, pluginName, language, image: imageName };
  } catch (e) {
    throw new Error(`이미지 빌드 실패: ${e.stderr?.toString() || e.message}`);
  }
}

// ─────────────────────────────────────────────
// 2. run_image — 빌드된 이미지를 컨테이너로 실행 (플러그인별 1개)
// ─────────────────────────────────────────────
async function run_image({ pluginName }) {
  if (!pluginName) throw new Error('pluginName이 필요합니다.');

  const imageName = `plugin-${pluginName}`;
  const containerName = `worker-${pluginName}`;
  const network = process.env.DOCKER_NETWORK || 'my-sandbox-project_default';
  const hostPluginsPath = process.env.PLUGINS_HOST_DIR || '/app/plugins';
  const hostSandboxPath = process.env.SANDBOX_OUTPUT_HOST_DIR || '/app/sandbox_output';

  try {
    try { execSync(`docker rm -f ${containerName} 2>/dev/null`); } catch (e) { }

    execSync([
      'docker', 'run', '-d',
      '--name', containerName,
      '--network', network,
      '-e', 'REDIS_HOST=redis',
      '-e', `QUEUE_NAME=queue:${pluginName}`,
      '-v', `"${hostPluginsPath}:/app/plugins:ro"`,
      '-v', `"${hostSandboxPath}:/app/sandbox_output:rw"`,
      '--security-opt', 'seccomp:unconfined',
      imageName,
    ].join(' '), { stdio: 'pipe' });

    return {
      pluginName,
      container: containerName,
      image: imageName,
      status: 'running',
    };
  } catch (e) {
    throw new Error(`컨테이너 실행 실패: ${e.stderr?.toString() || e.message}`);
  }
}

// ─────────────────────────────────────────────
// 3. execute_tool — 특정 세션/요청의 작업을 큐에 위임
// ─────────────────────────────────────────────
async function execute_tool({ sessionId, pluginName, toolName, args = [], timeout = 30000 }) {
  // sessionId가 없으면 랜덤 생성
  const finalSessionId = sessionId || crypto.randomUUID();

  if (!finalSessionId || !pluginName || !toolName) {
    throw new Error('sessionId, pluginName, toolName이 모두 필요합니다.');
  }

  const pluginDir = path.join(PLUGINS_DIR, pluginName);
  if (!fs.existsSync(pluginDir)) throw new Error(`플러그인 '${pluginName}'을 찾을 수 없습니다.`);

  const language = detectLanguage(pluginDir);
  const { queue, events } = getQueue(pluginName);

  // jobId를 BullMQ의 작업 ID 옵션으로 주입하여 추적 가능하게 함
  const jobId = crypto.randomUUID();
  const job = await queue.add('execute-tool', {
    sessionId: finalSessionId, jobId, pluginName, toolName, language, args, timeout,
  }, { jobId });

  try {
    const workerResponse = await job.waitUntilFinished(events, timeout);
    return {
      sessionId: finalSessionId,
      jobId,
      pluginName,
      toolName,
      status: 'completed',
      output: workerResponse.result,
      outputPath: workerResponse.outputPath
    };
  } catch (e) {
    return { sessionId, jobId, pluginName, toolName, status: 'failed', error: e.message };
  }
}

/**
 * 헬퍼: 실행 결과의 stdout만 문자열로 반환
 */
async function execute_tool_stdout(args) {
  const res = await execute_tool(args);
  if (res.status === 'failed') throw new Error(res.error);
  return res.output;
}

async function execute_tool_files(args) {
  const res = await execute_tool(args);
  if (res.status === 'failed') throw new Error(res.error);
  return res.outputPath;
}

module.exports = {
  build_image,
  run_image,
  execute_tool,
  execute_tool_stdout,
  execute_tool_files
};

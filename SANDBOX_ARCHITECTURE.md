# 🛡️ 샌드박스 아키텍처 

## 🎨 역할 분담 기반의 이중 격리 체계 (2-Layer Isolation)

본 시스템은 단순히 무식하게 겹겹이 싼 격리가 아니라, **[런타임 환경 조성]과 [작업 고립]의 책임을 완벽히 분리**하여 시스템의 유연성과 안전성을 동시에 잡았습니다.

### 🛡️ Layer 1. Docker Container: 호스트와 분리된 동적 런타임 이미지 풀
- **역할 (Runtime Image Management)**: 각 플러그인(Node.js, Python 등)마다 요구하는 서로 다른 OS 환경, 의존성 라이브러리 패키지를 호스트 OS 어지럽힘 전혀 없이 개별 **이미지로 독립 관리**합니다.
- **가치**: 샌드박스의 기반이 되는 '도화지' 자체를 호스트와 분리시켜, 런타임 버전 충돌이나 패키지 오염을 원천 차단합니다. 

### 🛡️ Layer 2. Bubblewrap (bwrap): 완벽히 통제된 격리 실행 환경
- **역할 (Execution Isolation)**: 컨테이너라는 든든한 기반 위에서, 실제 외부 스크립트가 실행될 때 개입하는 **보안의 핵심 코어**입니다.
- **가치**: 런타임 내부의 프로세스 권한마저 박탈하고, 커널 네임스페이스 수준에서 코드를 고립시킵니다. 네트워크 통신을 차단하고, 시스템 전체를 읽기 전용으로 강제하며, 오직 지정된 특정 폴더(`/tmp/workspace`)에만 접근하게 만들어 완벽한 보안 스웜(sandbox)을 형성합니다.

### 🌐 샌드박스 전체 시스템 개괄 (High-Level Architecture)

`AgentX`가 `BullMQ (Redis)`를 통해 작업을 위임하면, 큐에서는 각 플러그인별로 할당된 단일 **Docker 컨테이너(Worker)**로 작업을 라우팅합니다. 
각 워커 컨테이너 내부는 **동시성(Concurrency) 5**로 설정되어 있어, 동시에 들어온 여러 요청이 서로 간섭하지 않도록 **각각 물리적으로 다른 폴더에 격리된 채 `bwrap`을 통해 병렬 실행**됩니다.

```mermaid
graph TD
    API[AgentX] -->|Job Request| BullMQ[(Redis / BullMQ Queue)]
    
    BullMQ -->|queue:pluginA| WorkerA
    BullMQ -->|queue:pluginB| WorkerB
    
    subgraph WorkerA ["Plugin A Container (Worker)"]
        direction TB
        A_Q[BullMQ Consumer - Concurrency: 5]
        A_Q --> A_Job1[bwrap in Folder 1]
        A_Q --> A_Job2[bwrap in Folder 2]
        A_Q --> A_JobN[... up to 5 bwraps]
    end
    
    subgraph WorkerB ["Plugin B Container (Worker)"]
        direction TB
        B_Q[BullMQ Consumer - Concurrency: 5]
        B_Q --> B_Job1[bwrap in Folder 1]
        B_Q --> B_Job2[bwrap in Folder 2]
        B_Q --> B_JobN[... up to 5 bwraps]
    end
```

---

### 🔄 샌드박스 내부 고립 메커니즘 (Deep Dive)

```mermaid
graph TD
    subgraph Host ["Host OS"]
        Docker[Docker Engine]
    end
    
    subgraph WorkerContainer ["Docker Container (Worker Runtime)"]
        direction TB
        Node[Worker Node Process]
        
        subgraph BwrapSandbox ["Bubblewrap (bwrap) Sandbox"]
            direction TB
            User[Non-privileged User: 1000]
            Net[--unshare-net: Network Blocked]
            PID[--unshare-pid: Private PID Map]
            FS[--ro-bind: Read-Only Root Filesystem]
            Write["--bind: /tmp/workspace (Writable)"]
            
            Process[Plugin Script Executing...]
            
            Process --> Write
            Process -.-> x[No Network Access]
            Process -.-> y[No System Modification]
        end
        
        Node -->|Spawn| User
    end
    
    Docker --> Node
```

---

## 📁 샌드박스 실행 흐름 (Execution Flow)

API 매니저 모듈(`sandbox_manager`)을 통해 요청을 보냈을 때 워커 컨테이너 내부에서 일어나는 상세 시퀀스입니다.

```mermaid
sequenceDiagram
    participant API as AgentX (Sandbox Manager)
    participant Redis as BullMQ (Queue)
    participant Worker as Worker Container
    participant Bwrap as bwrap Sandbox
    participant Vol as Mounted Vol (/app/sandbox_output)

    API->>Redis: Job 등록 (plugin, script, args)
    Redis-->>Worker: Job 할당 (Concurrency: 5)
    
    Note over Worker: 1. Workspace 준비
    Worker->>Vol: {jobId} 폴더 생성 (내부 경로)
    Worker->>Vol: 플러그인 소스 코드 '임시' 복제 (격리 실행용)
    
    Note over Worker: 2. 샌드박스 기동
    Worker->>Bwrap: bwrap 명령어 호출 (각종 --unshare 플래그)
    Bwrap->>Vol: {jobId} 폴더를 /tmp/workspace로 바인딩
    
    Note over Bwrap: 3. 격리 실행
    Bwrap->>Bwrap: 내부 스크립트 실행 (결과물은 /tmp/workspace에 저장)
    Bwrap-->>Worker: 실행 완료 (stdout 문자열 반환)
    
    Note over Worker: 4. 뒤처리 (Cleanup - 핵심)
    Worker->>Vol: 복제한 플러그인 '원본 코드만' 즉시 완전 삭제!
    Worker->>Vol: (최종) stdout.txt 및 결과 파일만 영구 보존
    
    Note over Vol: Docker 엔진에 의해 호스트의 ./sandbox_output 와 자동 동기화됨
    
    Worker-->>Redis: Job 완료
    API-->>API: 최종 결과 반환
```

---

## 🔒 bwrap 보안 정책 (Security Policy)

`worker-server` 내부에서 `bwrap`을 호출할 때 적용된 핵심 보안 플래그와 그 의미는 다음과 같습니다.

| 플래그 | 설명 | 보안 효과 |
|---|---|---|
| `--unshare-net` | 네트워크 네임스페이스 분리 | 아웃바운드/인바운드 네트워크 **원천 차단** (외부 C&C 서버 통신 불가) |
| `--unshare-pid` | 프로세스 ID 네임스페이스 분리 | 샌드박스 내부에서 외부 주요 프로세스(PID 1 등) 관찰 및 간섭 원천 불가능 |
| `--ro-bind / /` | 루트 전체 읽기 전용 바인딩 | 시스템 설정 파일 변조 및 실행 파일 덮어쓰기 등 파일시스템 훼손 방지 |
| `--bind DIR /tmp/workspace` | 특정 폴더만 쓰기 허용 | 정해진 작업 공간 외 어떤 곳에도 백도어 파일이나 잔여물 생성 불가 |
| `--uid/gid 1000` | 권한 강제 하락 (Rootless) | 프로세스가 컨테이너 내 관리자 권한을 탈취하려 해도 무용지물 (EUID 1000 고정) |

#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync, exec } from 'child_process';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { promisify } from 'util';

const execPromise = promisify(exec);

// 系统端口配置
const SYSTEM_PORTS = {
  win32: new Set([
    21, 22, 23, 25, 53, 80, 110, 443, 3389, 593, 445, 135, 139, 1433,
  ]),
  darwin: new Set([22, 53, 80, 443, 123, 445, 548, 88]),
  linux: new Set([22, 25, 53, 80, 110, 123, 21, 23, 3389]),
  common: new Set([...Array(1024).keys()]), // 0-1023
};

// 工具定义
const PortCleanerArgsSchema = z.object({
  port: z.number().int().min(1).max(65535).describe('需要清理的端口号'),
});

const PortScanArgsSchema = z.object({
  port: z.number().int().min(1).max(65535).describe('需要查找的端口号'),
});

class PortCleanerService {
  /**
   * 搜索指定端口号的进程信息。
   * @param port 端口号
   * @returns pid: string; 进程号。
   *          name?: string; 进程名称。
   *          user?: string; 进程所属用户。
   *          protocol?: string; 进程使用的协议。
   */
  static getProcessInfoByPort(
    port: number,
  ): { pid: string; name?: string; user?: string; protocol?: string }[] {
    const platform = process.platform;

    if (platform === 'win32') {
      const result = execSync(`netstat -ano | findstr :${port}`).toString();
      return result
        .split('\n')
        .filter(Boolean)
        .filter((line) => line.includes('LISTENING'))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          // 0: 协议
          // 1: 本地地址
          // 2: 外部地址
          // 3: 状态
          // 4: PID
          return {
            pid: parts[4] || 'N/A',
            name: parts[1],
            protocol: parts[0],
          };
        });
    } else {
      const result = execSync(`lsof -i :${port} -P -n -T`).toString();
      return result
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.includes('PID'))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          // 0: 命令
          // 1: PID
          // 2: 用户
          // 3: FD
          // 4: 类型
          // 5: 设备
          // 6: 大小/偏移
          // 7: 节点/协议
          // 8: 名称
          return {
            pid: parts[1],
            name: parts[0],
            user: parts[2],
            protocol: parts[7],
          };
        });
    }
  }

  static async killProcess(pid: string): Promise<boolean> {
    const platform = process.platform;
    try {
      if (platform === 'win32') {
        await execPromise(`taskkill /F /PID ${pid} /T`);
      } else {
        await execPromise(`kill -9 ${pid}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  async handlePortClean(port: number) {
    console.log(`清理端口: ${port}`);
    // 系统端口保护检查
    if (this.isSystemPort(port)) {
      return this.handleSystemPortRequest(port);
    }

    try {
      const infos = await PortCleanerService.getProcessInfoByPort(port);
      console.log(`找到进程: ${infos.join(', ')}`);

      if (infos.length === 0) {
        return {
          content: [{ type: 'text', text: `端口 ${port} 未被占用` }],
          isError: false,
        };
      }
      const pids = infos.map((info) => info.pid);

      const results = await this.processTermination(pids);
      console.log(`清理结果: ${JSON.stringify(results)}`);
      return this.formatResponse(results, port);
    } catch (error) {
      console.error(`端口清理失败: ${error}`);
      return {
        content: [
          { type: 'text', text: `清理失败: ${(error as Error).message}` },
        ],
        isError: true,
      };
    }
  }

  private isSystemPort(port: number): boolean {
    const platform = process.platform;
    const isSystemPort =
      SYSTEM_PORTS.common.has(port) ||
      SYSTEM_PORTS[platform as keyof typeof SYSTEM_PORTS]?.has(port);
    return isSystemPort;
  }

  private async handleSystemPortRequest(port: number) {
    const processes = PortCleanerService.getProcessInfoByPort(port);
    const processInfo = processes
      .map(
        (p) =>
          `PID: ${p.pid}, 进程名: ${p.name || '无'}, 用户: ${
            p.user || '无'
          }, 协议: ${p.protocol || '无'}`,
      )
      .join('\n');

    const warningMessage =
      `警告: 端口 ${port} 属于系统关键端口，清理可能导致系统服务中断！\n` +
      `当前占用进程:\n${processInfo}\n` +
      `如果需要清理，请在命令行中执行：${processes
        .map((p) => `kill -9 ${p.pid}`)
        .join(' \n ')}`;

    // 通过MCP协议请求用户确认
    return {
      content: [{ type: 'text', text: warningMessage }],
      isError: false,
    };
  }

  private async processTermination(pids: string[]) {
    const results = await Promise.all(
      pids.map(async (pid) => {
        const success = await PortCleanerService.killProcess(pid);
        return { pid, success };
      }),
    );

    const killed = results.filter((r) => r.success).map((r) => r.pid);
    const failed = results.filter((r) => !r.success).map((r) => r.pid);

    return {
      killedPids: killed,
      failedPids: failed,
    };
  }

  private formatResponse(
    results: { killedPids: string[]; failedPids: string[] },
    port: number,
  ) {
    const successMsg =
      results.killedPids.length > 0
        ? `已终止进程: ${results.killedPids.join(', ')}`
        : '未找到相关进程';

    const errorMsg =
      results.failedPids.length > 0
        ? `无法终止进程: ${results.failedPids.join(', ')}`
        : '';

    return {
      content: [
        { type: 'text', text: successMsg },
        { type: 'text', text: errorMsg },
      ],
      isError: results.failedPids.length > 0,
    };
  }
}

// 增强的MCP服务器配置
const server = new Server(
  {
    name: 'mcp-port-cleaner',
    version: '2.0.0',
    metadata: {
      systemProtection: true,
      supportedPlatforms: ['win32', 'darwin', 'linux'],
    },
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

/**
 * 注册Request handler，列出支持的工具。
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'port_scan',
        description:
          '跨平台端口占用情况扫描工具（支持Windows/macOS/Linux）, 用于快速检查用户提供的端口号是哪些应用在监听。',
        inputSchema: zodToJsonSchema(PortScanArgsSchema),
        metadata: {
          systemImpact: true,
          protectionLevel: 'critical',
        },
      },
      {
        name: 'port_clean',
        description:
          '跨平台端口清理工具（支持Windows/macOS/Linux），用于终止指定端口的进程。注意，工具会反馈是否是系统端口或关键端口，如果是，需要向用户发起确认申请，用户确认后，才能执行清理操作。',
        inputSchema: zodToJsonSchema(PortCleanerArgsSchema),
        metadata: {
          systemImpact: true,
          protectionLevel: 'critical',
        },
      },
    ],
  };
});

// 注册CallTool handler，处理工具调用请求
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args, metadata } = request.params;
    switch (name) {
      case 'port_scan':
        const infos = PortCleanerService.getProcessInfoByPort(
          (args as any).port,
        );
        return {
          content: [
            {
              type: 'text',
              text: `端口 ${(args as any).port} 使用情况:\n${infos
                .map(
                  (p) =>
                    `PID: ${p.pid}, 进程名: ${p.name || '无'}, 用户: ${
                      p.user || '无'
                    }, 协议: ${p.protocol || '无'}`,
                )
                .join('\n')}`,
            },
          ],
          isError: false,
        };

      case 'port_clean':
        if ((metadata as any)?.requiresConfirmation) {
          // 处理用户确认流程
          if ((args as any).action === 'confirm_cleanup') {
            return new PortCleanerService().handlePortClean((args as any).port);
          }
          return {
            content: [{ type: 'text', text: '操作已取消' }],
            isError: false,
          };
        }
        const service = new PortCleanerService();
        return await service.handlePortClean((args as any).port);

      default:
        return {
          content: [{ type: 'text', text: `不支持的工具: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [
        { type: 'text', text: `服务异常: ${(error as Error).message}` },
      ],
      isError: true,
    };
  }
});

// 启动服务
async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log('\x1b[32mMCP-端口清理服务: ✅已启动 (跨平台增强版)\x1b[0m');
  } catch (error) {
    console.error('\x1b[31m服务启动失败:', error, '\x1b[0m');
    process.exit(1);
  }
}

runServer().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});

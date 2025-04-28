#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// 工具定义
const PortCleanerArgsSchema = z.object({
  port: z.number().int().min(1).max(65535).describe('需要清理的端口号'),
});

type PortCleanerArgs = z.infer<typeof PortCleanerArgsSchema>;

// 服务实现
class PortCleanerService {
  async handlePortClean(port: number) {
    try {
      // 查找占用端口的进程
      const output = execSync(`lsof -i :${port} -t`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });

      const pids = output.trim().split('\n').filter(Boolean);

      if (pids.length === 0) {
        return {
          content: [{ type: 'text', text: `端口 ${port} 未被占用` }],
          isError: false,
        };
      }

      // 终止进程并返回结果
      const killedPids: string[] = [];
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
          killedPids.push(pid);
        } catch (killError) {
          console.error(`终止进程 ${pid} 失败: ${killError}`);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text:
              killedPids.length > 0
                ? `已终止进程: ${killedPids.join(', ')}`
                : `无法终止端口 ${port} 的进程`,
          },
        ],
        isError: killedPids.length === 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      return {
        content: [
          {
            type: 'text',
            text: `端口清理失败: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }
}

// 服务器配置
const server = new Server(
  {
    name: 'mcp-port-cleaner',
    version: '1.0.0',
    description: '端口清理服务 - 用于开发环境端口冲突解决',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// 注册工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'port_cleaner',
        description: '查找并终止占用指定端口的进程，解决开发环境端口冲突问题',
        inputSchema: zodToJsonSchema(
          PortCleanerArgsSchema,
        ) as typeof ToolSchema.shape.inputSchema,
      },
    ],
  };
});

// 处理请求
const portCleaner = new PortCleanerService();
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'port_cleaner': {
        // 显式类型处理
        const parsed = PortCleanerArgsSchema.safeParse(args) as {
          success: boolean;
          data?: PortCleanerArgs;
          error?: z.ZodError;
        };

        if (!parsed.success) {
          const errorDetails = parsed.error?.errors
            .map((e) => `参数 ${e.path.join('.')} 校验失败: ${e.message}`)
            .join('; ');

          throw new Error(`无效输入: ${errorDetails || '未知参数错误'}`);
        }

        // 类型安全的数据访问
        const { port } = parsed.data as PortCleanerArgs;
        const result = await portCleaner.handlePortClean(port);

        return {
          content: result.content,
          isError: result.isError,
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `服务异常: ${errorMessage}` }],
      isError: true,
    };
  }
});

// 启动服务
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP-端口清理服务: ✅已启动 (标准输入输出模式)');
}

runServer().catch((error) => {
  console.error('服务启动失败:', error);
  process.exit(1);
});

import { Controller, Get, Res, Param, Body, Delete, Post, Put, Logger, Query } from "@nestjs/common";
import { createMakefileClawAgent, createModel, HumanMessage, FileSaver } from "@makefile-claw/agent-core";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
// pdf-parse 是 CommonJS 包且无类型声明，用 createRequire 在 ESM 中安全加载
const require = createRequire(import.meta.url);
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require("pdf-parse");
import { ModelsService } from "./models.service.js";
import { SkillsService } from "../skills/skills.service.js";
import { ClawConfigService } from "../claw-config/claw-config.service.js";

/**
 * 从文档 buffer 中提取纯文本（支持 docx / xlsx / pdf / txt 等）
 * @param buffer 文件二进制数据
 * @param ext 文件扩展名（含点，如 '.docx'）
 * @returns 提取的文本内容
 */
async function extractTextFromBuffer(buffer: Buffer, ext: string): Promise<string> {
  const lower = ext.toLowerCase();
  try {
    if (lower === ".docx") {
      const result = await mammoth.extractRawText({ buffer });
      return result.value || "";
    }
    if (lower === ".xlsx" || lower === ".xls") {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheets: string[] = [];
      for (const name of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        if (csv.trim()) sheets.push(`【工作表: ${name}】\n${csv}`);
      }
      return sheets.join("\n\n");
    }
    if (lower === ".pdf") {
      const data = await pdfParse(buffer);
      return data.text || "";
    }
    // txt / md / csv / json 等文本文件，直接用 utf-8 解码
    return buffer.toString("utf-8");
  } catch (e) {
    console.error(`[extractText] 解析 ${ext} 失败:`, (e as Error).message);
    return "";
  }
}

/** 判断文件是否为图片类型 */
function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/**
 * 工作区文件树节点类型（与前端 @ant-design/x Folder 组件的 FolderTreeData 对齐）
 */
interface WorkspaceTreeNode {
  title: string;
  path: string;
  isLeaf: boolean;
  children?: WorkspaceTreeNode[];
}

@Controller("models-streaming")
export class ModelsLangchainController {

  private readonly logger = new Logger(ModelsLangchainController.name);

  constructor(
    private readonly modelsService: ModelsService,
    private readonly skillsService: SkillsService,
    private readonly clawConfigService: ClawConfigService,
  ) {}

  /**
   * 大模型流式对话接口，兼容 OpenAI SSE 协议格式
   * 请求地址：POST /models-streaming
   *
   * 【请求体】（JSON）
   * input：用户提问文本
   * chatId：会话ID（即上一轮返回的 sessionId），首次对话为空
   * agent：选中的 Agent 名称
   * skills：逗号分隔的技能名称列表
   * attachments：附件数组，每项 { name, type, data(base64) }
   *   - 图片（image/*）：以 data URL 形式传给多模态模型识别
   *   - 文档（docx/xlsx/pdf/txt 等）：后端提取文本后拼接到提问中
   */
  @Post()
  async test(@Body() body: any, @Res() res: any) {
    // 校验必填入参，input 不存在直接返回400
    if (!body.input) {
      res.status(400).send("input is required");
      return;
    }

    // SSE标准响应头配置
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    // 立即把响应头发送给客户端，不等待第一次业务数据
    res.flushHeaders?.();

    let { input, chatId, skills, agent: agentParam, attachments, mcpServers } = body;
    // 去除首尾空白字符
    input = String(input).trim();
    // Agent 名称：前端选择透传，为空时回退到默认 "TestAgent"
    const agentName = agentParam ? String(agentParam) : "TestAgent";

    // 解析 skills 参数：逗号分隔的技能名称数组，为空则不注入任何技能
    const skillNames: string[] = skills
      ? String(skills)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

    // 解析 mcpServers 参数：前端选中的 MCP 服务器名称数组，
    // 支持数组形式或逗号分隔字符串。为空则不加载任何远程 MCP 工具。
    const mcpServerNames: string[] = Array.isArray(mcpServers)
      ? mcpServers.map((s: unknown) => String(s).trim()).filter(Boolean)
      : mcpServers
        ? String(mcpServers)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [];

    // 处理附件：图片转 data URL 供多模态模型识别，文档提取文本拼接到提问
    const imageParts: { type: "image_url"; image_url: { url: string } }[] = [];
    let docText = "";
    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        const name: string = att?.name ?? "file";
        const mime: string = att?.type ?? "";
        const data: string = att?.data ?? "";
        if (!data) continue;
        const ext = path.extname(name).toLowerCase();
        if (isImageMime(mime)) {
          // 图片：构造 data URL，传给多模态大模型
          const dataUrl = `data:${mime};base64,${data}`;
          imageParts.push({ type: "image_url", image_url: { url: dataUrl } });
        } else {
          // 文档：提取纯文本，拼接到用户提问中
          try {
            const buf = Buffer.from(data, "base64");
            const text = await extractTextFromBuffer(buf, ext);
            if (text.trim()) {
              docText += `\n\n【附件文件: ${name}】\n${text}\n`;
            }
          } catch (e) {
            this.logger.warn(`[附件] 解析 ${name} 失败: ${(e as Error).message}`);
          }
        }
      }
    }
    // 若有文档文本，拼接到用户提问前面
    if (docText) {
      input = docText + "\n\n用户提问：" + input;
    }

    // 记录请求概要（input 截断到 100 字符，避免日志过长）
    const inputPreview = input.length > 100 ? input.slice(0, 100) + '...' : input;
    this.logger.log(
      `[对话请求] agent=${agentName}, skills=[${skillNames.join(', ')}], ` +
      `mcpServers=[${mcpServerNames.join(', ')}], ` +
      `chatId=${chatId || '(新会话)'}, images=${imageParts.length}, docs=${docText ? 'yes' : 'no'}, ` +
      `input="${inputPreview}"`,
    );

    // 加载选中技能的正文内容，合并为一段注入到 system prompt
    let skillsContent = '';
    if (skillNames.length > 0) {
      const loadedSkills = skillNames
        .map((name: string) => {
          try {
            return this.skillsService.findOne(name);
          } catch {
            // 技能不存在或解析失败时跳过，不阻断对话
            return null;
          }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        // 只注入已启用的技能
        .filter((s) => s.active);
      if (skillNames.length > 0) {
        this.logger.log(
          `已加载 ${loadedSkills.length}/${skillNames.length} 个技能: ${loadedSkills.map((s) => s.name).join(', ')}` +
          (loadedSkills.length < skillNames.length ? '（部分技能不存在或已停用，已跳过）' : ''),
        );
      }
      skillsContent = loadedSkills
        .map((s) => {
          // 重写技能正文中的路径引用，使 Agent 能找到技能内部的脚本和参考文件。
          // 技能通常假设自己位于 ${CLAUDE_PLUGIN_ROOT}/.claude/skills/<name>/ 下，
          // 但实际安装在 ~/.makefile_claw/skills/<name>/。
          // 1) 替换 ${CLAUDE_PLUGIN_ROOT} 为技能目录绝对路径
          // 2) 替换 .claude/skills/<name> 为 <skillDir>/.claude/skills/<name>
          let content = s.content;
          const skillDir = s.skillDir.replace(/\\/g, '/');
          content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, skillDir);
          const escapedName = s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          content = content.replace(
            new RegExp(`\\.claude/skills/${escapedName}`, 'g'),
            `${skillDir}/.claude/skills/${s.name}`,
          );
          return `### 技能：${s.name}\n${content}`;
        })
        .join('\n\n');
    }

    // ==========================================================

    // 会话ID（threadId）策略：
    // - 前端传入的 chatId 即上一轮返回的 sessionId，直接复用为本次 threadId，
    //   Agent 会从 ~/.makefile_claw/memory/<threadId>.json 恢复历史上下文
    // - 首次对话 chatId 为空，生成新的 UUID 作为本次会话的持久化标识
    const threadId = chatId || randomUUID();
    // 回传给前端的 sessionId 与 threadId 保持一致，前端下次请求作为 chatId 传回
    const sessionId = threadId;

    // 创建 Agent：内部已绑定 FileSaver 检查点存储器，
    // 会话状态自动持久化到 ~/.makefile_claw/memory/<threadId>.json
    // 全局运行超时，超时后 abort 信号触发，进入 catch 再由 finally 强制清理
    // 技能驱动的 Agent 可能执行多轮工具调用（搜索文件、读取参考文档等），
    // 300s 对长任务偏紧（实测 28 次工具调用即触顶），放宽到 10 分钟
    const RUN_TIMEOUT_MS = 600 * 1000
    // 无活动超时：模型连续 IDLE_TIMEOUT_MS 不输出任何分片时主动中断。
    // 模型卡死、网络中断等场景下快速失败，避免干等到总超时。
    const IDLE_TIMEOUT_MS = 90 * 1000
    // 单轮对话最大工具调用次数：防止上下文无限膨胀导致每轮越来越慢最终超时。
    // 超过上限后主动中止并提示用户，已完成的步骤已由 FileSaver 持久化，可继续。
    const MAX_TOOL_CALLS_PER_RUN = 25
    this.logger.log(`创建 Agent: ${agentName}, threadId=${threadId}, 总超时=${RUN_TIMEOUT_MS / 1000}s, 无活动超时=${IDLE_TIMEOUT_MS / 1000}s, 最大工具调用=${MAX_TOOL_CALLS_PER_RUN}次`);
    const agentCreateStart = Date.now();
    // Agent 创建失败（如智能体/模型配置不存在）时，此时 SSE 响应头已下发，
    // 不能再抛给全局异常过滤器（会触发 ERR_HTTP_HEADERS_SENT），
    // 直接在流内下发错误分片并正常结束流
    let created: Awaited<ReturnType<typeof createMakefileClawAgent>>;
    try {
      // 根据前端选中的 MCP 服务器名称，从配置中解析出完整的远程服务器信息（url + headers），
      // 只包含已启用的服务器。传入 createMakefileClawAgent 的 toolsEnable.remoteServers，
      // 由 agent-core 通过 StreamableHTTPClientTransport 连接并加载工具。
      const allMcpServers = this.clawConfigService.readConfig().mcpServers;
      const remoteServers = allMcpServers
        .filter((m) => mcpServerNames.includes(m.name) && m.active === 1)
        .map((m) => ({
          name: m.name,
          url: m.url,
          headers: m.headers ?? {},
        }));
      if (remoteServers.length > 0) {
        this.logger.log(
          `[MCP] 启用远程服务器: ${remoteServers.map((s) => `${s.name}(${s.url})`).join(', ')}`,
        );
      }
      created = await createMakefileClawAgent(
        agentName,
        threadId,
        { fileTools: true, shellTools: true, puppeteerTools: true, webTools: true, remoteServers },
        skillsContent,
      );
    } catch (e) {
      const msg = (e as Error).message || 'Agent 创建失败';
      this.logger.error(`[创建 Agent 失败] ${msg}`);
      const errPayload = JSON.stringify({
        choices: [{ delta: { content: `\n\n<think><node title="错误">${msg}</node></think>\n\n⚠️ ${msg}` } }],
        sessionId,
      });
      res.write(`data: ${errPayload}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    const { agent, close, checkpointer } = created;
    this.logger.log(`Agent 创建完成，耗时 ${Date.now() - agentCreateStart}ms`);

    // ==========================================================

    // 超时控制变量声明在 try 外部，供 catch/finally 清理定时器使用
    let runTimer: NodeJS.Timeout | undefined;
    let idleTimer: NodeJS.Timeout | null = null;
    let idleTimedOut = false;
    let abortController: AbortController;

    try {
      /**
       * 封装SSE分片发送函数
       * @param text 需要推送给前端的文本片段
       * 载荷中同时携带 sessionId，供前端后续请求回传以实现多轮记忆
       */
      const emit = (text: string) => {
        if (!text) return;
        const payload = JSON.stringify({
          choices: [{ delta: { content: text } }],
          sessionId,
        });
        // SSE规范：data: + 内容 + 两个换行符
        res.write(`data: ${payload}\n\n`);
      };

      // ==========================================================
      // 流式输出状态追踪（思维链 node 协议）
      // 协议：<think> 容器内嵌 <node title="...">内容</node>
      //   - 思考内容  → <node title="思考">
      //   - 工具调用  → <node title="<中文名> <工具名>">参数</node>
      //   - 工具结果  → <node title="工具结果 <工具名>">结果</node>
      // 每个分片同时可能包含：思考(reasoning)、正文(content)、工具调用(tool_calls)、工具结果(tool_call_id)
      let openNode: 'think' | 'tool' | 'tool_result' | null = null;
      let thinkOpened = false;
      // tool_call_id -> 工具名，工具结果分片只有 id，靠此映射反查工具名用于节点标题
      const toolNameById = new Map<string, string>();
      // 工具名中文映射，用于思维链节点标题
      const TOOL_TITLE: Record<string, string> = {
        execute: '执行命令', read_file: '读取文件', write_file: '写入文件',
        edit_file: '编辑文件', ls: '列出目录', glob: '查找文件',
        grep: '搜索内容', delete: '删除文件', write_todos: '更新待办',
      };
      // 关闭当前 node
      const closeNode = () => {
        if (openNode) {
          emit('</node>');
          openNode = null;
        }
      };
      // 打开新 node（首次自动打开 <think> 容器）
      const openNodeFn = (title: string, kind: 'think' | 'tool' | 'tool_result') => {
        closeNode();
        if (!thinkOpened) {
          emit('<think>');
          thinkOpened = true;
        }
        emit(`<node title="${title}">`);
        openNode = kind;
      };
      // 闭合 node 与 think 容器，正文内容在容器外下发
      const closeThink = () => {
        closeNode();
        if (thinkOpened) {
          emit('</think>');
          thinkOpened = false;
        }
      };

      // ==========================================================
      // 以 streamMode: 'messages' 模式发起流式请求，返回异步迭代器
      // 每个分片为 [messageChunk, metadata] 元组：
      //   messageChunk：LangChain 消息分片，含 additional_kwargs.reasoning_content（思考）、
      //                 content（正文）、tool_calls（工具调用）、tool_call_id（工具结果）等
      // configurable.thread_id 绑定会话，FileSaver 据此读写对应检查点文件，实现多轮记忆

      // 使用 AbortController 同时管理「总超时」和「无活动超时」：
      // - 总超时：RUN_TIMEOUT_MS 后强制 abort（无论是否有输出）
      // - 无活动超时：连续 IDLE_TIMEOUT_MS 未收到分片时 abort（模型卡死兜底）
      abortController = new AbortController();

      runTimer = setTimeout(() => {
        abortController.abort(new Error('RUN_TIMEOUT'));
      }, RUN_TIMEOUT_MS);

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          abortController.abort(new Error('IDLE_TIMEOUT'));
        }, IDLE_TIMEOUT_MS);
      };
      resetIdleTimer();

      // 构造用户消息：有图片时使用多模态内容数组，否则纯文本
      const userContent = imageParts.length > 0
        ? [{ type: "text" as const, text: input }, ...imageParts]
        : input;

      const response = await agent.stream(
        { messages: [{ role: "user", content: userContent }] },
        {
          streamMode: "messages",
          configurable: { thread_id: threadId },
          // 递归限制：LangGraph 默认 25 步，技能驱动的 Agent 可能需要更多轮工具调用，
          // 放宽到 100 步，避免 GraphRecursionError
          recursionLimit: 100,
          signal: abortController.signal,
        },
      );
      this.logger.log(`[流式] 开始接收模型分片...`);

      // 分片统计：用于流结束时输出汇总日志
      let chunkCount = 0;
      let toolCallCount = 0;
      let toolResultCount = 0;
      let answerChars = 0;
      let thinkingChars = 0;
      const streamStart = Date.now();

      // 遍历异步迭代器，消费模型每一块返回数据
      for await (const chunk of response) {
        // 收到分片 → 重置无活动计时器
        resetIdleTimer();
        // agent stream messages 模式下，每个 chunk 是 [messageChunk, metadata] 元组
        const [messageChunk] = chunk;
        chunkCount++;

        // ----------------------------------------------------------
        // 提取分片各字段
        const reasoning = messageChunk?.additional_kwargs?.reasoning_content;
        // content 可能是字符串、数组（多模态）或对象（MCP 工具结果 {content, structuredContent}），
        // 统一抽取为纯文本
        const rawContent = messageChunk?.content;
        let aiContent = "";
        if (typeof rawContent === "string") {
          aiContent = rawContent;
        } else if (Array.isArray(rawContent)) {
          aiContent = rawContent
            .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
            .join("");
        } else if (rawContent && typeof rawContent === "object") {
          // MCP 工具结果：{ content: [{type:'text', text:...}], structuredContent: { content: "..." } }
          if (rawContent.structuredContent?.content) {
            aiContent = String(rawContent.structuredContent.content);
          } else if (Array.isArray(rawContent.content)) {
            aiContent = rawContent.content
              .map((c: any) => (typeof c === "string" ? c : c?.text ?? ""))
              .join("");
          } else if (typeof rawContent.content === "string") {
            aiContent = rawContent.content;
          }
        }
        const hasToolCalls = !!(messageChunk?.tool_calls && messageChunk.tool_calls.length > 0);
        const hasThinking = !!reasoning;
        const hasAnswer = !!aiContent;
        // 工具执行结果分片：含 tool_call_id 且 content 非空
        const isToolResult = !!(messageChunk?.tool_call_id && hasAnswer);

        // 统计字符数
        if (hasThinking) thinkingChars += String(reasoning).length;
        if (hasAnswer && !hasToolCalls) answerChars += aiContent.length;

        // 工具调用：记录工具名和参数预览。
        // 按 tool_call_id 去重计数（流式模式下同一个 tool_call 可能拆成多个分片），
        // 并在达到单轮上限时主动 abort，避免上下文无限膨胀拖垮推理速度。
        if (hasToolCalls) {
          const tc = messageChunk.tool_calls[0];
          const toolName = tc?.name || 'unknown';
          const tcId = tc?.id;
          if (tcId && !toolNameById.has(tcId)) {
            toolNameById.set(tcId, toolName);
            toolCallCount++;
            const argsStr = tc?.args ? JSON.stringify(tc.args) : '';
            const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 80) + '...' : argsStr;
            this.logger.log(`[工具调用] #${toolCallCount} ${toolName}(${argsPreview})`);
            // 达到上限：主动中止本轮，把控制权交还给用户
            if (toolCallCount >= MAX_TOOL_CALLS_PER_RUN) {
              this.logger.warn(`[工具调用上限] 已达 ${MAX_TOOL_CALLS_PER_RUN} 次，主动中止本轮`);
              abortController.abort(new Error('MAX_TOOL_CALLS'));
            }
          }
        }
        if (isToolResult) {
          toolResultCount++;
          const resultPreview = aiContent.length > 80 ? aiContent.slice(0, 80) + '...' : aiContent;
          this.logger.log(`[工具结果] #${toolResultCount} ${resultPreview}`);
        }

        // ----------------------------------------------------------
        // 思维链 node 下发（供前端 ThoughtChain 渲染）：
        // - 思考内容 → <node title="思考">
        // - 工具调用 → <node title="<中文名> <工具名>">参数 JSON</node>
        // - 工具结果 → <node title="工具结果 <工具名>">结果文本</node>
        if (hasThinking) {
          if (openNode !== 'think') openNodeFn('思考', 'think');
          emit(String(reasoning));
        }
        if (hasToolCalls) {
          const tc = messageChunk.tool_calls[0];
          const toolName = tc?.name || 'unknown';
          const argsStr = tc?.args ? JSON.stringify(tc.args) : '';
          openNodeFn(`${TOOL_TITLE[toolName] ?? ''} ${toolName}`.trim(), 'tool');
          if (argsStr) emit(argsStr);
        }
        if (isToolResult) {
          const toolName = toolNameById.get(messageChunk.tool_call_id) ?? '';
          openNodeFn(toolName ? `工具结果 ${toolName}` : '工具结果', 'tool_result');
          emit(aiContent.length > 200 ? aiContent.slice(0, 200) + '…' : aiContent);
        }

        // ----------------------------------------------------------
        // 正文下发：先闭合 think 容器，正文在容器外输出
        if (hasAnswer && !hasToolCalls && !isToolResult) {
          closeThink();
          emit(aiContent);
        }
      }

      // 兜底处理：流提前结束时闭合未关闭的 node 与 think 容器，防止标签不配对
      closeThink();

      // 流正常结束，清理所有定时器
      clearTimeout(runTimer);
      if (idleTimer) clearTimeout(idleTimer);

      // 流式输出汇总日志
      const streamDuration = Date.now() - streamStart;
      this.logger.log(
        `[流式结束] 耗时 ${streamDuration}ms, 分片 ${chunkCount}, ` +
        `工具调用 ${toolCallCount}次, 工具结果 ${toolResultCount}次, ` +
        `思考 ${thinkingChars}字符, 回答 ${answerChars}字符`,
      );

      // SSE约定结束标记，前端收到后关闭监听
      res.write("data: [DONE]\n\n");
      res.end();

      // 注意：Agent 的 FileSaver 检查点存储器已在流执行过程中自动把
      // 本轮用户消息与 AI 回复持久化到 ~/.makefile_claw/memory/<threadId>.json，
      // 无需再手动维护消息队列或写入 messageMap。
    } catch (error) {
      // 清理定时器
      clearTimeout(runTimer);
      if (idleTimer) clearTimeout(idleTimer);

      const err = error as Error;
      // 区分中止类型：MAX_TOOL_CALLS（达到工具调用上限，主动中止）/
      //              IDLE_TIMEOUT（模型无响应）/ RUN_TIMEOUT（总超时）/ 其他异常
      // 注意：abortController.abort() 抛出的 error 带有 ABORT_ERR 码，
      //       必须先判断 MAX_TOOL_CALLS，否则会被误判为 RUN_TIMEOUT
      const isMaxToolCalls = err.message === 'MAX_TOOL_CALLS';
      const isIdleTimeout = idleTimedOut || err.message === 'IDLE_TIMEOUT';
      const isRunTimeout = !isMaxToolCalls && (err.message === 'RUN_TIMEOUT' || err.name === 'TimeoutError' || (err as any).code === 'ABORT_ERR');
      if (isMaxToolCalls) {
        this.logger.warn(`[工具调用上限] 本轮已执行 ${MAX_TOOL_CALLS_PER_RUN} 次工具调用，主动中止以避免上下文膨胀`);
      } else if (isIdleTimeout) {
        this.logger.error(`[无活动超时] 模型连续 ${IDLE_TIMEOUT_MS / 1000}s 无输出，已中断: ${err.message}`);
      } else if (isRunTimeout) {
        this.logger.error(`[对话超时] Agent 执行超过 ${RUN_TIMEOUT_MS / 1000}s 被中断: ${err.message}`);
      } else {
        this.logger.error(`[对话异常] ${err.name}: ${err.message}`, err.stack);
      }
      // 异常分支：向前端下发提示分片，保证流有正常结束标记，前端不会无限等待
      const errText = isMaxToolCalls
        ? `本轮已执行 ${MAX_TOOL_CALLS_PER_RUN} 次工具调用，任务较大已暂停。已完成的工作已保存，请告知我继续或调整方向。`
        : isIdleTimeout
          ? '模型长时间无响应，已中断'
          : isRunTimeout
            ? '任务执行超时，已中断'
            : '服务异常，请稍后重试';
      const errPayload = JSON.stringify({
        choices: [{ delta: { content: `\n\n<think><node title="提示">${errText}</node></think>\n\n${isMaxToolCalls ? '⏸️' : '⚠️'} ${errText}` } }],
        sessionId,
      });
      res.write(`data: ${errPayload}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } finally {
        // close 关闭 LocalShellBackend（deepagents 的 execute 每次都是短命子进程，无 MCP 进程树需要清理）
        await close()

        // 清空 FileSaver 的防抖定时器，并立即执行一次落盘，
        // 避免 300ms 定时器挂在事件循环上导致进程无法干净退出
        if (checkpointer.saveTimer) {
            clearTimeout(checkpointer.saveTimer)
            checkpointer.saveTimer = null
            checkpointer.save()
        }

        this.logger.log(`[对话结束] 资源已清理，会话 ${threadId} 持久化完成`);

        // 不再调用 process.exit(0)：close() 已释放后端资源，无需退出整个服务进程。
    }
  }

  // ==========================================================
  // 会话历史相关接口
  // ==========================================================

  /**
   * 会话持久化目录：~/.makefile_claw/memory
   * 与 createMakefileClawAgent 中 FileSaver 的路径保持一致
   */
  private get memoryDir(): string {
    return path.join(os.homedir(), ".makefile_claw", "memory");
  }

  /**
   * AI 工作区目录：~/.makefile_claw/workspaces
   * 与 createMakefileClawAgent 中 LocalShellBackend 的 rootDir 保持一致，
   * AI 的所有文件操作被 deepagents 限制在此目录内。
   */
  private get workspaceDir(): string {
    return path.join(os.homedir(), ".makefile_claw", "workspaces");
  }

  /**
   * 安全解析工作区内的相对路径，禁止 .. 越界访问工作区之外的目录。
   * @param relPath 相对于工作区根的路径（允许空字符串表示根目录）
   * @returns 解析后的绝对路径
   * @throws Error 若路径越界或包含非法片段
   */
  private resolveWorkspacePath(relPath: string): string {
    const root = path.resolve(this.workspaceDir);
    // 规范化路径：去除首尾斜杠，合并重复分隔符
    const normalized = relPath.replace(/^[\\/]+/, "").replace(/\\/g, "/");
    const resolved = path.resolve(root, normalized);
    const relative = path.relative(root, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("路径越界：不允许访问工作区之外的目录");
    }
    return resolved;
  }

  /**
   * 读取会话元数据文件（标题、是否手动改名等）
   * 元数据与检查点文件同目录，文件名为 <threadId>.meta.json
   */
  private readMeta(threadId: string): { title?: string; manuallyRenamed?: boolean } {
    try {
      const metaPath = path.join(this.memoryDir, `${threadId}.meta.json`);
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, "utf8"));
      }
    } catch {
      // 忽略解析失败
    }
    return {};
  }

  /**
   * 写入会话元数据文件
   */
  private writeMeta(threadId: string, meta: { title?: string; manuallyRenamed?: boolean }) {
    try {
      const dir = this.memoryDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const metaPath = path.join(dir, `${threadId}.meta.json`);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    } catch (e: any) {
      console.error("[writeMeta] failed:", e?.message || e);
    }
  }

  /**
   * 列出所有历史会话
   * GET /models-streaming/sessions
   *
   * 扫描 ~/.makefile_claw/memory 目录下的所有 .json 检查点文件，
   * 每个文件对应一个会话（threadId 即文件名去掉 .json）。
   * 同时读取同名 .meta.json 获取会话标题。
   * 返回会话列表，按文件修改时间倒序排列（最近活跃的在前）。
   */
  @Get("sessions")
  listSessions(@Res() res: any) {
    try {
      const dir = this.memoryDir;
      if (!fs.existsSync(dir)) {
        res.json({ sessions: [] });
        return;
      }
      // 只取 .json 检查点文件，排除 .meta.json
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json") && !f.endsWith(".meta.json"));
      const sessions = files
        .map((f) => {
          const threadId = f.slice(0, -".json".length);
          const stat = fs.statSync(path.join(dir, f));
          const meta = this.readMeta(threadId);
          return {
            threadId,
            title: meta.title ?? "",
            manuallyRenamed: meta.manuallyRenamed ?? false,
            updatedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      res.json({ sessions });
    } catch (error) {
      console.error("[listSessions] error:", error);
      res.status(500).json({ error: "Failed to list sessions" });
    }
  }

  /**
   * 删除会话
   * DELETE /models-streaming/sessions/:threadId
   *
   * 删除该会话的检查点文件（<threadId>.json）和元数据文件（<threadId>.meta.json），
   * 确保刷新后该会话不再出现在列表中。
   */
  @Delete("sessions/:threadId")
  deleteSession(@Param("threadId") threadId: string, @Res() res: any) {
    try {
      const dir = this.memoryDir;
      const checkpointPath = path.join(dir, `${threadId}.json`);
      const metaPath = path.join(dir, `${threadId}.meta.json`);
      if (fs.existsSync(checkpointPath)) fs.unlinkSync(checkpointPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      res.json({ success: true });
    } catch (error) {
      console.error("[deleteSession] error:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  }

  /**
   * 自动生成会话标题
   * POST /models-streaming/sessions/:threadId/title
   * Body: { content: string }  第一条用户提问文本
   *
   * 规则：
   * - 若该会话已被手动改名（manuallyRenamed=true），直接返回已有标题，不覆盖
   * - 否则调用模型根据第一条用户提问提炼简短标题（不超过 15 字）
   * - 若第一条是图片/文件或文字极短（< 5 字），返回默认名"新对话"
   */
  @Post("sessions/:threadId/title")
  async generateTitle(
    @Param("threadId") threadId: string,
    @Body() body: { content?: string },
    @Res() res: any,
  ) {
    try {
      const content = (body?.content ?? "").trim();

      // 已手动改名则不覆盖
      const meta = this.readMeta(threadId);
      if (meta.manuallyRenamed && meta.title) {
        res.json({ title: meta.title });
        return;
      }

      // 无文本（纯图片/文件），使用默认名
      if (!content) {
        const title = "新对话";
        this.writeMeta(threadId, { ...meta, title, manuallyRenamed: false });
        res.json({ title });
        return;
      }

      // 文字较少（≤ 12 字），直接用原文作为标题
      if (content.length <= 12) {
        this.writeMeta(threadId, {
          ...meta,
          title: content,
          manuallyRenamed: false,
        });
        res.json({ title: content });
        return;
      }

      // 文字较多，调用模型提炼标题
      const model = await createModel("TestAgent");
      const prompt = `请用不超过15个字概括下面这个用户的问题，直接输出标题，不要有引号、句号或其他多余内容：\n\n${content}`;
      const result = await model.invoke([new HumanMessage({ content: prompt })]);
      let title =
        typeof result?.content === "string" ? result.content.trim() : "";
      // 清理模型可能输出的多余符号
      title = title.replace(/^["'「『]+|["'」』。！？!?]+$/g, "").trim();
      if (!title) title = content.slice(0, 15);
      if (title.length > 20) title = title.slice(0, 20);

      this.writeMeta(threadId, { ...meta, title, manuallyRenamed: false });
      res.json({ title });
    } catch (error) {
      console.error("[generateTitle] error:", error);
      // 模型调用失败时，降级为截取前 15 字；无文本则用默认名
      const content = (body?.content ?? "").trim();
      const title = content ? content.slice(0, 15) : "新对话";
      res.json({ title });
    }
  }

  /**
   * 手动修改会话标题
   * PUT /models-streaming/sessions/:threadId/title
   * Body: { title: string }
   *
   * 手动改名后标记 manuallyRenamed=true，后续自动生成标题不会再覆盖。
   */
  @Put("sessions/:threadId/title")
  async renameSession(
    @Param("threadId") threadId: string,
    @Body() body: { title?: string },
    @Res() res: any,
  ) {
    try {
      const title = (body?.title ?? "").trim() || "新对话";
      const meta = this.readMeta(threadId);
      this.writeMeta(threadId, { ...meta, title, manuallyRenamed: true });
      res.json({ success: true, title });
    } catch (error) {
      console.error("[renameSession] error:", error);
      res.status(500).json({ error: "Failed to rename session" });
    }
  }

  /**
   * 获取指定会话的全部消息历史
   * GET /models-streaming/sessions/:threadId/messages
   *
   * 通过 Agent 的 getState 从 FileSaver 检查点中恢复该 threadId 的消息列表，
   * 重建与流式输出一致的 <think><node> 协议：
   *   - 思考过程(reasoning_content) → <node title="思考">
   *   - 工具调用(tool_calls)         → <node title="<中文名> <工具名>">参数JSON</node>
   *   - 工具结果(ToolMessage)         → <node title="工具结果 <工具名>">结果</node>
   *   - 正文回答                      → 放在 </think> 之后
   * 前端 parser 据此渲染完整的思维链（思考 + 工具调用 + 工具结果）。
   */
  @Get("sessions/:threadId/messages")
  async getSessionMessages(@Param("threadId") threadId: string, @Res() res: any) {
    try {
      // 优化：直接用 FileSaver 读取检查点文件，跳过 createMakefileClawAgent
      // （后者会启动 MCP 子进程并加载 16 个工具，耗时数秒，而读历史根本不需要工具）
      const filePath = path.join(this.memoryDir, `${threadId}.json`);
      const checkpointer = new FileSaver(filePath);
      const tuple = await checkpointer.getTuple({
        configurable: { thread_id: threadId },
      });
      const rawMessages: any[] =
        tuple?.checkpoint?.channel_values?.messages ?? [];

      // 辅助函数：从各种 content 结构中提取纯文本
      // 支持 string / 数组(多模态) / 对象({content, structuredContent})
      const extractText = (content: any): string => {
        if (content == null) return "";
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((c: any) => {
              if (typeof c === "string") return c;
              if (c?.text) return String(c.text);
              return "";
            })
            .join("");
        }
        if (typeof content === "object") {
          // MCP 工具结果通常是 { content: [...], structuredContent: { content: "..." } }
          if (content.structuredContent?.content) {
            return String(content.structuredContent.content);
          }
          if (Array.isArray(content.content)) {
            return extractText(content.content);
          }
          if (typeof content.content === "string") {
            return content.content;
          }
          // 兜底：序列化为 JSON 字符串
          try {
            return JSON.stringify(content);
          } catch {
            return String(content);
          }
        }
        return String(content);
      };

      // 工具名中文映射，与流式输出保持一致，用于思维链节点标题
      const TOOL_TITLE: Record<string, string> = {
        execute: '执行命令', read_file: '读取文件', write_file: '写入文件',
        edit_file: '编辑文件', ls: '列出目录', glob: '查找文件',
        grep: '搜索内容', delete: '删除文件', write_todos: '更新待办',
      };

      // 按用户提问分轮次：每两条 human 消息之间的所有 ai/tool 消息属于同一轮 assistant 回复
      // 对每一轮重建 <think><node>...</node></think> 协议，与流式输出格式一致
      const messages: { role: string; content: string }[] = [];
      let turnThinkNodes: string[] = [];
      let turnAnswer = '';
      // tool_call_id -> 工具名，工具结果消息只有 id，靠此映射反查工具名
      const toolNameById = new Map<string, string>();

      const flushAssistantTurn = () => {
        if (turnThinkNodes.length === 0 && !turnAnswer) return;
        const think = turnThinkNodes.length > 0
          ? `<think>${turnThinkNodes.join('')}</think>`
          : '';
        messages.push({ role: 'assistant', content: think + turnAnswer });
        turnThinkNodes = [];
        turnAnswer = '';
      };

      for (const msg of rawMessages) {
        const type =
          typeof msg?._getType === "function" ? msg._getType() : msg?.type;

        if (type === "human") {
          // 新的用户提问：先把上一轮 assistant 回复刷出
          flushAssistantTurn();
          const content = extractText(msg?.content);
          messages.push({ role: 'user', content });
          continue;
        }

        if (type === "system") {
          // system 消息不展示在聊天记录中
          continue;
        }

        // ai / tool 消息，归入当前 assistant 轮次
        const content = extractText(msg?.content);

        if (type === "ai") {
          // 1) 思考过程 → <node title="思考">
          const reasoning = msg?.additional_kwargs?.reasoning_content;
          if (reasoning) {
            turnThinkNodes.push(`<node title="思考">${String(reasoning)}</node>`);
          }
          // 2) 工具调用 → <node title="<中文名> <工具名>">参数 JSON</node>
          const toolCalls = msg?.tool_calls;
          if (toolCalls && toolCalls.length > 0) {
            for (const tc of toolCalls) {
              const toolName = tc?.name || 'unknown';
              if (tc?.id) toolNameById.set(tc.id, toolName);
              const argsStr = tc?.args ? JSON.stringify(tc.args) : '';
              const title = `${TOOL_TITLE[toolName] ?? ''} ${toolName}`.trim();
              turnThinkNodes.push(`<node title="${title}">${argsStr}</node>`);
            }
          }
          // 3) 正文回答（不含工具调用的 AI content）→ 放在 </think> 之后
          if (content && (!toolCalls || toolCalls.length === 0)) {
            turnAnswer += (turnAnswer ? '\n\n' : '') + content;
          }
        } else if (type === "tool") {
          // 工具执行结果 → <node title="工具结果 <工具名>">结果</node>
          const toolName = (msg?.name as string) || toolNameById.get(msg?.tool_call_id) || '';
          const title = toolName ? `工具结果 ${toolName}` : '工具结果';
          turnThinkNodes.push(`<node title="${title}">${content}</node>`);
        }
      }
      // 收尾：刷出最后一轮 assistant 回复
      flushAssistantTurn();

      res.json({ messages });
    } catch (error) {
      console.error("[getSessionMessages] error:", error);
      res.status(500).json({ error: "Failed to load session messages" });
    }
  }

  // ==========================================================
  // 工作区文件浏览相关接口（供前端 Folder 组件展示工作区内容）
  // ==========================================================

  /**
   * 递归构建工作区目录树
   * @param dir 绝对目录路径
   * @param relBase 相对于工作区根的路径前缀（用 / 分隔）
   * @param depth 当前递归深度（防止过深目录栈溢出，限制到 20 层）
   */
  private buildWorkspaceTree(dir: string, relBase: string, depth: number): WorkspaceTreeNode[] {
    if (depth > 20) return [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: WorkspaceTreeNode[] = [];
    for (const entry of entries) {
      // 跳过隐藏文件（如 .git）和 node_modules，避免树过大
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        nodes.push({
          title: entry.name,
          path: relPath,
          isLeaf: false,
          children: this.buildWorkspaceTree(fullPath, relPath, depth + 1),
        });
      } else if (entry.isFile()) {
        nodes.push({
          title: entry.name,
          path: relPath,
          isLeaf: true,
        });
      }
    }
    // 目录在前、文件在后，各自按名称排序
    nodes.sort((a, b) => {
      if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
      return a.title.localeCompare(b.title);
    });
    return nodes;
  }

  /**
   * 获取工作区目录树
   * GET /models-streaming/workspace/tree
   *
   * 递归扫描 ~/.makefile_claw/workspaces，返回文件夹树（供前端 Folder 组件渲染）。
   * 跳过隐藏文件与 node_modules，递归深度上限 20 层。
   */
  @Get("workspace/tree")
  getWorkspaceTree(@Res() res: any) {
    try {
      const root = this.workspaceDir;
      if (!fs.existsSync(root)) {
        fs.mkdirSync(root, { recursive: true });
      }
      const tree = this.buildWorkspaceTree(root, "", 0);
      res.json({ tree });
    } catch (error) {
      console.error("[getWorkspaceTree] error:", error);
      res.status(500).json({ error: "Failed to list workspace" });
    }
  }

  /**
   * 读取工作区内指定文件的内容
   * GET /models-streaming/workspace/file?path=xxx
   *
   * path 为相对于工作区根的路径（如 "subdir/file.txt"）。
   * 安全校验：禁止 .. 越界访问工作区外目录；仅允许读取文本文件。
   * 返回 { content, size }。
   */
  @Get("workspace/file")
  getWorkspaceFile(@Res() res: any, @Query("path") relPath?: string) {
    try {
      const rawPath = String(relPath ?? "");
      const absPath = this.resolveWorkspacePath(rawPath);
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      const stat = fs.statSync(absPath);
      // 限制单文件读取上限 2MB，避免大文件撑爆响应
      const MAX_BYTES = 2 * 1024 * 1024;
      if (stat.size > MAX_BYTES) {
        res.status(413).json({ error: `File too large (${stat.size} bytes), max ${MAX_BYTES}` });
        return;
      }
      const content = fs.readFileSync(absPath, "utf-8");
      res.json({ content, size: stat.size });
    } catch (error: any) {
      console.error("[getWorkspaceFile] error:", error?.message || error);
      res.status(400).json({ error: error?.message || "Failed to read file" });
    }
  }
}

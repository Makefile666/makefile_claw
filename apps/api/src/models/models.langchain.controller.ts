import { Controller, Query, Get, Res, Param, Body, Delete, Post, Put, Logger } from "@nestjs/common";
import { createMakefileClawAgent, createModel, HumanMessage, FileSaver } from "@makefile-claw/agent-core";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelsService } from "./models.service.js";
import { SkillsService } from "../skills/skills.service.js";

@Controller("models-streaming")
export class ModelsLangchainController {
  private readonly logger = new Logger(ModelsLangchainController.name);
  constructor(
    private readonly modelsService: ModelsService,
    private readonly skillsService: SkillsService,
  ) {}

  /**
   * 大模型流式对话接口，兼容 OpenAI SSE 协议格式
   * 请求地址：GET /models-streaming?input=xxx
   *
   * 【协议说明】
   * 标准 SSE 流式输出，每条消息以 data: 开头，双换行 \n\n 作为分隔符
   * 流末尾发送 data: [DONE] 标记本次会话结束
   *
   * 【输出结构】
   * data: {"choices":[{"delta":{"content":"文本分片"}}]}
   * data: [DONE]
   *
   * 【思考内容规则】
   * 模型返回的 reasoning_content 思考过程，自动包裹 <think>...</think> 标签
   * 前端解析器识别该标签，区分渲染思考区与回答正文
   * 自动保证标签成对闭合，防止前端渲染错乱
   *
   * 【会话记忆与持久化】
   * 本接口不再在内存中手动维护消息队列，而是改为基于 LangGraph Agent + FileSaver 检查点存储器：
   * - createMakefileClawAgent 内部为每个 threadId 绑定一个 FileSaver，
   *   自动把会话检查点持久化到 ~/.makefile_claw/memory/<threadId>.json
   * - 前端首请求 chatId 为空时，后端生成新的 threadId 作为 sessionId 回传；
   *   后续请求携带该 chatId，即可从本地文件恢复历史上下文，实现跨请求多轮记忆
   * - Agent 已内置系统提示词（systemPrompt），无需手动注入 SystemMessage
   *
   * 【入参】
   * input：用户提问文本，需要做 URL 解码
   * chatId：会话ID（即上一轮返回的 sessionId），首次对话为空
   *
   * 【异常行为】
   * 入参缺失返回 400；服务内部报错会向前端推送错误提示分片，再发送 [DONE]，保证流正常收尾，避免前端长连接挂死
   */
  @Get()
  async test(@Query() query: any, @Res() res: any) {
    // 校验必填入参，input 不存在直接返回400
    if (!query.input) {
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

    let { input, chatId, skills, agent: agentParam } = query;
    // 解码URL编码后的输入内容，并去除首尾空白字符
    input = decodeURIComponent(input).trim();
    // Agent 名称：前端选择透传，为空时回退到默认 "TestAgent"
    const agentName = agentParam ? String(agentParam) : "TestAgent";

    // 解析 skills 参数：逗号分隔的技能名称数组，为空则不注入任何技能
    const skillNames: string[] = skills
      ? String(skills)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

    // 记录请求概要（input 截断到 100 字符，避免日志过长）
    const inputPreview = input.length > 100 ? input.slice(0, 100) + '...' : input;
    this.logger.log(
      `[对话请求] agent=${agentName}, skills=[${skillNames.join(', ')}], ` +
      `chatId=${chatId || '(新会话)'}, input="${inputPreview}"`,
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
    // 90s 容易超时，放宽到 5 分钟以覆盖复杂任务
    const RUN_TIMEOUT_MS = 300 * 1000
    // 无活动超时：模型连续 IDLE_TIMEOUT_MS 不输出任何分片时主动中断。
    // 模型卡死、网络中断等场景下快速失败，避免干等到总超时。
    const IDLE_TIMEOUT_MS = 90 * 1000
    this.logger.log(`创建 Agent: ${agentName}, threadId=${threadId}, 总超时=${RUN_TIMEOUT_MS / 1000}s, 无活动超时=${IDLE_TIMEOUT_MS / 1000}s`);
    const agentCreateStart = Date.now();
    const { agent, close, checkpointer } = await createMakefileClawAgent(agentName, threadId, undefined, skillsContent);
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
      // 流式输出状态追踪
      // - thinkingStarted / thinkingEnded：思考标签边界
      // - 每个分片同时可能包含：思考(reasoning)、正文(content)、工具调用(tool_calls)、工具结果(tool_call_id)
      let thinkingStarted = false;
      let thinkingEnded = false;

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

      const response = await agent.stream(
        { messages: [{ role: "user", content: input }] },
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

        // 工具调用：记录工具名和参数预览
        if (hasToolCalls) {
          toolCallCount++;
          const tc = messageChunk.tool_calls[0];
          const toolName = tc?.name || 'unknown';
          const argsStr = tc?.args ? JSON.stringify(tc.args) : '';
          const argsPreview = argsStr.length > 80 ? argsStr.slice(0, 80) + '...' : argsStr;
          this.logger.log(`[工具调用] #${toolCallCount} ${toolName}(${argsPreview})`);
        }
        if (isToolResult) {
          toolResultCount++;
          const resultPreview = aiContent.length > 80 ? aiContent.slice(0, 80) + '...' : aiContent;
          this.logger.log(`[工具结果] #${toolResultCount} ${resultPreview}`);
        }

        // ----------------------------------------------------------
        // 思考过程：用 <think> 标签包裹，前端 parser 拆分后交给 <Think> 组件渲染
        if (hasThinking && !thinkingEnded) {
          if (!thinkingStarted) {
            emit("<think>");
            thinkingStarted = true;
          }
          emit(String(reasoning));
        }

        // 思考结束：之前在思考、当前分片无思考内容 → 闭合 </think>
        if (thinkingStarted && !thinkingEnded && !hasThinking) {
          emit("</think>");
          thinkingEnded = true;
        }

        // ----------------------------------------------------------
        // 内容下发：
        // - AI 正文、工具执行结果的 content 直接下发（不带 "🔧 调用工具" / "📋 工具执行结果" 标签）
        // - 工具调用的 name/args（tool_calls）属于中间过程，不下发
        if (hasAnswer && !hasToolCalls) {
          emit(aiContent);
        }
      }

      // 兜底处理：流提前结束、没有正文内容时，手动闭合 </think> 标签，防止标签不配对
      if (thinkingStarted && !thinkingEnded) {
        emit("</think>");
      }

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
      // 区分超时类型：IDLE_TIMEOUT（模型无响应）/ RUN_TIMEOUT（总超时）/ 其他异常
      const isIdleTimeout = idleTimedOut || err.message === 'IDLE_TIMEOUT';
      const isRunTimeout = err.message === 'RUN_TIMEOUT' || err.name === 'TimeoutError' || (err as any).code === 'ABORT_ERR';
      if (isIdleTimeout) {
        this.logger.error(`[无活动超时] 模型连续 ${IDLE_TIMEOUT_MS / 1000}s 无输出，已中断: ${err.message}`);
      } else if (isRunTimeout) {
        this.logger.error(`[对话超时] Agent 执行超过 ${RUN_TIMEOUT_MS / 1000}s 被中断: ${err.message}`);
      } else {
        this.logger.error(`[对话异常] ${err.name}: ${err.message}`, err.stack);
      }
      // 异常分支：向前端下发错误提示分片，保证流有正常结束标记，前端不会无限等待
      const errPayload = JSON.stringify({
        choices: [{ delta: { content: "\n\n⚠️ 服务异常，请稍后重试。" } }],
      });
      res.write(`data: ${errPayload}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    } finally {
        // close 内部先强制回收所有残留终端，再等待 MCP 客户端和 npx 子进程真正关闭
        await close()

        // 清空 FileSaver 的防抖定时器，并立即执行一次落盘，
        // 避免 300ms 定时器挂在事件循环上导致进程无法干净退出
        if (checkpointer.saveTimer) {
            clearTimeout(checkpointer.saveTimer)
            checkpointer.saveTimer = null
            checkpointer.save()
        }

        this.logger.log(`[对话结束] 资源已清理，会话 ${threadId} 持久化完成`);

        // 不再调用 process.exit(0)。
        // 之前为解决 Windows 下残留句柄问题而强制退出进程，
        // 但这会导致每次对话结束后整个 API 服务被杀死重启，
        // 使得 Agents/Models/Tools 等页面请求在重启期间变得极慢。
        // close() 内部已通过 taskkill /T /F 递归杀掉 MCP 进程树，
        // client.close() 也会释放传输层句柄，无需再退出整个服务进程。
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
   * 转换为前端可直接渲染的格式（assistant 的思考过程用 <think> 标签包裹）。
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

      // 第一步：把每条 LangChain 消息转换为统一的 { role, content } 结构
      const mapped = rawMessages
        .map((msg) => {
          const type =
            typeof msg?._getType === "function" ? msg._getType() : msg?.type;
          // tool 类型消息（工具执行结果）统一以 assistant 角色渲染，与流式输出一致
          const role =
            type === "human"
              ? "user"
              : type === "ai"
                ? "assistant"
                : type === "tool"
                  ? "assistant"
                  : type === "system"
                    ? "system"
                    : type;

          // 提取文本内容（兼容字符串、数组、对象等多种格式）
          let content = extractText(msg?.content);

          // 思考过程：从 additional_kwargs.reasoning_content 取出，用 <think> 包裹
          const reasoning = msg?.additional_kwargs?.reasoning_content;
          if (role === "assistant" && reasoning) {
            content = `<think>${reasoning}</think>${content}`;
          }

          // 工具调用信息（AIMessage.tool_calls 的 name/args）属于中间过程，不在聊天页面展示
          // 这里不拼接 tool_calls 内容

          return { role, content };
        })
        .filter((m) => m && m.role);

      // 第二步：合并连续的 assistant 消息为一条
      // （一次用户提问后，AI 可能产生多条 AIMessage + ToolMessage，
      //   在前端应显示为同一个 assistant 气泡，避免被拆成多次对话）
      const messages: { role: string; content: string }[] = [];
      for (const m of mapped) {
        if (m.role === "assistant" && messages.length > 0) {
          const last = messages[messages.length - 1];
          if (last.role === "assistant") {
            // 追加到上一条 assistant 消息，用换行分隔
            last.content = (last.content ? last.content + "\n\n" : "") + m.content;
            continue;
          }
        }
        messages.push({ role: m.role, content: m.content });
      }

      res.json({ messages });
    } catch (error) {
      console.error("[getSessionMessages] error:", error);
      res.status(500).json({ error: "Failed to load session messages" });
    }
  }
}

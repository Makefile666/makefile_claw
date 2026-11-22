import { Controller, Post, Body, Res, Logger } from "@nestjs/common";
import type { Response } from "express";
import { createTeamGraph } from "@makefile-claw/agent-core";
import type { TeamStreamEvent, TeamConfig, RemoteMcpServer } from "@makefile-claw/agent-core";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { SkillsService } from "../skills/skills.service.js";
import { ClawConfigService } from "../claw-config/claw-config.service.js";

const require = createRequire(import.meta.url);
const pdfParse: (buffer: Buffer) => Promise<{ text: string }> = require("pdf-parse");

/** 团队流式请求体 */
interface TeamStreamBody {
  input: string;
  /** 团队会话 id（即 teamThreadId），为空则新建 */
  chatId?: string;
  /** 团队配置（name / supervisor / workers / maxParallelWorkers ...） */
  team: TeamConfig;
  /** 选中的技能名列表 */
  skills?: string[];
  /** 选中的远程 MCP 服务器名列表 */
  mcpServers?: string[];
  /** 附件（团队 v1 仅抽取文档文本注入任务，图片暂不支持） */
  attachments?: Array<{ name: string; mime: string; base64?: string; dataUrl?: string }>;
}

/** 从文档 buffer 提取纯文本（与单 Agent 端点保持一致） */
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
    return buffer.toString("utf-8");
  } catch (e) {
    console.error(`[team extractText] 解析 ${ext} 失败:`, (e as Error).message);
    return "";
  }
}

function attachmentToBuffer(att: { base64?: string; dataUrl?: string }): Buffer | null {
  try {
    if (att.dataUrl) {
      const comma = att.dataUrl.indexOf(",");
      const b64 = comma >= 0 ? att.dataUrl.slice(comma + 1) : att.dataUrl;
      return Buffer.from(b64, "base64");
    }
    if (att.base64) return Buffer.from(att.base64, "base64");
  } catch {
    /* ignore */
  }
  return null;
}

@Controller("multi-agent")
export class MultiAgentController {
  private readonly logger = new Logger(MultiAgentController.name);

  constructor(
    private readonly skillsService: SkillsService,
    private readonly clawConfigService: ClawConfigService,
  ) {}

  @Post("stream")
  async stream(@Body() body: TeamStreamBody, @Res() res: Response) {
    const { input, team } = body;
    const chatId = body.chatId || "";
    const skillNames: string[] = Array.isArray(body.skills) ? body.skills : [];
    const mcpServerNames: string[] = Array.isArray(body.mcpServers) ? body.mcpServers : [];

    // ---- SSE 响应头 ----
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const teamThreadId = chatId || randomUUID();
    const sessionId = teamThreadId;
    this.logger.log(
      `[团队请求] team=${team?.name}, supervisor=${team?.supervisor}, ` +
        `workers=[${(team?.workers ?? []).join(",")}], chatId=${chatId || "(新会话)"}, ` +
        `maxParallel=${team?.maxParallelWorkers ?? 3}, input="${(input ?? "").slice(0, 80)}"`,
    );

    // ---- 解析附件文档文本，注入到任务输入 ----
    let docText = "";
    if (Array.isArray(body.attachments)) {
      for (const att of body.attachments) {
        if (!att.mime?.startsWith("image/")) {
          const buf = attachmentToBuffer(att);
          if (buf) {
            const ext = att.name.includes(".") ? att.name.slice(att.name.lastIndexOf(".")) : "";
            const text = await extractTextFromBuffer(buf, ext);
            if (text.trim()) docText += `\n\n【附件文件: ${att.name}】\n${text}\n`;
          }
        }
      }
    }
    const taskInput = docText ? `${docText}\n\n用户提问：${input}` : input;

    // ---- 加载技能正文 ----
    let skillsContent = "";
    if (skillNames.length > 0) {
      const loadedSkills = skillNames
        .map((name) => {
          try {
            return this.skillsService.findOne(name);
          } catch {
            return null;
          }
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .filter((s) => s.active);
      skillsContent = loadedSkills
        .map((s) => {
          let content = s.content;
          const skillDir = s.skillDir.replace(/\\/g, "/");
          content = content.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, skillDir);
          const escapedName = s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          content = content.replace(
            new RegExp(`\\.claude/skills/${escapedName}`, "g"),
            `${skillDir}/.claude/skills/${s.name}`,
          );
          return `### 技能：${s.name}\n${content}`;
        })
        .join("\n\n");
    }

    // ---- 解析远程 MCP 服务器 ----
    const allMcpServers = this.clawConfigService.readConfig().mcpServers ?? [];
    const remoteServers: RemoteMcpServer[] = allMcpServers
      .filter((m) => mcpServerNames.includes(m.name) && m.active === 1)
      .map((m) => ({ name: m.name, url: m.url, headers: m.headers ?? {} }));

    // ---- 超时控制 ----
    const RUN_TIMEOUT_MS = 600 * 1000;
    const IDLE_TIMEOUT_MS = 120 * 1000;
    const abortController = new AbortController();
    let idleTimer: NodeJS.Timeout | null = null;
    let idleTimedOut = false;
    let clientClosed = false;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        abortController.abort(new Error("IDLE_TIMEOUT"));
      }, IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    const runTimer = setTimeout(() => abortController.abort(new Error("RUN_TIMEOUT")), RUN_TIMEOUT_MS);

    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(runTimer);
    };
    res.on("close", () => {
      clientClosed = true;
      abortController.abort(new Error("CLIENT_CLOSED"));
      cleanup();
    });

    // ---- SSE 分片发送：载荷在单 Agent 格式基础上增加 agent + stage（单 Agent 端点不变，AC-5） ----
    const emit = (ev: TeamStreamEvent) => {
      if (!ev.content && !ev.error) return;
      resetIdleTimer();
      const payload = JSON.stringify({
        choices: [{ delta: { content: ev.content ?? "" } }],
        sessionId,
        agent: ev.agent,
        stage: ev.stage,
        ...(ev.worker ? { worker: ev.worker } : {}),
        ...(ev.subtask ? { subtask: ev.subtask } : {}),
        ...(ev.error ? { error: ev.error } : {}),
      });
      this.logger.debug(`[团队流] stage=${ev.stage} agent=${ev.agent} ${ev.content ? `content=${ev.content.slice(0, 40)}` : ""}`);
      if (!clientClosed) res.write(`data: ${payload}\n\n`);
    };

    try {
      const graph = createTeamGraph(team, teamThreadId);
      const eventStream = graph.stream(taskInput, {
        skillsContent,
        mcpServers: remoteServers,
        signal: abortController.signal,
        maxRounds: 8,
        onEvent: (ev) => this.logger.debug(`[团队事件] stage=${ev.stage} agent=${ev.agent}`),
      });

      for await (const ev of eventStream) {
        emit(ev);
      }

      if (!clientClosed) {
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } catch (err) {
      const reason = idleTimedOut ? "IDLE_TIMEOUT" : (err as Error)?.message ?? "UNKNOWN";
      const msg = idleTimedOut ? "团队执行无活动超时，已中断。" : `团队执行异常：${reason}`;
      this.logger.error(`[团队流异常] ${msg}`);
      if (!clientClosed) {
        emit({ stage: "error", agent: team?.supervisor ?? "supervisor", error: reason, content: `⚠️ ${msg}`, ts: new Date().toISOString() });
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } finally {
      cleanup();
      // 注意：不调用 agentPool.closeAll()——池与 MCP 子进程在进程生命周期内复用，
      // 仅在进程退出时由 McpRegistry 统一回收。
    }
  }
}
